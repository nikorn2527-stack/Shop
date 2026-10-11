import { Check, Download, FileImage, Printer, X } from "@/lib/icons";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";

/**
 * ROUND 63 (user) — หน้าต่างดูรูปหลักฐาน (สลิปโอนเงิน / หลักฐานการชำระบิล QR)
 * ใช้ร่วมกันทั้งบิลขาย (ตารางรายงาน → ประวัติบิล) และธุรกรรมเติม/ถอนเงินสมาชิก
 * · ดูรูปเต็ม + ปุ่มดาวน์โหลดแยกไฟล์ + ปุ่มพิมพ์เฉพาะรูป (A4)
 */

export type SlipViewModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  /** data-URL ของรูปหลักฐาน ("" = กำลังโหลด / null = ไม่มีรูป) */
  slipUrl: string | null;
  loading?: boolean;
  onClose: () => void;
};

export function SlipViewModal({ open, title, subtitle, slipUrl, loading, onClose }: SlipViewModalProps) {
  const [printing, setPrinting] = useState(false);

  // ปิดด้วย Esc — มือถือ/แท็บเล็ตปิดด้วยปุ่มได้อยู่แล้ว
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const download = () => {
    if (!slipUrl) return;
    const link = document.createElement("a");
    link.href = slipUrl;
    link.download = `หลักฐาน-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.jpg`;
    link.click();
  };

  const print = () => {
    if (!slipUrl) return;
    setPrinting(true);
    const win = window.open("", "_blank", "width=820,height=680");
    if (!win) { setPrinting(false); return; }
    win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font-family:"Sarabun","TH Sarabun New",Tahoma,sans-serif;background:#fff;display:grid;place-items:center;min-height:100vh}img{max-width:92%;max-height:88vh;object-fit:contain;border:1px solid #ddd;border-radius:10px}h2{position:fixed;top:14px;left:50%;transform:translateX(-50%);margin:0;color:#333;font-size:17px}</style>
</head><body><h2>${title}${subtitle ? ` · ${subtitle}` : ""}</h2><img src="${slipUrl}" onload="setTimeout(()=>window.print(),120)" /></body></html>`);
    win.document.close();
    setTimeout(() => setPrinting(false), 700);
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="form-modal slip-view-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">PAYMENT EVIDENCE · หลักฐานการชำระ</span>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
        </div>
        <div className="slip-view-stage">
          {loading || slipUrl === "" ? (
            <div className="slip-view-loading"><FileImage size={26} /><b>กำลังเปิดรูปหลักฐาน…</b><span>ดึงรูปจากระบบให้ครู่เดียว</span></div>
          ) : slipUrl ? (
            <img src={slipUrl} alt="รูปหลักฐานการชำระเงิน" />
          ) : (
            <div className="slip-view-loading"><FileImage size={26} /><b>ไม่พบรูปหลักฐาน</b><span>รายการนี้อาจถูกบันทึกก่อนที่ระบบจะรองรับการแนบรูป หรือยังไม่ได้แนบรูปมาด้วย</span></div>
          )}
        </div>
        <div className="modal-actions">
          <button className="outline-button" onClick={print} disabled={!slipUrl || printing}><Printer size={15} /> พิมพ์รูปนี้</button>
          <button className="outline-button" onClick={download} disabled={!slipUrl}><Download size={15} /> ดาวน์โหลด</button>
          <button className="primary-button" onClick={onClose}><Check size={15} /> เสร็จสิ้น</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * ROUND 63 (user) — ปุ่มเปิดหลักฐาน + โมดัลในตัว: ใช้ซ้ำได้ทั้งในตารางประวัติบิล
 * (kind="sale" → sales.slip) และรายการเติม/ถอนเงินสมาชิก (kind="tx" → member.transactionSlip)
 * · ดึงรูปเฉพาะตอนกดเปิด (enabled) เพื่อไม่ให้ลิสต์หนักด้วย data-URL
 */
export function SlipViewButton({ kind, id, title, subtitle, label }: { kind: "sale" | "tx"; id: number; title: string; subtitle?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const saleSlipQuery = trpc.sales.slip.useQuery({ id }, { enabled: open && kind === "sale" });
  const txSlipQuery = trpc.member.transactionSlip.useQuery({ id }, { enabled: open && kind === "tx" });
  const slipUrl = kind === "sale" ? (saleSlipQuery.data?.slipUrl ?? "") : (txSlipQuery.data?.slipUrl ?? "");
  const loading = kind === "sale" ? saleSlipQuery.isLoading : txSlipQuery.isLoading;
  return <>
    <button type="button" className="row-slip-btn" onClick={(event) => { event.stopPropagation(); setOpen(true); }} title={`ดูหลักฐานการชำระ · ${title}`} aria-label={`ดูหลักฐานการชำระของ ${title}`}><FileImage size={13} />{label ? ` ${label}` : ""}</button>
    <SlipViewModal open={open} title={title} subtitle={subtitle} slipUrl={slipUrl} loading={loading} onClose={() => setOpen(false)} />
  </>;
}
