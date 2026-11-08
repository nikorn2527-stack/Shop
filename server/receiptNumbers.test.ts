import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkout,
  createProduct,
  createSqliteStore,
  salesList,
  type SqliteDb,
} from "./sqliteStore";
let db: SqliteDb;
let productId: number;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T03:00:00Z"));
  db = createSqliteStore();
  productId = createProduct(db, {
    name: "Numbering test",
    price: 10,
    cost: 3,
    stock: 100,
  }).id;
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});
const bill = (clientRequestId?: string) =>
  checkout(db, {
    items: [{ productId, qty: 1 }],
    paymentMethod: "เงินสด",
    receivedCash: 10,
    clientRequestId,
  });
function existing(number: string, voided = 0) {
  db.prepare(
    "INSERT INTO sales(order_number,payment_method,subtotal,total,created_at,voided) VALUES(?,'เงินสด',10,10,'2026-11-01 10:00:00',?)"
  ).run(number, voided);
}
const business = () =>
  [
    "sales",
    "sale_items",
    "member_transactions",
    "products",
    "stock_lots",
    "stock_movements",
    "audit_logs",
  ].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
describe("Buddhist year monthly receipt numbers", () => {
  it("uses Buddhist YY + MM + a four-digit sequence and retains the same number on retry", () => {
    const first = bill("first");
    expect(first.orderNumber).toBe("69110001");
    expect(bill("first")).toEqual(first);
    expect(bill("second").orderNumber).toBe("69110002");
    expect(salesList(db, { search: "69110001" })[0].orderNumber).toBe(
      "69110001"
    );
  });
  it("continues through different days of one month", () => {
    expect(bill().orderNumber).toBe("69110001");
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    expect(bill().orderNumber).toBe("69110002");
  });
  it("changes month at Bangkok midnight and starts a new monthly sequence", () => {
    vi.setSystemTime(new Date("2026-10-31T16:59:59Z"));
    expect(bill().orderNumber).toBe("69100001");
    vi.setSystemTime(new Date("2026-10-31T17:00:00Z"));
    expect(bill().orderNumber).toBe("69110001");
  });
  it("changes Buddhist year at the Bangkok year boundary", () => {
    vi.setSystemTime(new Date("2026-12-31T16:59:59Z"));
    expect(bill().orderNumber).toBe("69120001");
    vi.setSystemTime(new Date("2026-12-31T17:00:00Z"));
    expect(bill().orderNumber).toBe("70010001");
  });
  it("keeps legacy numbers and histories unchanged, and ignores other formats", () => {
    existing("RC-261109-123");
    existing("6911INVALID");
    const old = db.prepare("SELECT * FROM sales ORDER BY id").all();
    expect(bill().orderNumber).toBe("69110001");
    expect(db.prepare("SELECT * FROM sales ORDER BY id LIMIT 2").all()).toEqual(
      old
    );
    expect(salesList(db, { search: "RC-261109-123" })[0].orderNumber).toBe(
      "RC-261109-123"
    );
  });
  it("resumes from the highest persisted monthly number including voided receipts", () => {
    existing("69110007");
    existing("69110025", 1);
    existing("69129999");
    expect(bill().orderNumber).toBe("69110026");
  });
  it("does not renumber an old-format receipt when its original request is retried", () => {
    const receipt = bill("legacy-retry");
    const legacy = { ...receipt, orderNumber: "RC-261109-001" };
    db.prepare(
      "UPDATE sales SET order_number=?,receipt_snapshot=? WHERE order_number=?"
    ).run(legacy.orderNumber, JSON.stringify(legacy), receipt.orderNumber);
    const before = business();
    expect(bill("legacy-retry")).toEqual(legacy);
    expect(business()).toEqual(before);
    expect(bill().orderNumber).toBe("69110001");
  });
  it("rejects exhaustion of four digits without altering financial or stock data", () => {
    existing("69119999");
    const before = business();
    expect(() => bill()).toThrow("9999");
    expect(business()).toEqual(before);
  });
});
