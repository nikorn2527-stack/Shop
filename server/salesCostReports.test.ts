import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkout, createProduct, createSqliteStore, dailySalesRows, receiveStockLines, salesByCashier, salesByCategory, salesByProduct, updateProduct, type SqliteDb } from "./sqliteStore";

let db: SqliteDb;
beforeEach(() => { db = createSqliteStore(); });
afterEach(() => db.close());
function range() {
  const sale = db.prepare("SELECT substr(created_at, 1, 10) AS date FROM sales LIMIT 1").get() as { date: string };
  return { from: sale.date, to: sale.date };
}
function costAcrossReports() {
  const dates = range();
  return [dailySalesRows(db, dates)[0].cogs, salesByProduct(db, dates)[0].cogs, salesByCategory(db, dates)[0].cogs, salesByCashier(db, dates)[0].cogs];
}

describe("sale quantity and recorded cost reports", () => {
  it("counts the cost of a two-unit sale exactly once", () => {
    const product = createProduct(db, { name: "Two-unit sale", price: 20, cost: 17, stock: 10 });
    checkout(db, { items: [{ productId: product.id, qty: 2 }], paymentMethod: "เงินสด" });
    expect(costAcrossReports()).toEqual([34, 34, 34, 34]);
    expect(dailySalesRows(db, range())[0]).toMatchObject({ revenue: 40, cogs: 34, profit: 6 });
    expect(salesByProduct(db, range())[0]).toMatchObject({ qty: 2, revenue: 40, cogs: 34, profit: 6 });
  });

  it("uses documented zero-cost receipts instead of inventing a loss after discount", () => {
    const product = createProduct(db, { name: "Documented free stock", price: 20, cost: 0, stock: 0 });
    receiveStockLines(db, { productId: product.id, paidAmount: 0, lines: [{ qty: 2, cost: 0 }] });
    checkout(db, { items: [{ productId: product.id, qty: 2 }], paymentMethod: "เงินสด", discount: 1 });
    expect(costAcrossReports()).toEqual([0, 0, 0, 0]);
    expect(dailySalesRows(db, range())[0]).toMatchObject({ revenue: 39, cogs: 0, profit: 39 });
    expect(salesByCashier(db, range())[0]).toMatchObject({ total: 39, cogs: 0, profit: 39 });
  });

  it("uses the original lot allocation when the catalog cost was later cleared", () => {
    const product = createProduct(db, { name: "Receipt cost snapshot", price: 20, cost: 0, stock: 0 });
    receiveStockLines(db, { productId: product.id, paidAmount: 34, lines: [{ qty: 2, cost: 17 }] });
    updateProduct(db, { productId: product.id, cost: 0 });
    checkout(db, { items: [{ productId: product.id, qty: 2 }], paymentMethod: "เงินสด", discount: 1 });
    expect(costAcrossReports()).toEqual([34, 34, 34, 34]);
    expect(dailySalesRows(db, range())[0]).toMatchObject({ revenue: 39, cogs: 34, profit: 5 });
  });

  it("retains exact receipt satang even when the unit cost rounds down to zero", () => {
    const product = createProduct(db, { name: "Fractional receipt cost", price: 20, cost: 0, stock: 0 });
    receiveStockLines(db, { productId: product.id, paidAmount: 0.01, lines: [{ qty: 3, cost: 0.01 / 3 }] });
    checkout(db, { items: [{ productId: product.id, qty: 2 }], paymentMethod: "เงินสด", discount: 1 });
    expect(costAcrossReports()).toEqual([0.01, 0.01, 0.01, 0.01]);
    expect(dailySalesRows(db, range())[0]).toMatchObject({ revenue: 39, profit: 38.99 });
  });

  it("keeps unknown legacy costs estimated and preserves genuine losses", () => {
    const unknown = createProduct(db, { name: "Unknown cost", price: 20, cost: 0, stock: 2 });
    checkout(db, { items: [{ productId: unknown.id, qty: 2 }], paymentMethod: "เงินสด" });
    expect(costAcrossReports()).toEqual([40, 40, 40, 40]);
    const expensive = createProduct(db, { name: "Sold below cost", price: 20, cost: 25, stock: 2 });
    checkout(db, { items: [{ productId: expensive.id, qty: 2 }], paymentMethod: "เงินสด" });
    expect(salesByProduct(db, range()).find(row => row.productId === expensive.id)).toMatchObject({ revenue: 40, cogs: 50, profit: -10 });
  });

  it("does not treat partly documented zero-cost stock as fully costed", () => {
    const product = createProduct(db, { name: "Mixed legacy and received stock", price: 20, cost: 0, stock: 1 });
    db.prepare("INSERT INTO stock_lots (product_id, lot, qty, cost, received_at) VALUES (?, 'legacy-opening', 1, 0, '2020-01-01 00:00:00')").run(product.id);
    receiveStockLines(db, { productId: product.id, paidAmount: 0, lines: [{ qty: 1, cost: 0 }] });
    checkout(db, { items: [{ productId: product.id, qty: 2 }], paymentMethod: "เงินสด" });
    expect(db.prepare("SELECT SUM(qty) AS qty FROM sale_lot_allocations WHERE valuation_source='receipt'").get()).toMatchObject({ qty: 1 });
    expect(costAcrossReports()).toEqual([40, 40, 40, 40]);
  });
});
