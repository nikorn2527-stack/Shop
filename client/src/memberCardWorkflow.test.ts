import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("member card workflow UI", () => {
  it("opens the shared card modal directly in return-card mode", () => {
    const detailSource = readSource("./pages/members/MemberDetail.tsx");
    const modalSource = readSource("./components/MemberCardActionsModal.tsx");

    expect(detailSource).toContain('setCardAction("return")');
    expect(detailSource).toContain('initialAction={cardAction === "return" ? "return" : undefined}');
    expect(modalSource).toContain('export type InitialMemberCardAction = "return" | "close"');
  });

  it("keeps partial withdrawal separate from full-balance card return", () => {
    const detailSource = readSource("./pages/members/MemberDetail.tsx");
    const modalSource = readSource("./components/MemberCardActionsModal.tsx");

    expect(detailSource).toContain('<ArrowUpFromLine size={15} /> ถอนเงิน');
    expect(detailSource).toContain('<RotateCcw size={15} /> คืนบัตร');
    expect(modalSource).toContain('<span>เงินที่ต้องจ่ายคืน</span>');
    expect(modalSource).toContain('<span>ยอดหลังทำรายการ</span><b>0.00 บาท</b>');
    expect(modalSource).toContain('release.mutate({ ...input, mode: "refund" })');
  });

  it("keeps the removed purchase-limit workflow out and adds card numbers to reports", () => {
    const detailSource = readSource("./pages/members/MemberDetail.tsx");
    const posSource = readSource("./pages/Pos.tsx");
    const reportSource = readSource("./pages/reports/Reports.tsx");
    const serverSource = readSource("../../server/sqliteStore.ts");

    expect(detailSource).not.toContain("ปรับวงเงิน");
    expect(posSource).not.toContain("LimitReductionModal");
    expect(reportSource).not.toContain("limitRequests");
    expect(reportSource).toContain('"เลขบัตร"');
    expect(serverSource).not.toContain("เกินวงเงินซื้อสินค้าต่อวัน");
    expect(serverSource).toContain("s.card_number AS cardNumber");
  });
});