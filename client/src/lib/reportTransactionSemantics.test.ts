import { describe, expect, it } from "vitest";
import { hospitalTransactionLayout } from "./approvedReportLayouts";
import { hospitalTransactionRows, refundReportSummary, reportTransactionLabel } from "./reportTransactionSemantics";

describe("report refund direction", () => {
  const returns = [-210, -250, -300, -400, -50].map(amount => ({
    type: "refund", amount, createdAt: "2026-11-02 07:10:00", cardNumber: "000123",
    memberNumber: "000007", memberName: "นาย ตัวอย่าง", actor: "เจ้าหน้าที่",
  }));
  const credit = { ...returns[0], amount: 20 };
  const rows = [...returns, credit];

  it("keeps bill cancellation credits out of the card-return hospital report", () => {
    const selected = hospitalTransactionRows(rows, "refund");
    expect(selected).toEqual(returns);
    const layout = hospitalTransactionLayout(selected);
    expect(layout.rows).toHaveLength(5);
    expect(layout.totalsRow).toEqual(["รวม 5 รายการ", "", "", "", "1,210.00", ""]);
  });

  it("keeps both directions in standard reports with distinct labels and summaries", () => {
    const standard = hospitalTransactionRows(rows, "standard");
    expect(standard).toHaveLength(6);
    expect(reportTransactionLabel(credit, "คืนบัตรเงินสด")).toBe("คืนเงินจากยกเลิกบิล");
    expect(reportTransactionLabel(returns[0], "คืนบัตรเงินสด")).toBe("คืนบัตรเงินสด");
    expect(reportTransactionLabel({type: "deposit", amount: 20}, "เติมเงิน")).toBe("เติมเงิน");
    expect(refundReportSummary(standard)).toEqual([
      {type: "refund", label: "คืนบัตรเงินสด", amount: 1210, count: 5, sign: "-"},
      {type: "refund", label: "คืนเงินจากยกเลิกบิล", amount: 20, count: 1, sign: "+"},
    ]);
    expect(standard.reduce((sum, row) => sum + row.amount, 0)).toBe(-1190);
    expect(rows).toHaveLength(6);
  });
});
