import { useRef, useState } from "react";
import { Printer, X } from "@/lib/icons";
import { money } from "@/pages/pageData";

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
  const documentRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const widthMm = paperWidth === "58" ? 58 : paperWidth === "80" ? 80 : 72;
  const qrMm = widthMm === 58 ? 40 : widthMm === 80 ? 52 : 48;
  async function print() {
    if (busy || !documentRef.current) return;
    setBusy(true);
    setError("");
    const frame = document.createElement("iframe");
    frame.title = "เอกสารสำหรับพิมพ์ใบแจ้งชำระ";
    frame.style.cssText = "position:fixed;left:-10000px;width:302px;height:600px;border:0";
    document.body.appendChild(frame);
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) throw new Error("ไม่สามารถเปิดเอกสารสำหรับพิมพ์ได้");
      doc.open();
      doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบแจ้งชำระ</title><style>@page{size:${widthMm}mm auto;margin:0}body{margin:0;color:#000;background:#fff;font:14px Tahoma,sans-serif}.payment-notice-paper{box-sizing:border-box;width:${widthMm}mm;padding:5mm}h2{font-size:18px;margin:8px 0;text-align:center}p{text-align:center;margin:6px 0}.payment-notice-item{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #ddd}.payment-notice-total{font-size:20px;font-weight:bold;text-align:center;margin:12px 0}img{display:block;width:${qrMm}mm;height:${qrMm}mm;margin:8px auto}small{display:block;text-align:center}</style></head><body>${documentRef.current.outerHTML}</body></html>`);
      doc.close();
      await doc.fonts.ready;
      await Promise.all(Array.from(doc.images).map(image => image.decode()));
      const cleanup = () => frame.remove();
      win.addEventListener("afterprint", cleanup, { once: true });
      win.focus();
      win.print();
      // Keep the document alive for asynchronous browser print dialogs.
      window.setTimeout(cleanup, 60000);
    } catch {
      frame.remove();
      setError("พิมพ์ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="ใบแจ้งชำระ" onClick={onClose}>
    <div className="form-modal payment-notice-modal" onClick={event => event.stopPropagation()}>
      <div className="modal-heading"><h2>ใบแจ้งชำระ</h2><button className="icon-button" aria-label="ปิดใบแจ้งชำระ" onClick={onClose}><X size={18} /></button></div>
      <div className="payment-notice-paper" ref={documentRef}>
        <h2>ใบแจ้งชำระ</h2><p>{storeName}</p>
        {items.map((item, index) => <div className="payment-notice-item" key={index}><span>{item.name}</span><b>{item.qty}</b></div>)}
        <div className="payment-notice-total">ยอดชำระ {money(total)}</div>
        <img src={qr} alt="QR พร้อมเพย์สำหรับชำระบิลนี้" />
        <small>ยังไม่ได้รับชำระ · ไม่ใช่ใบเสร็จรับเงิน</small>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button className="outline-button" onClick={onClose}>กลับไปตรวจรับเงิน</button><button className="primary-button" disabled={busy} onClick={() => void print()}><Printer size={16} />{busy ? "กำลังเตรียมเอกสาร…" : "พิมพ์ใบแจ้งชำระ"}</button></div>
    </div>
  </div>;
}