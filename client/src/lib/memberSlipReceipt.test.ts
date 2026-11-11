import { describe, expect, it } from "vitest";
import { memberSlipReceipt, memberSlipLabels } from "./memberSlipReceipt";
import type { MemberSlipDocument } from "@shared/storeTypes/documents";
describe("member completion slips", () => {
  const saved: MemberSlipDocument = {
    kind: "deposit",
    reference: "TX-14",
    documentRef: { kind: "wallet", key: "14" },
    createdAt: "2026-11-11 08:00:00",
    memberNumber: "700001",
    memberName: "ชื่อสมาชิกยาว",
    amount: 100,
    balanceBefore: 50,
    balanceAfter: 150,
    paymentMethod: "เงินสด",
    cashier: "เจ้าหน้าที่",
  };
  it("preserves saved reference, time and balances and never copies a physical card field", () => {
    const result = memberSlipReceipt({
      ...saved,
      cardNumber: "DO-NOT-PRINT",
    } as MemberSlipDocument);
    expect(result).toMatchObject({
      orderNumber: "TX-14",
      createdAt: saved.createdAt,
      documentRef: saved.documentRef,
      balanceAfter: 150,
      total: 100,
      memberNumber: "700001",
    });
    expect(JSON.stringify(result)).not.toContain("DO-NOT-PRINT");
  });
  it.each(["deposit", "withdrawal", "refund", "registration"] as const)(
    "provides explicit document and signature roles for %s",
    kind => {
      const labels = memberSlipLabels({ ...saved, kind });
      expect(labels.title).toBeTruthy();
      expect(labels.signatures).toHaveLength(2);
      expect(labels.title).not.toContain("สำเนา");
    }
  );
});
