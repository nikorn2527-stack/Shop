import { useEffect, useMemo, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Download, FileText, Printer, X } from "@/lib/icons";
import { money } from "../pages/pageData";
import { WALLET_TX_META } from "../pages/viewFormat";
import { trpc } from "@/lib/trpc";
import { PrintPreviewModal } from "./PrintPreviewModal";

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
  /** คำนำหน้าชื่อ — null = ไม่มี */
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

/** "2026-09-18 14:42:33" → "18 กันยายน 2569" (Thai Buddhist year). */
function formatFullThaiDate(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
}

/** "2026-09-18 14:42:33" → "18 ก.ย. 2569 14:42" */
function formatStatementTime(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Member account statement — printable/downloadable A4 document with the
 * full wallet history and running balance. The store hands this to a member
 * on request (e.g. to review deposits/spending); members never log into the
 * app, so staff produce the document here.
 */
export function StatementModal({ member, transactions, onClose }: { member: StatementMember; transactions: StatementTx[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  // Round 43 — แบรนด์ตามที่ผู้บริหารตั้งใน ตั้งค่า → ชื่อร้านและโลโก้ (เหมือนใบเสร็จ)
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const brandName = (settingsQuery.data?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const displayName = [member.prename?.trim() || "", member.firstName, member.lastName].filter(Boolean).join(" ");
  const generatedAt = useMemo(() => new Date(), []);

  // member.detail returns DESC (newest first); a statement reads oldest → newest.
  const ordered = useMemo(() => [...transactions].reverse(), [transactions]);
  const totals = useMemo(() => {
    const sum = (type: string) => transactions.filter((tx) => tx.type === type).reduce((acc, tx) => acc + tx.amount, 0);
    const deposits = Math.abs(sum("deposit"));
    const withdrawals = Math.abs(sum("withdrawal"));
    const purchases = Math.abs(sum("purchase"));
    return { deposits, withdrawals, purchases, count: transactions.length, truncated: transactions.length >= TX_LIMIT };
  }, [transactions]);

  const downloadPdf = async () => {
    const element = document.getElementById("member-statement");
    if (!element) return;
    setBusy(true);
    try {
      // A4 portrait at document scale — html2canvas keeps Thai glyphs perfect.
      // Round 43 — รอฟอนต์ (Sarabun) พร้อมก่อน กันตัวอักษรไทยตกหล่นในไฟล์ PDF
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height / canvas.width) * imgWidth;
      // Long statements flow onto extra A4 pages (splitImage keeps top→bottom order).
      if (imgHeight <= pageHeight - margin * 2) {
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, imgWidth, imgHeight);
      } else {
        let rendered = 0;
        const sliceHeightPx = Math.floor((canvas.width * (pageHeight - margin * 2)) / imgWidth);
        while (rendered < canvas.height) {
          const slice = document.createElement("canvas");
          slice.width = canvas.width;
          slice.height = Math.min(sliceHeightPx, canvas.height - rendered);
          const ctx = slice.getContext("2d");
          if (!ctx) break;
          ctx.drawImage(canvas, 0, rendered, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
          if (rendered > 0) pdf.addPage();
          pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, imgWidth, (slice.height / canvas.width) * imgWidth);
          rendered += slice.height;
        }
      }
      pdf.save(`statement-${member.memberNumber}.pdf`);
    } finally { setBusy(false); }
  };

  // ROUND 51 — พิมพ์ผ่านพรีวิวก่อน (เหมือนจุดพิมพ์อื่นทั้งระบบ) — เห็นหน้ากระดาษ A4
  // พร้อมจำนวนแถวก่อนสั่งพิมพ์จริง
  // FIX-26 (user) — ปุ่ม 'พิมพ์' พิมพ์เลย ไม่เข้าพรีวิวก่อน
  const printStatement = () => { window.print(); };
  // FIX-8 — Enter = สั่งพิมพ์ทันที
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      window.print();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return <div className="modal-backdrop" onClick={onClose}><div className="statement-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-heading">
      <div>
        <span className="eyebrow">MEMBER STATEMENT</span>
        <h2>รายงานยอดเงินคงเหลือสมาชิก</h2>
        <p>{displayName} · {member.memberNumber} · ออกรายงาน {formatStatementTime(generatedAt.toISOString())}</p>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
    </div>
    <div className="statement-stage">
      <div className="statement-paper" id="member-statement">
        <div className="statement-head">
          <div className="statement-brand"><div><b>{brandName}</b><small>Welfare Store · ระบบร้านค้า</small></div></div>
          <div className="statement-title">
            <b>รายงานยอดเงินคงเหลือและประวัติการทำรายการ</b>
            <small>ออกเมื่อ {formatFullThaiDate(generatedAt.toISOString())} · Statement {member.memberNumber}</small>
          </div>
        </div>
        <div className="statement-member">
          <div><small>ชื่อสมาชิก</small><b>{displayName}</b></div>
          <div><small>หมายเลขสมาชิก</small><b>{member.memberNumber}</b></div>
          <div><small>ประเภท</small><b>{member.type}</b></div>
          <div><small>สมาชิกตั้งแต่</small><b>{formatFullThaiDate(member.createdAt)}</b></div>
          <div><small>สถานะ</small><b className={member.status === "active" ? "st-ok" : "st-suspended"}>{member.status === "active" ? "ใช้งานอยู่" : "ระงับการใช้งาน"}</b></div>
          <div><small>เบอร์โทรศัพท์</small><b>{member.phone?.trim() || "—"}</b></div>
        </div>
        <div className="statement-summary">
          <div><small>ยอดเงินคงเหลือปัจจุบัน</small><b className="st-balance">{money(member.balance)}</b></div>
          <div><small>เติมเงินรวม (ตามรายงานนี้)</small><b className="st-in">{money(totals.deposits)}</b></div>
          <div><small>ถอนเงินรวม</small><b className="st-out">{money(totals.withdrawals)}</b></div>
          <div><small>ซื้อสินค้ารวม</small><b className="st-buy">{money(totals.purchases)}</b></div>
        </div>
        <table className="statement-table">
          <colgroup>
            <col className="col-time" />
            <col className="col-type" />
            <col className="col-detail" />
            <col className="col-num" />
            <col className="col-num" />
          </colgroup>
          <thead><tr><th>วันและเวลา</th><th>ประเภท</th><th>รายละเอียด</th><th className="st-num">จำนวนเงิน</th><th className="st-num">ยอดคงเหลือ</th></tr></thead>
          <tbody>
            {ordered.length === 0 ? <tr><td colSpan={5} className="st-empty">ยังไม่มีรายการทำธุรกรรม</td></tr> : ordered.map((tx) => {
              const meta = WALLET_TX_META[tx.type] ?? { label: tx.type, tone: "blue" };
              return <tr key={tx.id}>
                <td className="st-time">{formatStatementTime(tx.createdAt)}</td>
                <td><span className={`st-type ${meta.tone}`}>{meta.label}</span></td>
                <td className="st-detail">{tx.detail || "—"}</td>
                <td className={`st-num ${tx.amount > 0 ? "st-in" : "st-out"}`}>{tx.amount > 0 ? "+" : "−"}{money(Math.abs(tx.amount))}</td>
                <td className="st-num st-strong">{tx.balanceAfter === null ? "—" : money(tx.balanceAfter)}</td>
              </tr>;
            })}
          </tbody>
          <tfoot><tr>
            <td colSpan={3}>รวมทั้งหมด {totals.count} รายการ{totals.truncated ? " (แสดงล่าสุด)" : ""}</td>
            <td className="st-num">{transactions.reduce((sum, tx) => sum + tx.amount, 0) >= 0 ? "+" : "−"}{money(Math.abs(transactions.reduce((sum, tx) => sum + tx.amount, 0)))}</td>
            <td className="st-num">{money(member.balance)}</td>
          </tr></tfoot>
        </table>
        <div className="statement-end">
          <div className="statement-note">
            {totals.truncated
              ? `แสดงรายการล่าสุด ${TX_LIMIT} รายการ (จากทั้งหมดในระบบ) · ติดต่อเจ้าหน้าที่เพื่อขอรายงานฉบับเต็ม`
              : `รวมทั้งสิ้น ${totals.count} รายการ · ยอดเงินคงเหลือสุดท้าย ${money(member.balance)}`}
          </div>
          <div className="statement-sign">
            <div><span>ลงชื่อเจ้าหน้าที่ร้านค้า</span><i /></div>
            <div><span>ลงชื่อสมาชิก</span><i /></div>
            <div><span>วันที่</span><i /></div>
          </div>
          <div className="statement-foot">เอกสารนี้ออกโดยระบบร้านค้าสวัสดิการ · ⚡ Powered by PNG TEAM</div>
        </div>
      </div>
    </div>
    <div className="statement-actions modal-actions">
      <span className="statement-hint"><FileText size={14} /> A4 · {totals.count} รายการ</span>
      <button className="outline-button red" disabled={busy} onClick={downloadPdf} title="ดาวน์โหลดรายงานเป็น PDF"><Download size={16} /> {busy ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button>
      <button className="primary-button" onClick={printStatement} title="พิมพ์รายงานเลย"><Printer size={16} /> พิมพ์รายงาน</button>
    </div>
    
  </div></div>;
}
