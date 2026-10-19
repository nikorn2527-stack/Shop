import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkout,
  createProduct,
  createSqliteStore,
  formatDateTime,
  receiveStockLines,
  seedSqliteDemoData,
  voidSale,
  type SqliteDb,
} from "./sqliteStore";
import { importProducts } from "./importTool";
import {
  importOpeningStock,
  previewOpeningStock,
  type OpeningStockOptions,
} from "./openingStockImport";

let db: SqliteDb;
beforeEach(() => {
  db = createSqliteStore();
});
afterEach(() => db.close());
function fixture() {
  const product = createProduct(db, {
    name: "สินค้าเดิม",
    barcode: "01",
    sku: "OLD-01",
    price: 5,
    cost: 11.5,
    stock: 0,
  });
  receiveStockLines(db, {
    productId: product.id,
    paidAmount: 575,
    lines: [{ qty: 50, cost: 11.5 }],
  });
  checkout(db, {
    items: [{ productId: product.id, qty: 2 }],
    paymentMethod: "เงินสด",
  });
  return product;
}
function options(
  rows = [["01", "สินค้าใหม่", "5", "100"]]
): OpeningStockOptions {
  return {
    rows,
    mapping: { barcode: 0, name: 1, price: 2, stock: 3 },
    duplicateMode: "replace",
  };
}
function apply(input = options()) {
  const review = previewOpeningStock(db, input);
  return importOpeningStock(db, {
    ...input,
    openingDate: review.openingDate,
    stockPreviewToken: review.stockPreviewToken,
  });
}
function stock(id: number) {
  return {
    product: (
      db.prepare("SELECT stock FROM products WHERE id=?").get(id) as {
        stock: number;
      }
    ).stock,
    lots: (
      db
        .prepare(
          "SELECT COALESCE(SUM(qty),0) AS qty FROM stock_lots WHERE product_id=?"
        )
        .get(id) as { qty: number }
    ).qty,
  };
}
function history() {
  return [
    "sales",
    "sale_items",
    "sale_lot_allocations",
    "members",
    "member_transactions",
  ].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
}

describe("opening inventory imported before today's sales", () => {
  it("previews without writes, keeps bills and wallets byte-for-byte, and reconciles both stock totals", () => {
    seedSqliteDemoData(db);
    const p = fixture();
    const before = history();
    const beforeLots = db
      .prepare("SELECT * FROM stock_lots WHERE product_id=?")
      .all(p.id);
    const review = previewOpeningStock(db, options());
    expect(review.errors).toEqual([]);
    expect(review.stockAdjustments[0]).toMatchObject({
      productId: p.id,
      barcode: "01",
      previousQty: 48,
      openingQty: 100,
      soldTodayQty: 2,
      remainingQty: 98,
      cost: 0,
      price: 5,
    });
    expect(stock(p.id)).toEqual({ product: 48, lots: 48 });
    expect(
      db.prepare("SELECT * FROM stock_lots WHERE product_id=?").all(p.id)
    ).toEqual(beforeLots);
    apply();
    expect(stock(p.id)).toEqual({ product: 98, lots: 98 });
    expect(history()).toEqual(before);
    expect(
      db.prepare("SELECT id,sku,price,cost FROM products WHERE id=?").get(p.id)
    ).toMatchObject({ id: p.id, sku: "OLD-01", price: 5, cost: 0 });
    expect(
      db
        .prepare(
          "SELECT received_value_satang,remaining_value_satang FROM stock_lots WHERE product_id=? ORDER BY id LIMIT 1"
        )
        .get(p.id)
    ).toMatchObject({
      received_value_satang: 57500,
      remaining_value_satang: 0,
    });
    expect(
      db
        .prepare(
          "SELECT value_delta_satang FROM lot_value_adjustments ORDER BY id DESC LIMIT 1"
        )
        .get()
    ).toMatchObject({ value_delta_satang: -55200 });
  });
  it("does not subtract twice on repeat import and can sell normally afterwards", () => {
    const p = fixture();
    apply();
    apply();
    expect(stock(p.id)).toEqual({ product: 98, lots: 98 });
    checkout(db, {
      items: [{ productId: p.id, qty: 1 }],
      paymentMethod: "เงินสด",
    });
    expect(stock(p.id)).toEqual({ product: 97, lots: 97 });
    apply();
    expect(stock(p.id)).toEqual({ product: 97, lots: 97 });
  });
  it("can void the original bill after replacement because allocation lot IDs survive", () => {
    const p = fixture();
    const sale = db.prepare("SELECT id FROM sales").get() as { id: number };
    apply();
    voidSale(db, { saleId: sale.id, reason: "คืนบิลเดิม" });
    expect(stock(p.id)).toEqual({ product: 100, lots: 100 });
    expect(
      previewOpeningStock(db, options()).stockAdjustments[0].soldTodayQty
    ).toBe(0);
    apply();
    expect(stock(p.id)).toEqual({ product: 100, lots: 100 });
  });
  it("deducts only today and excludes voided sales", () => {
    const p = fixture();
    db.prepare("UPDATE sales SET created_at='2020-01-01 12:00:00'").run();
    checkout(db, {
      items: [{ productId: p.id, qty: 3 }],
      paymentMethod: "เงินสด",
    });
    const sale = db
      .prepare("SELECT id FROM sales ORDER BY id DESC LIMIT 1")
      .get() as { id: number };
    voidSale(db, { saleId: sale.id, reason: "ยกเลิก" });
    expect(
      previewOpeningStock(db, options()).stockAdjustments[0]
    ).toMatchObject({ soldTodayQty: 0, remainingQty: 100 });
  });
  it("refuses a stale preview after another sale without changing any row", () => {
    const p = fixture();
    const input = options();
    const review = previewOpeningStock(db, input);
    checkout(db, {
      items: [{ productId: p.id, qty: 1 }],
      paymentMethod: "เงินสด",
    });
    const before = history();
    expect(() =>
      importOpeningStock(db, {
        ...input,
        stockPreviewToken: review.stockPreviewToken,
      })
    ).toThrow("ข้อมูลเปลี่ยน");
    expect(stock(p.id)).toEqual({ product: 47, lots: 47 });
    expect(history()).toEqual(before);
    apply();
    expect(stock(p.id)).toEqual({ product: 97, lots: 97 });
  });
  it("rejects an entire file when one opening quantity is below today's sales", () => {
    const p = fixture();
    const input = options([
      ["99", "สินค้าใหม่", "10", "20"],
      ["01", "สินค้าเดิม", "5", "1"],
    ]);
    const review = previewOpeningStock(db, input);
    expect(review.errors[0].message).toContain("น้อยกว่ายอดขาย");
    expect(() =>
      importOpeningStock(db, {
        ...input,
        stockPreviewToken: review.stockPreviewToken,
      })
    ).toThrow("ยังไม่นำเข้า");
    expect(
      db.prepare("SELECT id FROM products WHERE barcode='99'").get()
    ).toBeUndefined();
    expect(stock(p.id)).toEqual({ product: 48, lots: 48 });
  });
  it.each(["", "#N/A", "-1", "1.5"])(
    "rejects invalid or missing opening count %s",
    value => {
      fixture();
      expect(
        previewOpeningStock(db, options([["01", "สินค้า", "5", value]])).errors
      ).toHaveLength(1);
    }
  );
  it("never matches by name alone, preserves leading zero codes, and leaves absent products untouched", () => {
    const p = fixture();
    const bad = previewOpeningStock(
      db,
      options([["—", "สินค้าเดิม", "5", "100"]])
    );
    expect(bad.errors).toHaveLength(1);
    apply(options([["02", "สินค้าเดิม", "20", "10"]]));
    const created = db
      .prepare("SELECT id,barcode,cost,price FROM products WHERE barcode='02'")
      .get() as { id: number };
    expect(created).toMatchObject({ barcode: "02", cost: 0, price: 20 });
    expect(stock(created.id)).toEqual({ product: 10, lots: 10 });
    expect(stock(p.id)).toEqual({ product: 48, lots: 48 });
  });
  it("rejects conflicting identifiers and duplicate rows", () => {
    fixture();
    createProduct(db, {
      name: "อีกชิ้น",
      barcode: "02",
      sku: "OTHER",
      price: 10,
    });
    const input = {
      ...options(),
      rows: [["01", "สินค้า", "5", "100", "OTHER"]],
      mapping: { ...options().mapping, sku: 4 },
    };
    expect(previewOpeningStock(db, input).errors[0].message).toContain(
      "หลายรายการ"
    );
    expect(
      previewOpeningStock(
        db,
        options([
          ["01", "สินค้า", "5", "100"],
          ["01", "ซ้ำ", "5", "100"],
        ])
      ).errors
    ).toHaveLength(1);
  });
  it("requires review and expires yesterday's preview", () => {
    fixture();
    expect(() => importOpeningStock(db, options())).toThrow("พรีวิว");
    expect(() =>
      previewOpeningStock(db, { ...options(), openingDate: "2020-01-01" })
    ).toThrow("วันที่เปลี่ยน");
    expect(previewOpeningStock(db, options()).openingDate).toBe(
      formatDateTime().slice(0, 10)
    );
  });
  it("also reconciles lots when the file contains current remaining stock", () => {
    const p = fixture();
    const before = history();
    const result = importProducts(db, options());
    expect(result.errors).toEqual([]);
    expect(stock(p.id)).toEqual({ product: 100, lots: 100 });
    expect(history()).toEqual(before);
    checkout(db, {
      items: [{ productId: p.id, qty: 1 }],
      paymentMethod: "เงินสด",
    });
    expect(stock(p.id)).toEqual({ product: 99, lots: 99 });
  });
  it("rolls back earlier rows if writing a later row fails", () => {
    const p = fixture();
    const input = options([
      ["99", "สินค้าใหม่", "10", "20"],
      ["01", "สินค้าเดิม", "5", "100"],
    ]);
    const review = previewOpeningStock(db, input);
    db.exec(
      "CREATE TRIGGER reject_import BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT, 'test write failure'); END"
    );
    expect(() =>
      importOpeningStock(db, {
        ...input,
        stockPreviewToken: review.stockPreviewToken,
      })
    ).toThrow("test write failure");
    expect(
      db.prepare("SELECT id FROM products WHERE barcode='99'").get()
    ).toBeUndefined();
    expect(stock(p.id)).toEqual({ product: 48, lots: 48 });
  });
  it("uses only explicitly supplied costs for replacement inventory", () => {
    const p = fixture();
    apply({
      ...options(),
      rows: [["01", "สินค้า", "5", "100", "3.25"]],
      mapping: { ...options().mapping, cost: 4 },
    });
    expect(
      db.prepare("SELECT cost FROM products WHERE id=?").get(p.id)
    ).toMatchObject({ cost: 3.25 });
    expect(
      db
        .prepare("SELECT cost FROM stock_lots WHERE product_id=? AND qty>0")
        .get(p.id)
    ).toMatchObject({ cost: 3.25 });
    expect(
      db.prepare("SELECT cost FROM sale_items WHERE product_id=?").get(p.id)
    ).toMatchObject({ cost: 11.5 });
  });
});
