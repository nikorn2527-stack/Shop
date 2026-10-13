import { useState } from "react";
import { Printer, X } from "@/lib/icons";
import { money } from "@/pages/pageData";
import { printElementDocument } from "@/lib/printHelper";
import { getThermalPrintProfile } from "@/lib/thermalPrint";

type Props = {
  storeName: string;
  total: number;
  qr: string;
  items: { name: string; qty: number }[];
  onClose: () => void;
  /** FIX (user) — ใบแจ้งชำระต้องพิมพ์กว้างตามตั้งค่า (58/72/80) เหมือนใบเสร็จ ไม่ล็อก 80mm ตายตัว */
  paperWidth?: "58" | "72" | "80";
};

/** A payment request only: printing never invokes checkout or records payment. */
export function PaymentNotice({ storeName, total, qr, items, onClose, paperWidth = "72" }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const profile = getThermalPrintProfile(paperWidth);
  const qrMm = profile.printableWidthMm <= 54 ? 40 : profile.printableWidthMm >= 76 ? 52 : 48;
  async function print() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await printElementDocument("payment-notice-paper", profile.paperWidthMm);
    } catch {
      setError("พิมพ์ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="ใบแจ้งชำระ" onClick={onClose}>
    <div className="form-modal payment-notice-modal" onClick={event => event.stopPropagation()}>
      <div className="modal-heading"><h2>ใบแจ้งชำระ</h2><button className="icon-button" aria-label="ปิดใบแจ้งชำระ" onClick={onClose}><X size={18} /></button></div>
      <div className="payment-notice-paper" id="payment-notice-paper" style={{ width: `${profile.printableWidthMm}mm` }}>
        <h2>ใบแจ้งชำระ</h2><p>{storeName}</p>
        {items.map((item, index) => <div className="payment-notice-item" key={index}><span>{item.name}</span><b>{item.qty}</b></div>)}
        <div className="payment-notice-total">ยอดชำระ {money(total)}</div>
        <img src={qr} alt="QR พร้อมเพย์สำหรับชำระบิลนี้" style={{ width: `${qrMm}mm`, height: `${qrMm}mm` }} />
        <small>ยังไม่ได้รับชำระ · ไม่ใช่ใบเสร็จรับเงิน</small>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button className="outline-button" onClick={onClose}>กลับไปตรวจรับเงิน</button><button className="primary-button" disabled={busy} onClick={() => void print()}><Printer size={16} />{busy ? "กำลังเตรียมเอกสาร…" : "พิมพ์ใบแจ้งชำระ"}</button></div>
    </div>
  </div>;
}