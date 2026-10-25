import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { businessPeriodStatus, checkout, closeBusinessDay, createBlankCards, createProduct, createSqliteStore, registerMember, voidSale, walletTx, type SqliteDb } from "./sqliteStore";
let db: SqliteDb;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T12:00:00")); db = createSqliteStore(); });
afterEach(() => { db.close(); vi.useRealTimers(); });
describe("same-period void totals", () => {
  it("excludes voided sales and distinguishes wallet purchase reversal from actual cash refunds", () => {
    createBlankCards(db, ["PERIOD-CARD"]);
    const member = registerMember(db, { firstName: "Period", lastName: "Test", cardNumber: "PERIOD-CARD", initialDeposit: 100 }).member;
    const product = createProduct(db, { name: "Period product", price: 100, stock: 3 });
    const cash = checkout(db, { items: [{ productId: product.id, qty: 1 }], paymentMethod: "เงินสด" });
    const wallet = checkout(db, { items: [{ productId: product.id, qty: 1 }], paymentMethod: "หักบัญชีสมาชิก", memberNumber: member.memberNumber });
    checkout(db, { items: [{ productId: product.id, qty: 1 }], paymentMethod: "QR / สแกน", paymentVerified: true });
    expect(businessPeriodStatus(db).totals).toMatchObject({ bills: 3, pieces: 3, revenue: 300 });
    for (const receipt of [cash, wallet]) {
      const sale = db.prepare("SELECT id FROM sales WHERE order_number = ?").get(receipt.orderNumber) as { id: number };
      voidSale(db, { saleId: sale.id, reason: "Test same period" });
    }
    expect(businessPeriodStatus(db).totals).toMatchObject({ bills: 1, pieces: 1, revenue: 100, cashTotal: 0, walletTotal: 0, qrTotal: 100, refundCount: 0, refundAmount: 0 });
    walletTx(db, { memberNumber: member.memberNumber, type: "refund", amount: 100 });
    expect(businessPeriodStatus(db).totals).toMatchObject({ bills: 1, revenue: 100, refundCount: 1, refundAmount: 100 });
    expect(closeBusinessDay(db, { actor: "Test" })).toMatchObject({ bills: 1, pieces: 1, revenue: 100, cashTotal: 0, walletTotal: 0, qrTotal: 100, refundCount: 1, refundAmount: 100 });
  });
});
