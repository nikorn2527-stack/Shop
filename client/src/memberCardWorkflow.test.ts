import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hospitalTransactionLayout } from "./lib/approvedReportLayouts";

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
    expect(reportSource).toContain('withdrawal: "รายงานการถอนเงิน"');
    expect(reportSource).toContain('deposit: "รายงานการเติมเงิน"');
    expect(reportSource).toContain('refund: "รายงานการคืนบัตรเงินสด"');
    expect(reportSource).toContain('activation: "รายงานการเปิดใช้บัตรเงินสด"');
    expect(reportSource).toContain("const transactionLabel = (row: typeof txRows[number]) => reportTransactionLabel(row, TX_TYPE_LABEL[row.type])");
    expect(reportSource).toContain("...visibleTxSummary.map(item => [item.label, `${item.sign}${exportNumber(item.amount)}");
    expect(reportSource).toContain('...(hospitalTxPreset ? hospitalTransactionLayout(txRows) : {})');
    const hospitalTable = hospitalTransactionLayout([{
      createdAt: "2026-11-02 07:10:00",
      cardNumber: "000123",
      memberNumber: "000007",
      amount: -25,
      memberName: "นาย ตัวอย่าง นามสกุลเต็ม",
      actor: "เจ้าหน้าที่",
    }]);
    expect(hospitalTable.columns).toEqual(["วัน–เวลา", "เลขบัตร", "เลขสมาชิก", "ชื่อสมาชิก", "จำนวนเงิน (บาท)", "ผู้ทำรายการ"]);
    expect(hospitalTable.rows[0]).toEqual(["2 พ.ย. 2569 07:10", "000123", "000007", "นาย ตัวอย่าง นามสกุลเต็ม", "25.00", "เจ้าหน้าที่"]);
    expect(hospitalTable.numericCols).toEqual([4]);
    expect(hospitalTable.columnWidths).toHaveLength(hospitalTable.columns.length);
    expect(reportSource).not.toContain("ทุกสมาชิก · แสดง 300 รายการล่าสุด");
    expect(reportSource).not.toContain("transactionDescription");
  });
});
