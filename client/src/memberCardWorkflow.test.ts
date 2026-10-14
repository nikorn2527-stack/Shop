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

  it("labels the legacy credit-limit request as a purchase limit, not cash withdrawal", () => {
    const detailSource = readSource("./pages/members/MemberDetail.tsx");
    const limitSource = readSource("./components/LimitReductionModal.tsx");

    expect(detailSource).toContain("ขอปรับวงเงินซื้อ/วัน");
    expect(limitSource).toContain("รายการนี้ปรับวงเงินซื้อสินค้าเท่านั้น ไม่ได้ถอนเงินคงเหลือ");
  });
});