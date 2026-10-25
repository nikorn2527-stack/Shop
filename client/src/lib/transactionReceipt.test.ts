import { describe, expect, it } from "vitest";
import type { MemberTransactionRow } from '@shared/storeTypes/reports';
import { transactionReceipt } from "./transactionReceipt";

const row: MemberTransactionRow = { id: 17, memberNumber: "001", memberName: "ทดสอบ", cardNumber: null, patientCode: null, kind: "tx", type: "deposit", detail: "เติมเงิน", amount: 100, paymentMethod: "เงินสด", balanceAfter: 150, actor: "เจ้าหน้าที่", createdAt: "2026-10-04 10:00:00" };
describe("transaction receipts", () => {
  it("uses the persisted transaction identity and timestamp", () => {
    expect(transactionReceipt(row)).toMatchObject({ orderNumber: "TX-17", createdAt: row.createdAt, total: 100, balanceAfter: 150 });
  });
  it("prints withdrawals as a positive disbursement amount", () => {
    expect(transactionReceipt({ ...row, type: "withdrawal", amount: -100 })?.total).toBe(100);
  });
  it("does not duplicate purchase receipts or issue receipts for limit requests", () => {
    expect(transactionReceipt({ ...row, type: "purchase" })).toBeNull();
    expect(transactionReceipt({ ...row, type: "purchase" })).toBeNull();
  });
});