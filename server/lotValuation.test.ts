import { afterEach, describe, expect, it } from "vitest";
import { checkout, createProduct, createSqliteStore, dailySalesRows, receiveStockLines, stockCountLots, voidSale, type SqliteDb } from "./sqliteStore";

let db: SqliteDb;
afterEach(() => db?.close());
function setup() {
  db = createSqliteStore();
  return createProduct(db, { name: "Lot valuation audit", price: 10, stock: 0, cost: 0 });
}
function remainingValue() {
  return (db.prepare("SELECT SUM(remaining_value_satang) AS value FROM stock_lots").get() as { value: number }).value;
}
describe("recorded lot cost and reversals", () => {
  it("preserves the exact paid value including free units across lots and reverses the original allocations", () => {
    const product = setup();
    receiveStockLines(db, { productId: product.id, lot: "A", paidAmount: 100, lines: [{ qty: 20, cost: 5 }, { qty: 2, cost: 0 }] });
    receiveStockLines(db, { productId: product.id, lot: "B", paidAmount: 60, lines: [{ qty: 10, cost: 6 }] });
    expect(remainingValue()).toBe(16000);
    checkout(db, { items: [{ productId: product.id, qty: 25 }], paymentMethod: "เงินสด" });
    const sale = db.prepare("SELECT id, substr(created_at, 1, 10) AS date FROM sales").get() as { id: number; date: string };
    expect(remainingValue()).toBe(4200);
    const costs = db.prepare("SELECT SUM(cost_satang) AS cost, SUM(qty) AS qty FROM sale_lot_allocations").get();
    expect(costs).toMatchObject({ cost: 11800, qty: 25 });
    expect(dailySalesRows(db, { from: sale.date, to: sale.date })[0]).toMatchObject({ revenue: 250, cogs: 118, profit: 132 });
    voidSale(db, { saleId: sale.id, reason: "Audit reversal" });
    expect(remainingValue()).toBe(16000);
    expect(dailySalesRows(db, { from: sale.date, to: sale.date })[0]).toMatchObject({ revenue: 0, cogs: 0 });
    expect(() => voidSale(db, { saleId: sale.id, reason: "Duplicate" })).toThrow();
    expect(remainingValue()).toBe(16000);
  });
  it("consumes all residual satang when a lot sells out one unit at a time", () => {
    const product = setup();
    receiveStockLines(db, { productId: product.id, paidAmount: 100, lines: [{ qty: 22, cost: 100 / 22 }] });
    for (let i = 0; i < 22; i++) checkout(db, { items: [{ productId: product.id, qty: 1 }], paymentMethod: "เงินสด" });
    expect(remainingValue()).toBe(0);
    expect(db.prepare("SELECT SUM(cost_total_satang) AS cost FROM sale_items").get()).toMatchObject({ cost: 10000 });
  });
  it("records counted loss separately and blocks an unvalued surplus", () => {
    const product = setup();
    const receipt = receiveStockLines(db, { productId: product.id, paidAmount: 100, lines: [{ qty: 22, cost: 100 / 22 }] });
    stockCountLots(db, { counts: [{ lotId: receipt.lot.id, countedQty: 21 }], note: "Audit loss" });
    const adjustment = db.prepare("SELECT value_delta_satang AS value FROM lot_value_adjustments").get() as { value: number };
    expect(remainingValue() - adjustment.value).toBe(10000);
    expect(() => stockCountLots(db, { counts: [{ lotId: receipt.lot.id, countedQty: 23 }] })).toThrow();
    expect(remainingValue() - adjustment.value).toBe(10000);
  });
});