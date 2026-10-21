import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkout,
  createProduct,
  createSqliteStore,
  dailySalesRows,
  formatDateTime,
  salesByCashier,
  salesByCategory,
  salesByProduct,
  salesLineItems,
  stockBalanceReport,
  type SqliteDb,
} from "./sqliteStore";

let db: SqliteDb;

beforeEach(() => {
  db = createSqliteStore();
});

afterEach(() => db.close());

const todayRange = () => {
  const today = formatDateTime().slice(0, 10);
  return { from: today, to: today };
};

describe("product-category report filters", () => {
  it("applies multiple categories consistently across sales drilldowns and stock", () => {
    const drink = createProduct(db, {
      name: "น้ำทดสอบ",
      sku: "CAT-DRINK",
      category: "เครื่องดื่ม",
      unit: "ขวด",
      price: 10,
      cost: 4,
      stock: 20,
    });
    const snack = createProduct(db, {
      name: "ขนมทดสอบ",
      sku: "CAT-SNACK",
      category: "ขนม",
      unit: "ห่อ",
      price: 15,
      cost: 6,
      stock: 20,
    });
    const food = createProduct(db, {
      name: "อาหารทดสอบ",
      sku: "CAT-FOOD",
      category: "อาหาร",
      unit: "กล่อง",
      price: 40,
      cost: 20,
      stock: 20,
    });

    checkout(db, {
      items: [
        { productId: drink.id, qty: 2 },
        { productId: snack.id, qty: 1 },
        { productId: food.id, qty: 1 },
      ],
      paymentMethod: "เงินสด",
      cashier: "พนักงานทดสอบ",
    });

    const input = { ...todayRange(), categories: ["เครื่องดื่ม", "ขนม"] };
    expect(dailySalesRows(db, input)[0]).toMatchObject({
      orders: 1,
      items: 3,
      revenue: 35,
      cogs: 14,
      profit: 21,
    });
    expect(salesByCategory(db, input).map(row => row.category)).toEqual([
      "เครื่องดื่ม",
      "ขนม",
    ]);
    expect(
      salesByProduct(db, input)
        .map(row => row.productId)
        .sort()
    ).toEqual([drink.id, snack.id].sort());
    expect(
      salesLineItems(db, input)
        .map(row => row.productName)
        .sort()
    ).toEqual(["ขนมทดสอบ", "น้ำทดสอบ"].sort());
    expect(salesByCashier(db, input)[0]).toMatchObject({
      cashier: "พนักงานทดสอบ",
      orders: 1,
      items: 3,
      discount: 0,
      total: 35,
      cogs: 14,
      profit: 21,
    });
    expect(
      stockBalanceReport(db, input)
        .map(row => row.productId)
        .sort()
    ).toEqual([drink.id, snack.id].sort());
  });

  it("includes legacy household categories when filtering by the normalized ของใช้ label", () => {
    const personal = createProduct(db, {
      name: "ของใช้ส่วนตัวเดิม",
      sku: "CAT-LEGACY-PERSONAL",
      category: "ของใช้ส่วนตัว",
      price: 20,
      cost: 8,
      stock: 5,
    });
    const household = createProduct(db, {
      name: "ของใช้ครัวเรือนเดิม",
      sku: "CAT-LEGACY-HOUSE",
      category: "ของใช้ในครัวเรือน",
      price: 30,
      cost: 12,
      stock: 5,
    });
    checkout(db, {
      items: [
        { productId: personal.id, qty: 1 },
        { productId: household.id, qty: 1 },
      ],
      paymentMethod: "เงินสด",
    });

    const input = { ...todayRange(), categories: ["ของใช้"] };
    expect(dailySalesRows(db, input)[0]).toMatchObject({
      items: 2,
      revenue: 50,
    });
    expect(
      salesByProduct(db, input)
        .map(row => row.productId)
        .sort()
    ).toEqual([personal.id, household.id].sort());
    expect(
      stockBalanceReport(db, input)
        .map(row => row.productId)
        .sort()
    ).toEqual([personal.id, household.id].sort());
  });
});
