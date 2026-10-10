import { describe, expect, it } from "vitest";
import { createSqliteStore, createProduct, receiveStockBatch, stockReceiptHistory, updateProduct } from "./sqliteStore";

describe("unified stock intake", () => {
  it("rejects non-finite prices/costs and invalid reorder points before writing", () => {
    const db = createSqliteStore();
    try {
      const existing = createProduct(db, { name: "Validation", sku: "VALIDATION", price: 10 });
      for (const fields of [{ price: Infinity }, { cost: Infinity }, { cost: NaN }, { cost: -1 }, { reorderPoint: 1.5 }, { reorderPoint: -1 }]) {
        expect(() => createProduct(db, { name: "Invalid", sku: "INVALID", price: 10, ...fields })).toThrow();
        expect(() => updateProduct(db, { productId: existing.id, ...fields })).toThrow();
      }
      expect(db.prepare("SELECT id FROM products WHERE sku='INVALID'").get()).toBeUndefined();
      expect(db.prepare("SELECT price, cost FROM products WHERE id=?").get(existing.id)).toMatchObject({ price: 10, cost: 0 });
    } finally { db.close(); }
  });

  it("rejects duplicate tier names that would merge different POS prices", () => {
    const db = createSqliteStore();
    try {
      const priceTiers = JSON.stringify([{ label: "small", price: 5, qty: 100 }, { label: " small ", price: 10, qty: 200 }]);
      expect(() => createProduct(db, { name: "Duplicate tiers", price: 5, sellMode: "money", priceTiers })).toThrow(/ซ้ำ/);
    } finally { db.close(); }
  });
  it("creates new products and receives existing products in one transaction", () => {
    const db = createSqliteStore();
    try {
      const existing = createProduct(db, { name: "Existing intake", sku: "INTAKE-OLD", price: 15 });
      const results = receiveStockBatch(db, [
        { productId: existing.id, purchaseQty: 10, freeQty: 2, paidAmount: 50, lot: "INTAKE-LOT" },
        { newProduct: { name: "New intake", sku: "INTAKE-NEW", barcode: "INTAKE-NEW", price: 20 }, purchaseQty: 5, paidAmount: 25, lot: "NEW-LOT" },
      ], "Intake operator");
      expect(results.map(result => result.product.stock)).toEqual([12, 5]);
      expect(results[0].averageCost).toBe(4.17);
      expect(stockReceiptHistory(db, { search: "INTAKE-LOT" }).reduce((sum, row) => sum + row.receivedQty, 0)).toBe(12);
    } finally { db.close(); }
  });

  it("rolls back new products, existing stock and receipt logs when any entry fails", () => {
    const db = createSqliteStore();
    try {
      const existing = createProduct(db, { name: "Rollback", sku: "ROLLBACK-OLD", price: 10 });
      const logs = db.prepare("SELECT count(*) AS n FROM audit_logs").get();
      expect(() => receiveStockBatch(db, [
        { newProduct: { name: "Must disappear", sku: "ROLLBACK-NEW", price: 20 }, purchaseQty: 3, paidAmount: 9 },
        { productId: existing.id, purchaseQty: 2, paidAmount: 4 },
        { productId: 99999999, purchaseQty: 1, paidAmount: 1 },
      ], "Operator")).toThrow();
      expect(db.prepare("SELECT id FROM products WHERE sku = 'ROLLBACK-NEW'").get()).toBeUndefined();
      expect(db.prepare("SELECT stock FROM products WHERE id = ?").get(existing.id)).toMatchObject({ stock: 0 });
      expect(db.prepare("SELECT count(*) AS n FROM audit_logs").get()).toEqual(logs);
    } finally { db.close(); }
  });

  it("rejects fractional quantities and duplicate barcodes without leaving catalog records", () => {
    const db = createSqliteStore();
    try {
      createProduct(db, { name: "Barcode owner", sku: "BAR-OLD", barcode: "12345678", price: 10 });
      expect(() => receiveStockBatch(db, [{ newProduct: { name: "Duplicate", sku: "BAR-NEW", barcode: "12345678", price: 20 }, purchaseQty: 1, paidAmount: 1 }], "Operator")).toThrow();
      expect(() => receiveStockBatch(db, [{ newProduct: { name: "Fraction", sku: "FRACTION", price: 20 }, purchaseQty: 1.5, paidAmount: 1 }], "Operator")).toThrow();
      expect(db.prepare("SELECT id FROM products WHERE sku IN ('BAR-NEW', 'FRACTION')").all()).toHaveLength(0);
    } finally { db.close(); }
  });
});