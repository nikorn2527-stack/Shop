import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportSellingValue } from "../shared/reportValuation";
import {
  checkout,
  createProduct,
  createSqliteStore,
  dailySalesRows,
  formatDateTime,
  listOrderItems,
  addOrderItem,
  receiveStockLines,
  salesByProduct,
  stockBalanceReport,
  stockReceiptHistory,
  voidSale,
  type SqliteDb,
} from "./sqliteStore";
let db: SqliteDb;
beforeEach(() => {
  db = createSqliteStore();
});
afterEach(() => db.close());
const range = () => ({
  from: formatDateTime().slice(0, 10),
  to: formatDateTime().slice(0, 10),
});
describe("general report valuation versus financial cost", () => {
  it("sorts stock reports by displayed product code naturally, preserving leading zeros", () => {
    for(const code of ["02","01","10","5","8850000000017"]) createProduct(db,{name:`Code ${code}`,sku:`SKU-${code}`,barcode:code,price:10});
    const rows=stockBalanceReport(db,range());
    expect(rows.map(row=>row.code)).toEqual(["01","02","5","10","8850000000017"]);
    expect(rows.find(row=>row.code==="01")?.barcode).toBe("01");
    expect(stockBalanceReport(db,{...range(),search:"Code 0"}).map(row=>row.code)).toEqual(["01","02"]);
  });

  it("values inventory, receipts and order quantities at selling prices while profit retains real cost", () => {
    const product = createProduct(db, {
      name: "Report basis",
      price: 20,
      cost: 4,
      stock: 0,
    });
    receiveStockLines(db, {
      productId: product.id,
      paidAmount: 40,
      lines: [{ qty: 10, cost: 4 }],
    });
    checkout(db, {
      items: [{ productId: product.id, qty: 2 }],
      paymentMethod: "เงินสด",
    });
    const costsBefore = db.prepare("SELECT * FROM stock_lots").all();
    const receipt = stockReceiptHistory(db, range())[0];
    expect(reportSellingValue(receipt.receivedQty!, receipt.sellingPrice)).toBe(
      200
    );
    expect(receipt.cost).toBe(4); // Actual source values are kept for audit, not overwritten with retail prices.
    expect(stockBalanceReport(db, range())[0]).toMatchObject({
      remaining: 8,
      sellingPrice: 20,
      sellingValue: 160,
      sold: 2,
    });
    addOrderItem(db, { productId: product.id, qty: 3 });
    const item = listOrderItems(db)[0];
    expect(item).toMatchObject({ cost: 4, sellingPrice: 20, qty: 3 });
    expect(reportSellingValue(item.qty, item.sellingPrice)).toBe(60);
    expect(dailySalesRows(db, range())[0]).toMatchObject({
      revenue: 40,
      cogs: 8,
      profit: 32,
    });
    expect(salesByProduct(db, range())[0]).toMatchObject({
      revenue: 40,
      cogs: 8,
      profit: 32,
    });
    expect(db.prepare("SELECT * FROM stock_lots").all()).toEqual(costsBefore);
  });
  it("uses selling price for unknown cost in profit without changing stored catalog or bill costs", () => {
    const p = createProduct(db, {
      name: "No cost",
      price: 20,
      cost: 0,
      stock: 5,
    });
    checkout(db, {
      items: [{ productId: p.id, qty: 2 }],
      paymentMethod: "เงินสด",
    });
    expect(salesByProduct(db, range())[0]).toMatchObject({
      revenue: 40,
      cogs: 40,
      profit: 0,
    });
    expect(
      db.prepare("SELECT cost FROM products WHERE id=?").get(p.id)
    ).toMatchObject({ cost: 0 });
    expect(
      db.prepare("SELECT cost FROM sale_items WHERE product_id=?").get(p.id)
    ).toMatchObject({ cost: 0 });
  });
  it("does not count voided sales when reconstructing report quantities and selling values", () => {
    const p = createProduct(db, {
      name: "Voided",
      price: 20,
      cost: 4,
      stock: 10,
    });
    checkout(db, {
      items: [{ productId: p.id, qty: 2 }],
      paymentMethod: "เงินสด",
    });
    const sale = db.prepare("SELECT id FROM sales").get() as { id: number };
    voidSale(db, { saleId: sale.id, reason: "Canceled test" });
    expect(stockBalanceReport(db, range())[0]).toMatchObject({
      sold: 0,
      opening: 10,
      remaining: 10,
      sellingValue: 200,
    });
  });
  it("rounds each extended selling value and does not substitute cost for a zero selling price", () => {
    expect(reportSellingValue(3, 1.25)).toBe(3.75);
    expect(reportSellingValue(10, 0)).toBe(0);
    expect(reportSellingValue(10, undefined)).toBe(0);
    expect(reportSellingValue(10, 11.5)).toBe(115);
  });
});
