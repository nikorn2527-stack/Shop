import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Printer, X } from "@/lib/icons";
import { money } from "../pages/pageData";
import { WALLET_TX_META } from "../pages/viewFormat";
import { trpc } from "@/lib/trpc";
import { downloadReportPdf, printReportDoc, type ReportDocConfig } from "@/reportDoc";
import { buildReportDocumentHtml, thaiStamp } from "@shared/reportDoc";

/** A wallet transaction row as returned by member.detail (DESC order, ≤50). */
export type StatementTx = {
  id: number;
  type: string;
  detail: string;
  amount: number;
  balanceAfter: number | null;
  createdAt: string;
};

/** Member fields the statement document renders. */
export type StatementMember = {
  memberNumber: string;
  prename?: string | null;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
  phone?: string | null;
  idCard?: string | null;
};

const TX_LIMIT = 50;

function formatFullThaiDate(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
}

function formatStatementTime(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Member account statement — formal A4 document (uses the SAME unified template
 * as other reports: REPORT_DOC_CSS + server vector PDF + client print).
 * owner: 'อยากได้เอกสารที่เป็นทางการกว่านี้เหมือนรายงานอื่นๆ + ช่องประเภทไม่ต้องมีกรอบ'
 * → ใช้ buildReportDocumentHtml (template เดียวกับรายงานอื่น) → ประเภทเป็น plain text ไม่มี badge
 * → PDF ผ่าน server Chromium (vector) ไม่ใช่ html2canvas raster
 */
export function StatementModal({ member, transactions, onClose }: { member: StatementMember; transactions: StatementTx[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const brandName = (settingsQuery.data?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const displayName = [member.prename?.trim() || "", member.firstName, member.lastName].filter(Boolean).join(" ");
  const generatedAt = useMemo(() => new Date(), []);
  const ordered = useMemo(() => [...transactions].reverse(), [transactions]);
  const totals = useMemo(() => {
    const sum = (type: string) => transactions.filter((tx) => tx.type === type).reduce((acc, tx) => acc + tx.amount, 0);
    const deposits = Math.abs(sum("deposit"));
    const withdrawals = Math.abs(sum("withdrawal"));
    const purchases = Math.abs(sum("purchase"));
    const net = transactions.reduce((acc, tx) => acc + tx.amount, 0);
    return { deposits, withdrawals, purchases, count: transactions.length, truncated: transactions.length >= TX_LIMIT, net };
  }, [transactions]);

  // P1-UX: map statement data → ReportDocConfig (unified template = เหมือนรายงานอื่น)
  const config: ReportDocConfig = useMemo(() => ({
    fileName: `statement-${member.memberNumber}`,
    title: "รายงานยอดเงินคงเหลือและประวัติการทำรายการ",
    periodLabel: `${displayName} · ${member.memberNumber} · ออกเมื่อ ${formatFullThaiDate(generatedAt.toISOString())}`,
    meta: [
      ["สมาชิก", displayName],
      ["หมายเลขสมาชิก", member.memberNumber],
      ["ประเภทสมาชิก", member.type],
      ["สมาชิกตั้งแต่", formatFullThaiDate(member.createdAt)],
      ["สถานะ", member.status === "active" ? "ใช้งานอยู่" : "ระงับการใช้งาน"],
      ["เบอร์โทร", member.phone?.trim() || "—"],
    ],
    summaryBlocks: [
      ["ยอดคงเหลือปัจจุบัน", money(member.balance)],
      ["เติมเงินรวม", money(totals.deposits)],
      ["ถอนเงินรวม", money(totals.withdrawals)],
      ["ซื้อสินค้ารวม", money(totals.purchases)],
      ["จำนวนรายการ", `${totals.count} รายการ`],
      ["มูลค่าสุทธิ", `${totals.net >= 0 ? "+" : "−"}${money(Math.abs(totals.net))}`],
    ],
    columns: ["วันและเวลา", "ประเภท", "รายละเอียด", "จำนวนเงิน", "ยอดคงเหลือ"],
    numericCols: [3, 4],
    rows: ordered.map((tx) => [
      formatStatementTime(tx.createdAt),
      WALLET_TX_META[tx.type]?.label ?? tx.type,
      tx.detail || "—",
      `${tx.amount > 0 ? "+" : "−"}${money(Math.abs(tx.amount))}`,
      tx.balanceAfter === null ? "—" : money(tx.balanceAfter),
    ]),
    totalsRow: [
      `รวมทั้งหมด ${totals.count} รายการ`,
      "",
      "",
      `${totals.net >= 0 ? "+" : "−"}${money(Math.abs(totals.net))}`,
      money(member.balance),
    ],
    brandName,
    footnote: totals.truncated
      ? `แสดงรายการล่าสุด ${TX_LIMIT} รายการ (จากทั้งหมดในระบบ) · ติดต่อเจ้าหน้าที่เพื่อขอรายงานฉบับเต็ม`
      : `รวมทั้งสิ้น ${totals.count} รายการ · ยอดเงินคงเหลือสุดท้าย ${money(member.balance)}`,
    compact: false,
  }), [member, displayName, generatedAt, ordered, totals, brandName]);

  // on-screen A4 preview (iframe rendering the unified template)
  const docHtml = useMemo(
    () => buildReportDocumentHtml(config, { mode: "pdf", stampText: `ออกเมื่อ ${thaiStamp(generatedAt)}` }),
    [config, generatedAt],
  );

  const downloadPdf = async () => { setBusy(true); try { await downloadReportPdf(config); } finally { setBusy(false); } };
  const printStatement = () => { printReportDoc(config); };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      printReportDoc(config);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [config]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <div className="modal-backdrop" onClick={onClose}><div className="statement-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-heading">
      <div>
        <span className="eyebrow">MEMBER STATEMENT</span>
        <h2>รายงานยอดเงินคงเหลือสมาชิก</h2>
        <p>{displayName} · {member.memberNumber} · {totals.count} รายการ · ออกรายงาน {formatFullThaiDate(generatedAt.toISOString())}</p>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
    </div>
    <div className="statement-stage">
      <div className="export-doc-preview" role="tabpanel" aria-label="พรีวิวเอกสาร A4">
        <div className="export-doc-scaler">
          <iframe title="พรีวิวเอกสาร A4" srcDoc={docHtml} className="export-doc-iframe" loading="lazy" />
        </div>
      </div>
    </div>
    <div className="statement-actions modal-actions">
      <span className="statement-hint"><FileText size={14} /> A4 · {totals.count} รายการ · เอกสารทางการ (template เดียวกับรายงานอื่น)</span>
      <button className="outline-button red" disabled={busy} onClick={downloadPdf} title="ดาวน์โหลดรายงานเป็น PDF vector (เหมือนรายงานอื่น)"><Download size={16} /> {busy ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button>
      <button className="primary-button" onClick={printStatement} title="พิมพ์รายงาน A4"><Printer size={16} /> พิมพ์รายงาน</button>
    </div>
  </div></div>;
}
