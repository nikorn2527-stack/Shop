import type {
  MemberStatement,
  StatementEntry,
} from "@shared/storeTypes/statements";
import type { ReportDocConfig } from "@shared/reportDoc";
import { exportNumber } from "@/exportUtils";
import {
  formatHistoryDate,
  formatThaiDate,
  WALLET_TX_META,
} from "@/pages/viewFormat";
import { money } from "@/pages/pageData";

function entryLabel(entry: StatementEntry) {
  if (entry.type === "refund" && entry.amount > 0) return "คืนเงินจากยกเลิกบิล";
  const base = WALLET_TX_META[entry.type]?.label ?? entry.type;
  return `${base}${entry.kind === "purchase" ? ` · ${entry.paymentMethod ?? "ไม่ระบุวิธีชำระ"}` : ""}${entry.purchase?.voided ? " · บิลยกเลิก" : ""}`;
}
/** Same rows and balances for preview, CSV, Excel, PDF and print. */
export function memberStatementExport(
  statement: MemberStatement,
  options: { brandName: string; storeAddress?: string; generatedAt?: Date }
) {
  const member = statement.member;
  const name = [member.prename, member.firstName, member.lastName]
    .filter(Boolean)
    .join(" ");
  const range =
    statement.from || statement.to
      ? `${statement.from ? formatThaiDate(statement.from) : "เริ่มต้นบัญชี"} – ${statement.to ? formatThaiDate(statement.to) : "ปัจจุบัน"}`
      : "ประวัติทั้งหมด";
  const rows: string[][] = [
    [
      "",
      "",
      "ยอดยกมา",
      "ยอดเงินในบัตรก่อนช่วงที่เลือก",
      "",
      "",
      exportNumber(statement.openingBalance),
    ],
  ];
  for (const entry of statement.entries) {
    const purchase = entry.purchase;
    const detail = [
      entry.detail,
      purchase
        ? `ยอดบิล ${money(purchase.total)}${purchase.discount ? ` · ส่วนลด ${money(purchase.discount)}` : ""}`
        : "",
      entry.cardNumber ? `บัตรขณะทำรายการ ${entry.cardNumber}` : "",
      entry.kind === "purchase"
        ? entry.paymentMethod === "หักบัญชีสมาชิก"
          ? "ข้อมูลบิลประกอบรายการบัญชี"
          : "ชำระนอกบัตร · ไม่หักยอดในบัตร"
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push([
      formatHistoryDate(entry.createdAt),
      entry.reference,
      entryLabel(entry),
      detail,
      entry.amount > 0 ? exportNumber(entry.amount) : "",
      entry.amount < 0 ? exportNumber(-entry.amount) : "",
      entry.balanceAfter === null ? "—" : exportNumber(entry.balanceAfter),
    ]);
    for (const item of purchase?.items ?? []) {
      const quantity = item.qty.toLocaleString("en-US", {
        maximumFractionDigits: 4,
      });
      rows.push([
        "",
        purchase!.orderNumber,
        "สินค้า",
        `${item.name} · ${quantity} ${item.unit} × ${money(item.price)} = ${money(item.amount)}`,
        "",
        "",
        "",
      ]);
    }
  }
  const numericCols = [4, 5, 6];
  const fileName = `statement-${member.memberNumber}-${statement.from || "all"}-${statement.to || "current"}`;
  const doc: ReportDocConfig = {
    fileName,
    title: "สเตทเมนต์สมาชิก · รายการเดินบัญชีและการซื้อสินค้า",
    periodLabel: range,
    brandName: options.brandName,
    meta: [
      ["สมาชิก", name],
      ["เลขสมาชิก", member.memberNumber],
      ["เลขบัตรปัจจุบัน", member.cardNumber || "—"],
      [
        "ออกรายงาน",
        formatHistoryDate((options.generatedAt ?? new Date()).toISOString()),
      ],
      ...(options.storeAddress?.trim()
        ? [["ที่อยู่ร้าน", options.storeAddress.trim()] as [string, string]]
        : []),
    ],
    summaryBlocks: [
      ["ยอดยกมา", money(statement.openingBalance)],
      ["เงินเข้าบัตรรวม", money(statement.incoming)],
      ["เงินออกบัตรรวม", money(statement.outgoing)],
      ["ยอดปลายช่วง", money(statement.closingBalance)],
      ["รายการเงินในบัตร", `${statement.ledgerCount} รายการ`],
      ["ยอดซื้อสินค้า (ไม่รวมบิลยกเลิก)", money(statement.purchaseTotal)],
    ],
    columns: [
      "วันและเวลา",
      "เลขอ้างอิง",
      "รายการ / วิธีชำระ",
      "รายละเอียด",
      "เงินเข้าบัตร",
      "เงินออกบัตร",
      "ยอดในบัตร",
    ],
    columnWidths: ["15%", "12%", "14%", "29%", "10%", "10%", "10%"],
    numericCols,
    rows,
    totalsRow: [
      "รวม",
      "",
      "ยอดปลายช่วง",
      "",
      exportNumber(statement.incoming),
      exportNumber(statement.outgoing),
      exportNumber(statement.closingBalance),
    ],
    compact: true,
    footnote:
      "จำนวนเงินเป็นบาท · ยอดยกมาและยอดในบัตรคำนวณจากประวัติเงินในระบบ · การซื้อเงินสด/QR แสดงเพื่อประกอบรายละเอียดและไม่หักยอดในบัตร · บิลยกเลิกยังแสดงประวัติเดิมพร้อมรายการคืนเงินที่อยู่ในช่วงวันที่เลือก",
  };
  const exportRows = [
    [doc.title],
    ...doc.meta!,
    ["ช่วงวันที่", range],
    [],
    doc.columns,
    ...rows,
    doc.totalsRow!,
    [],
    ["ยอดซื้อสินค้า (ไม่รวมบิลยกเลิก)", exportNumber(statement.purchaseTotal)],
  ];
  return { doc, rows: exportRows, fileName, numericCols };
}
