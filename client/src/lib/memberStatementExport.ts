import { bangkokParts, parseBangkokDate } from "@shared/storeTime";
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
/** Compact Buddhist date, with Bangkok time, to keep the whole identifier on one line. */
function statementDate(value: string) {
  const date = parseBangkokDate(value);
  if (!date) return value;
  const p = bangkokParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.day)}/${pad(p.month)}/${pad((p.year + 543) % 100)} ${pad(p.hour)}:${pad(p.minute)}`;
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
      "",
      "",
      "",
      "",
      "",
      exportNumber(statement.openingBalance),
    ],
  ];
  for (const entry of statement.entries) {
    const purchase = entry.purchase;
    // Product names and quantities live only in their own rows, never repeated in the bill summary.
    const detail = [
      entryLabel(entry),
      purchase
        ? `รวมบิล ${money(purchase.total)}${purchase.discount ? ` · ส่วนลด ${money(purchase.discount)}` : ""}`
        : entry.detail,
      entry.cardNumber ? `บัตร ${entry.cardNumber}` : "",
      entry.kind === "purchase" && entry.paymentMethod !== "หักบัญชีสมาชิก"
        ? "ไม่หักยอดในบัตร"
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push([
      statementDate(entry.createdAt),
      entry.reference,
      detail,
      "",
      "",
      "",
      entry.amount > 0 ? exportNumber(entry.amount) : "",
      entry.amount < 0 ? exportNumber(-entry.amount) : "",
      entry.balanceAfter === null ? "—" : exportNumber(entry.balanceAfter),
    ]);
    for (const item of purchase?.items ?? []) {
      const quantity = item.qty.toLocaleString("en-US", {
        maximumFractionDigits: 4,
      });
      rows.push([
        statementDate(entry.createdAt),
        purchase!.orderNumber,
        item.name,
        `${quantity} ${item.unit}`,
        exportNumber(item.price),
        exportNumber(item.amount),
        "",
        "",
        "",
      ]);
    }
  }
  const numericCols = [4, 5, 6, 7, 8];
  const fileName = `statement-${member.memberNumber}-${statement.from || "all"}-${statement.to || "current"}`;
  const doc: ReportDocConfig = {
    fileName,
    title: "รายการเดินบัญชีสมาชิก",
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
      "วัน–เวลา",
      "เลขอ้างอิง",
      "รายการ / ชื่อสินค้า",
      "จำนวน",
      "ราคา",
      "รวมสินค้า",
      "เงินเข้า",
      "เงินออก",
      "ยอดในบัตร",
    ],
    columnWidths: [
      "13.5%",
      "13.5%",
      "24.5%",
      "9%",
      "7%",
      "7%",
      "8.5%",
      "8.5%",
      "8.5%",
    ],
    nowrapCols: [0, 1, 3, 4, 5, 6, 7, 8],
    numericCols,
    rows,
    totalsRow: [
      "รวม",
      "",
      "ยอดปลายช่วง",
      "",
      "",
      "",
      exportNumber(statement.incoming),
      exportNumber(statement.outgoing),
      exportNumber(statement.closingBalance),
    ],
    compact: true,
    footnote:
      "วันที่เป็น พ.ศ. 2 หลัก · ราคาเป็นราคาต่อหน่วย · จำนวนเงินเป็นบาท · เงินเข้า/เงินออกหมายถึงยอดในบัตร และแสดงครั้งเดียวต่อบิล ไม่หักซ้ำตามแถวสินค้า · ยอดยกมาและยอดในบัตรคำนวณจากประวัติเงินในระบบ · การซื้อเงินสด/QR แสดงเพื่อประกอบรายละเอียดและไม่หักยอดในบัตร · บิลยกเลิกยังแสดงประวัติเดิมพร้อมรายการคืนเงินที่อยู่ในช่วงวันที่เลือก",
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
