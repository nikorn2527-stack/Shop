import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { businessPeriodStatus, checkout, closeBusinessDay, closeElapsedBusinessPeriods, createBlankCards, createProduct, createSqliteStore, dailySalesRows, listDayClosures, registerMember, setSettings, voidSale, walletTx, type SqliteDb } from "./sqliteStore";
let db: SqliteDb;
let productId: number;
let memberNumber: string;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T12:00:00")); db = createSqliteStore();
  setSettings(db, { dailyCutOffMode: "manual" });
  createBlankCards(db, ["PERIOD-CARD"]);
  memberNumber = registerMember(db, { firstName: "Period", lastName: "Member", cardNumber: "PERIOD-CARD", initialDeposit: 100 }).member.memberNumber;
  productId = createProduct(db, { name: "Period product", price: 10, stock: 10 }).id;
});
afterEach(() => { db.close(); vi.useRealTimers(); });
function sell(method: "เงินสด" | "หักบัญชีสมาชิก" = "เงินสด") {
  const receipt = checkout(db, { items: [{ productId, qty: 1 }], paymentMethod: method, memberNumber });
  return (db.prepare("SELECT id FROM sales WHERE order_number=?").get(receipt.orderNumber) as { id: number }).id;
}
function state() {
  return Object.fromEntries(["sales", "sale_items", "products", "members", "member_transactions", "refunds", "stock_movements", "day_closures", "audit_logs"].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
}
describe("closed-period cancellation guard", () => {
  it.each(["เงินสด", "หักบัญชีสมาชิก"] as const)("rejects %s cancellation after close without altering money, stock or historical totals", method => {
    const saleId = sell(method); vi.setSystemTime(new Date("2026-10-25T12:01:00"));
    closeBusinessDay(db, { actor: "Admin" }); const before = state(); const report = dailySalesRows(db, { from: "2026-10-25", to: "2026-10-25" });
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    expect(() => voidSale(db, { saleId, reason: "Too late" })).toThrow(/ตัดยอดแล้ว/);
    expect(state()).toEqual(before); expect(dailySalesRows(db, { from: "2026-10-25", to: "2026-10-25" })).toEqual(report);
    expect(listDayClosures(db)[0].revenue).toBe(10);
  });
  it("distinguishes sales on both sides of a manual close in the same second", () => {
    const oldSale = sell(); closeBusinessDay(db, { actor: "Admin" });
    expect(businessPeriodStatus(db).totals).toMatchObject({ bills: 0, pieces: 0, revenue: 0, activationAmount: 0 });
    const newSale = sell();
    expect(businessPeriodStatus(db).totals).toMatchObject({ bills: 1, pieces: 1, revenue: 10 });
    expect(() => voidSale(db, { saleId: oldSale, reason: "Old" })).toThrow(/ตัดยอดแล้ว/);
    expect(voidSale(db, { saleId: newSale, reason: "Current" })).toEqual({ reversed: true });
    expect(businessPeriodStatus(db).totals.revenue).toBe(0);
  });
  it("does not recount wallet deposits made in the same second as manual close", () => {
    walletTx(db, { memberNumber, type: "deposit", amount: 20 });
    expect(closeBusinessDay(db).depositAmount).toBe(20);
    expect(businessPeriodStatus(db).totals.depositAmount).toBe(0);
    walletTx(db, { memberNumber, type: "deposit", amount: 30 });
    expect(businessPeriodStatus(db).totals.depositAmount).toBe(30);
    vi.setSystemTime(new Date("2026-10-25T12:01:00"));
    expect(closeBusinessDay(db).depositAmount).toBe(30);
    expect(listDayClosures(db).map(row => row.depositAmount)).toEqual([30, 20]);
  });
  it("rejects elapsed automatic-period sales even before the cutoff scheduler runs", () => {
    setSettings(db, { dailyCutOffMode: "auto", dailyCutOffTime: "08:00" }); const saleId = sell();
    vi.setSystemTime(new Date("2026-10-26T08:00:00")); const before = state();
    expect(() => voidSale(db, { saleId, reason: "Previous day" })).toThrow(/พ้นรอบขายปัจจุบัน/); expect(state()).toEqual(before);
  });
  it("keeps automatic cutoff transactions in the new period regardless of insertion order", () => {
    setSettings(db, { dailyCutOffMode: "auto", dailyCutOffTime: "08:00" });
    vi.setSystemTime(new Date("2026-10-26T08:00:00")); const boundarySale = sell();
    vi.setSystemTime(new Date("2026-10-26T07:59:59")); const oldSale = sell();
    vi.setSystemTime(new Date("2026-10-26T08:00:01"));
    closeElapsedBusinessPeriods(db, new Date("2026-10-26T08:00:01"));
    expect(businessPeriodStatus(db).totals).toMatchObject({ bills: 1, revenue: 10 });
    expect(() => voidSale(db, { saleId: oldSale, reason: "Old" })).toThrow(/ตัดยอดแล้ว/);
    expect(voidSale(db, { saleId: boundarySale, reason: "Current" })).toEqual({ reversed: true });
  });
});
