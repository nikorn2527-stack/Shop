import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("member card workflow UI", () => {
  it("opens the dedicated return-card workflow from POS and member detail", () => {
    const detailSource = readSource("./pages/members/MemberDetail.tsx");
    const membersSource = readSource("./pages/members/Members.tsx");
    const posSource = readSource("./pages/Pos.tsx");
    const shellSource = readSource("./layouts/AppShell.tsx");
    const settingsSource = readSource("./pages/settings/Settings.tsx");
    const modalSource = readSource("./components/MemberCardActionsModal.tsx");

    expect(detailSource).toContain('setCardAction("return")');
    expect(detailSource).toContain("<ReturnCardModal");
    expect(detailSource).toContain("allowMemberChange={false}");
    expect(detailSource).not.toContain('setCardAction("manage")');
    expect(detailSource).not.toContain('> จัดการบัตร');
    expect(membersSource).toContain("จัดการบัตรสมาชิก");
    expect(membersSource).toContain("<CardInventory canManage={isAdminRole(role)} />");
    expect(shellSource).not.toContain('safeView === "cards"');
    expect(shellSource).toContain('setMemberSection("cards")');
    expect(settingsSource).toContain('key: "card"');
    expect(settingsSource).toContain('label: "คืนบัตร"');
    expect(shellSource).toContain('new CustomEvent("pos-rail", { detail: "card" })');
    expect(posSource).toContain('setCardInitialAction("return")');
    expect(posSource).toContain('initialAction={cardInitialAction}');
    expect(posSource).toContain("<ReturnCardModal");
    expect(modalSource).toContain('export type InitialMemberCardAction = "return" | "close"');
    expect(modalSource).toContain('initialAction === "return" ? "return"');
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

  it("uses the agreed card and wallet terminology in reports", () => {
    const reportSource = readSource("./pages/reports/Reports.tsx");

    expect(reportSource).toContain('"เลขที่บัตร"');
    expect(reportSource).toContain('withdrawal: "รายงานยอดแสดงการถอนเงิน"');
    expect(reportSource).toContain('deposit: "รายงานยอดแสดงการเติมเงิน"');
    expect(reportSource).toContain('refund: "รายงานยอดแสดงการคืนบัตรเงินสด"');
    expect(reportSource).toContain('activation: "รายงานยอดแสดงการเปิดใช้บัตรเงินสด"');
    expect(reportSource).toContain("const transactionLabel = (row: typeof txRows[number]) => TX_TYPE_LABEL[row.type]");
    expect(reportSource).toContain("...visibleTxSummary.map(item => [item.label, `${item.sign}${exportNumber(item.amount)}");
    expect(reportSource).toContain('columnWidths: hospitalTxPreset');
    expect(reportSource).not.toContain("ทุกสมาชิก · แสดง 300 รายการล่าสุด");
    expect(reportSource).not.toContain("transactionDescription");
  });
});