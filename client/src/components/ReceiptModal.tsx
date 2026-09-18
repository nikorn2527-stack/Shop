import { useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Check, Download, FileImage, Plus, Printer, X } from "lucide-react";
import type { CheckoutReceipt } from "../../../server/sqliteStore";
import { money } from "../pages/pageData";

/** "2026-09-18 14:42:33" → "18 ก.ย. 2569 · 14:42 น." */
function formatReceiptDateTime(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.`;
}

/**
 * Shared receipt modal — extracted from the POS checkout success screen.
 * mode "new"     → POS after checkout (success header + ดาวน์โหลด/พิมพ์/เริ่มรายการขายใหม่)
 * mode "reprint" → Reports ประวัติบิล (พิมพ์ซ้ำ header + ปิดหน้าต่าง instead of new sale)
 * The receipt paper markup is shared verbatim so both flows render identical slips.
 */
export function ReceiptModal({ receipt, onClose, onNewSale, onPrinted, mode = "new" }: {
  receipt: CheckoutReceipt;
  onClose: () => void;
  onNewSale?: () => void;
  onPrinted?: () => void;
  mode?: "new" | "reprint";
}) {
  const [receiptBusy, setReceiptBusy] = useState("");
  const downloadReceipt = async (format: "pdf" | "image") => {
    const element = document.getElementById("receipt-paper");
    if (!element) return;
    setReceiptBusy(format);
    try {
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
      const filename = `${receipt.orderNumber}.${format === "pdf" ? "pdf" : "png"}`;
      if (format === "image") {
        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save(filename);
      }
    } finally { setReceiptBusy(""); }
  };
  const printReceipt = () => { onClose(); onPrinted?.(); };
  return <div className="modal-backdrop" onClick={onClose}><div className="receipt-modal" onClick={(event) => event.stopPropagation()}><div className={`receipt-success${mode === "reprint" ? " reprint" : ""}`}><span>{mode === "reprint" ? <Printer size={22} /> : <Check size={22} />}</span><div><b>{mode === "reprint" ? "พิมพ์ใบเสร็จซ้ำ" : "ชำระเงินสำเร็จ"}</b><small>{mode === "reprint" ? "เรียกดูบิลย้อนหลังจากระบบ" : "ตรวจสอบรายละเอียดก่อนพิมพ์หรือเริ่มรายการใหม่"}</small></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="receipt-paper" id="receipt-paper"><div className="receipt-brand"><div className="brand-mark small"><span>ส</span></div><div><b>ร้านค้าสวัสดิการ รพจ.</b><small>โรงพยาบาลผู้ป่วยจิตเวช</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>ใบเสร็จเลขที่ <b>{receipt.orderNumber}</b></span><span>{formatReceiptDateTime(receipt.createdAt)}</span></div><div className="receipt-customer"><span>ผู้ซื้อ</span><b>{receipt.memberName ? `สมาชิก${receipt.memberName} · ${receipt.memberNumber}` : "บุคคลทั่วไป"}</b></div>{receipt.items.map((item) => <div className="receipt-line" key={`${item.productId}-${item.name}`}><span>{item.name}<small>{item.qty} {item.unit} × {money(item.price)}</small></span><b>{money(item.amount)}</b></div>)}<div className="receipt-line"><span>ยอดรวมสินค้า</span><b>{money(receipt.subtotal)}</b></div>{receipt.discount > 0 && <div className="receipt-line"><span>ส่วนลด</span><b>- {money(receipt.discount)}</b></div>}<div className="receipt-total"><span>ยอดชำระทั้งหมด</span><b>{money(receipt.total)}</b></div><div className="receipt-payment"><span>วิธีชำระเงิน</span><b>{receipt.paymentMethod}</b></div>{receipt.paymentMethod === "หักบัญชีสมาชิก" && receipt.balanceAfter !== null && <div className="receipt-balance"><span>ยอดคงเหลือหลังรายการ</span><b>{money(receipt.balanceAfter)}</b></div>}<div className="receipt-thanks">ขอบคุณที่ใช้บริการ<br /><small>ข้อมูลรายการถูกบันทึกในระบบ Log แล้ว</small></div></div><div className="receipt-actions"><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("pdf")}><Download size={16} /> {receiptBusy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("image")}><FileImage size={16} /> {receiptBusy === "image" ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปภาพ"}</button><button className="outline-button" onClick={printReceipt}><Printer size={16} /> พิมพ์ใบเสร็จ</button>{mode === "new" ? (onNewSale && <button className="primary-button" onClick={onNewSale}><Plus size={16} /> เริ่มรายการขายใหม่</button>) : <button className="outline-button" onClick={onClose}><X size={16} /> ปิดหน้าต่าง</button>}</div></div></div>;
}
