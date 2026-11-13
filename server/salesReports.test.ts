import { afterEach, describe, expect, it } from "vitest";
import {
  checkout, createProduct, createSqliteStore, dailySalesRows, receiveStockLines,
  salesByCashier, salesByCategory, salesByProduct, salesLineItems, voidSale,
  type SqliteDb,
} from "./sqliteStore";

let db: SqliteDb;
afterEach(() => db?.close());

describe("sales report aggregation", () => {
  it("combines product lines within a bill across prices and lots while all five modes reconcile", () => {
    db = createSqliteStore();
    const product = createProduct(db, { name: "น้ำ", sku: "REPORT-1", category: "เครื่องดื่ม", unit: "ขวด", price: 10, stock: 0, sellMode: "money", priceTiers: JSON.stringify([{ label: "สิบ", price: 10, qty: 1 }, { label: "สิบสอง", price: 12, qty: 1 }, { label: "สิบเอ็ด", price: 11, qty: 1 }]) });
    receiveStockLines(db, { productId: product.id, lot: "A", paidAmount: 12, lines: [{ qty: 3, cost: 4 }] });
    receiveStockLines(db, { productId: product.id, lot: "B", paidAmount: 120, lines: [{ qty: 20, cost: 6 }] });
    const first = checkout(db, {
      items: [
        { productId: product.id, qty: 2, price: 10, label: "สิบ" },
        { productId: product.id, qty: 2, price: 12, label: "สิบสอง" },
        { name: "บริการ", qty: 1, price: 3 },
        { name: "บริการ", qty: 1, price: 4 },
      ], paymentMethod: "เงินสด", cashier: "A",
    });
    checkout(db, { items: [{ productId: product.id, qty: 1, price: 11, label: "สิบเอ็ด" }], paymentMethod: "เงินสด", cashier: "B" });
    const cancelled = checkout(db, { items: [{ productId: product.id, qty: 1, price: 10, label: "สิบ" }], paymentMethod: "เงินสด", cashier: "A" });
    const cancelledId = (db.prepare("SELECT id FROM sales WHERE order_number = ?").get(cancelled.orderNumber) as { id: number }).id;
    voidSale(db, { saleId: cancelledId, reason: "Report regression" });
    const before = db.prepare("SELECT * FROM sale_items ORDER BY id").all();

    expect(salesByProduct(db).find(row => row.productId === product.id)).toMatchObject({ bills: 2, qty: 5, revenue: 55, cogs: 24, profit: 31, priceMin: 10, priceMax: 12 });
    const lines = salesLineItems(db);
    expect(lines.filter(row => row.orderNumber === first.orderNumber && row.productCode === "REPORT-1")).toEqual([
      expect.objectContaining({ qty: 4, price: 11, priceMin: 10, priceMax: 12, amount: 44, unit: "ขวด" }),
    ]);
    expect(lines.filter(row => row.productName === "บริการ")).toHaveLength(2);
    expect(lines.some(row => row.orderNumber === cancelled.orderNumber)).toBe(false);
    expect(lines.reduce((sum, row) => sum + row.qty, 0)).toBe(7);
    expect(lines.reduce((sum, row) => sum + row.amount, 0)).toBe(62);
    expect(dailySalesRows(db, 1)[0]).toMatchObject({ orders: 2, items: 7, revenue: 62, cogs: 24, profit: 38 });
    const categories = salesByCategory(db);
    expect(categories.reduce((sum, row) => sum + row.revenue, 0)).toBe(62);
    expect(categories.reduce((sum, row) => sum + row.cogs, 0)).toBe(24);
    expect(salesByCashier(db)).toEqual([
      expect.objectContaining({ cashier: "A", orders: 1, items: 6, total: 51, cogs: 18, profit: 33 }),
      expect.objectContaining({ cashier: "B", orders: 1, items: 1, total: 11, cogs: 6, profit: 5 }),
    ]);
    expect(salesLineItems(db, { cashiers: ["A"], categories: ["เครื่องดื่ม"] })).toEqual([
      expect.objectContaining({ qty: 4, amount: 44, priceMin: 10, priceMax: 12 }),
    ]);
    expect(salesByProduct(db, { cashiers: ["A"], categories: ["เครื่องดื่ม"] })[0]).toMatchObject({ bills: 1, qty: 4, revenue: 44, cogs: 18 });
    expect(dailySalesRows(db, { days: 1, cashiers: ["A"], categories: ["เครื่องดื่ม"] })[0]).toMatchObject({ orders: 1, items: 4, revenue: 44, cogs: 18 });
    expect(salesByCashier(db, { cashiers: ["A"], categories: ["เครื่องดื่ม"] })[0]).toMatchObject({ orders: 1, items: 4, total: 44, cogs: 18 });
    expect(salesByCategory(db, { cashiers: ["A"], categories: ["เครื่องดื่ม"] })[0]).toMatchObject({ orders: 1, qty: 4, revenue: 44, cogs: 18 });
    expect(db.prepare("SELECT * FROM sale_items ORDER BY id").all()).toEqual(before);
  });

  it("keeps different product IDs and historical units separate even when names match", () => {
    db = createSqliteStore();
    const a = createProduct(db, { name: "สินค้า", sku: "REPORT-A", price: 10, stock: 10, sellMode: "money", priceTiers: JSON.stringify([{ label: "ชิ้น", price: 10, qty: 1 }, { label: "กล่อง", price: 10, qty: 1 }]) });
    const b = createProduct(db, { name: "สินค้า", sku: "REPORT-B", price: 10, stock: 10 });
    checkout(db, { items: [
      { productId: a.id, qty: 1, price: 10, label: "ชิ้น" },
      { productId: a.id, qty: 2, price: 10, label: "กล่อง" },
      { productId: b.id, qty: 1, unit: "ชิ้น" },
    ], paymentMethod: "เงินสด" });
    // Imported history can carry different unit snapshots for the same product.
    db.prepare("UPDATE sale_items SET unit = 'กล่อง' WHERE product_id = ? AND qty = 2").run(a.id);
    expect(salesLineItems(db)).toEqual([
      expect.objectContaining({ productCode: "REPORT-A", unit: "ชิ้น", qty: 1 }),
      expect.objectContaining({ productCode: "REPORT-A", unit: "กล่อง", qty: 2 }),
      expect.objectContaining({ productCode: "REPORT-B", unit: "ชิ้น", qty: 1 }),
    ]);
    expect(salesByProduct(db)).toHaveLength(2);
  });

  it("preserves mixed-tier historical names and amounts after a catalog rename", () => {
    db = createSqliteStore();
    const product = createProduct(db, {
      name: "สินค้า", price: 10, stock: 10, sellMode: "money",
      priceTiers: JSON.stringify([{ label: "A", price: 10, qty: 1 }, { label: "B", price: 12, qty: 1 }]),
    });
    checkout(db, { items: [
      { productId: product.id, qty: 1, price: 10, label: "A" },
      { productId: product.id, qty: 1, price: 12, label: "B" },
    ], paymentMethod: "เงินสด" });
    // Historical rounding/adjustments are authoritative even when qty*price differs.
    db.prepare("UPDATE sale_items SET amount = CASE price WHEN 10 THEN 9.99 ELSE 11.98 END").run();
    db.prepare("UPDATE products SET price = 99, name = 'ชื่อใหม่'").run();
    expect(salesLineItems(db)).toEqual([
      expect.objectContaining({ productName: "สินค้า", qty: 2, price: 11, priceMin: 10, priceMax: 12, amount: 21.97 }),
    ]);
    expect(salesByProduct(db)[0]).toMatchObject({ qty: 2, bills: 1, revenue: 21.97, priceMin: 10, priceMax: 12 });
  });

  it("retains a consistent historical name after a catalog rename and rounds monetary sums", () => {
    db = createSqliteStore();
    const product = createProduct(db, { name: "ชื่อเดิม", price: 10, stock: 10 });
    checkout(db, { items: [{ productId: product.id, qty: 2 }], paymentMethod: "เงินสด" });
    // Older/imported bills can split the same product into otherwise identical lines.
    db.prepare("UPDATE sale_items SET qty = 1, amount = 0.1").run();
    db.prepare("INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, unit, amount) SELECT sale_id, product_id, name, 1, price, cost, unit, 0.2 FROM sale_items").run();
    db.prepare("UPDATE products SET name = 'ชื่อใหม่' WHERE id = ?").run(product.id);
    expect(salesLineItems(db)).toEqual([
      expect.objectContaining({ productName: "ชื่อเดิม", qty: 2, amount: 0.3 }),
    ]);
  });
});
