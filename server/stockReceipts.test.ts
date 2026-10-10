import { describe, expect, it } from "vitest";
import { createSqliteStore, createProduct, receiveStockLines, stockReceiptHistory } from "./sqliteStore";

describe("stock receipt history", () => {
  it("allocates separate automatic lots to different receipt entries and retains supplier lots", () => {
    const db = createSqliteStore();
    try {
      const a = createProduct(db, { name: "Lot A", sku: "LOT-A", price: 20 });
      const b = createProduct(db, { name: "Lot B", sku: "LOT-B", price: 30 });
      receiveStockLines(db, { productId: a.id, lines: [{ qty: 2, cost: 5 }] });
      receiveStockLines(db, { productId: b.id, lines: [{ qty: 3, cost: 8 }] });
      receiveStockLines(db, { productId: a.id, lot: "SUPPLIER-42", lines: [{ qty: 1, cost: 6 }] });
      const lots = db.prepare("SELECT lot FROM stock_lots ORDER BY id").all() as unknown as { lot: string }[];
      expect(lots[0].lot).toMatch(/^LOT-\d{4}-\d{2}-\d{2}-\d{4}$/);
      expect(lots[1].lot).not.toBe(lots[0].lot);
      expect(lots[2].lot).toBe("SUPPLIER-42");
    } finally { db.close(); }
  });
  it("links paid and free lines to their lots and preserves history after stock changes", () => {
    const db = createSqliteStore();
    try {
      const product = createProduct(db, { name: "Receipt test", sku: "RECEIPT-TEST", unit: "ขวด", price: 15, cost: 8 });
      receiveStockLines(db, { productId: product.id, lot: "TEST-LOT", actor: "Receiver", lines: [{ qty: 10, cost: 5 }, { qty: 2, cost: 0 }] });
      db.prepare("UPDATE stock_lots SET qty = 0 WHERE product_id = ?").run(product.id);
      const rows = stockReceiptHistory(db, { search: "TEST-LOT", actor: "Receiver" });
      expect(rows).toHaveLength(2);
      expect(rows.reduce((sum, row) => sum + row.receivedQty, 0)).toBe(12);
      expect(rows.reduce((sum, row) => sum + (row.value ?? 0), 0)).toBe(50);
      expect(rows.reduce((sum, row) => sum + row.sellingValue, 0)).toBe(180);
      expect(rows.every(row => row.sellingPrice === 15)).toBe(true);
      expect(rows.every(row => row.actor === "Receiver")).toBe(true);
      expect(stockReceiptHistory(db, { from: "2099-01-01" })).toHaveLength(0);
      expect(stockReceiptHistory(db, { search: "missing" })).toHaveLength(0);
    } finally { db.close(); }
  });
  it("does not guess the receiving operator or purchase value for legacy lots", () => {
    const db = createSqliteStore();
    try {
      const product = createProduct(db, { name: "Legacy", sku: "LEGACY-RECEIPT", unit: "ชิ้น", price: 10 });
      db.prepare("INSERT INTO stock_lots (product_id, lot, qty, cost, received_qty, received_at) VALUES (?, 'OLD', 2, 5, 2, '2020-01-01 10:00:00')").run(product.id);
      expect(stockReceiptHistory(db, { to: "2020-01-01" })[0]).toMatchObject({ actor: null, value: null });
    } finally { db.close(); }
  });
});