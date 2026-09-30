import { useEffect, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Bank, Check, Download, FileImage, Plus, Printer, X } from "@/lib/icons";
import type { CheckoutReceipt } from "../../../server/sqliteStore";
import { money } from "../pages/pageData";
import { trpc } from "@/lib/trpc";
import { PrintPreviewModal } from "./PrintPreviewModal";

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
 *
 * ROUND 75 (user) — หน้าแจ้งผลหลังชำระเงินเป็นฟอร์แมตเดียวกันทุกจุด:
 * พิมพ์ได้ · บันทึกรูปได้ · ดาวน์โหลด PDF ได้ และ **ไม่เด้งไปหน้าสั่งพิมพ์เอง**
 * (เดิมตั้งค่า "พิมพ์ใบเสร็จอัตโนมัติ" เปิดไว้จะ window.print() ทันทีที่ชำระเสร็จ
 * — ตอนนี้ลบพฤติกรรมนี้ออกแล้ว พิมพ์เมื่อผู้ใช้กดปุ่มเท่านั้น)
 * showBalance → "แสดงยอดคงเหลือสมาชิกบนใบเสร็จ": read live from settings so every
 *              receipt (new + reprint) honors the toggle. Defaults to shown
 *              while settings load, matching the original behavior.
 *
 * Round 31 — every slip now names ผู้ทำรายการ (cashier) and shows the member's
 * remaining balance on ALL member bills (cash / QR included — the balance
 * simply stays put, but the cashier and member still see it).
 */
export function ReceiptModal({ receipt, onClose, onNewSale, onPrinted, mode = "new" }: {
  receipt: CheckoutReceipt;
  onClose: () => void;
  onNewSale?: () => void;
  onPrinted?: () => void;
  mode?: "new" | "reprint";
}) {
  const [receiptBusy, setReceiptBusy] = useState("");
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const showBalance = settingsQuery.data?.showBalanceOnReceipt !== false;
  // FIX-8 (user) — พรีวิวก่อนพิมพ์: default true (ปลอดภัย) — owner ปิดเพื่อ window.print() ทันทีเมื่อกดปุ่มพิมพ์
  const printPreviewBefore = settingsQuery.data?.printPreviewBefore !== false;
  // FIX-9 (user) — ชื่อเครื่องพิมพ์ที่บันทึกไว้ — แสดงใน tooltip ของปุ่มพิมพ์ (browser ยังถามเองใน dialog)
  const printerName = (settingsQuery.data?.defaultPrinterName ?? "").trim();
  // ROUND 25 — แบรนด์ที่ผู้บริหารปรับเอง แสดงบนหัวใบเสร็จด้วย
  const receiptName = (settingsQuery.data?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  // ROUND 51 — ปุ่มพิมพ์เปิดพรีวิวก่อนเสมอ (เหมือนจุดพิมพ์อื่นทั้งระบบ)
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  // FIX-8 — directPrint: กดปุ่มพิมพ์แล้ว window.print() ทันที (skip preview)
  // ใช้เมื่อ printPreviewBefore = false — ผู้ใช้จะเห็น print dialog ของ browser เลย
  const directPrint = () => {
    if (printPreviewBefore) {
      setPrintPreviewOpen(true);
    } else {
      // ใช้ PrintPreviewModal's print mechanism โดยตรง — เปิด preview ชั่วคราวแล้ว auto-trigger print
      // แต่เพื่อความเร็ว — printPreviewBefore=false จะ window.print() ทันที
      // (browser จะถาม printer เอง ผู้ใช้เลือกเครื่องพิมพ์ใน dialog)
      window.print();
      onPrinted?.();
    }
  };
  const printReceipt = () => directPrint();
  // FIX-8 — Enter key = สั่งพิมพ์ทันที (shortcut ของปุ่มหลัก) เมื่อ modal เปิดอยู่
  // ไม่ใช้ Enter ตอน focus อยู่ใน input เพื่อกัน accidental print ตอนพิมพ์
  useEffect(() => {
    if (mode !== "new") return; // โหมด reprint ไม่ผูก Enter (กันกดผิด)
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      directPrint();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printPreviewBefore, mode]);
  const downloadReceipt = async (format: "pdf" | "image") => {
    const element = document.getElementById("receipt-paper");
    if (!element) return;
    setReceiptBusy(format);
    try {
      // รอ Sarabun font load ก่อน html2canvas (กันตัวอักษรเพี้ยนใน PDF)
      if (document.fonts) {
        try {
          await Promise.all([
            document.fonts.load("400 16px Sarabun", "กาabc"),
            document.fonts.load("600 16px Sarabun", "กาabc"),
            document.fonts.load("700 16px Sarabun", "กาabc"),
          ]);
          await document.fonts.ready;
        } catch {}
      }
      // scale 2.0 พอ — สูงกว่านี้ไฟล์ใหญ่ + บางเครื่อง render เพี้ยน
      const canvas = await html2canvas(element, { scale: 2.0, backgroundColor: "#ffffff", useCORS: true });
      const filename = `${receipt.orderNumber}.${format === "pdf" ? "pdf" : "png"}`;
      if (format === "image") {
        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        // ใช้ความกว้างกระดาษจาก settings (58/72/80 มม.) แทนค่าตายตัว 80
        const paperWidth = settingsQuery.data?.receiptPaperWidth ?? "72";
        const WIDTH_MM = paperWidth === "58" ? 58 : paperWidth === "80" ? 80 : 72;
        const pageHeightMm = (canvas.height / canvas.width) * WIDTH_MM;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [WIDTH_MM, pageHeightMm] });
        // ใช้ JPEG quality สูงแทน PNG ลดขนาดไฟล์ + ไม่เพี้ยนสี
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        pdf.addImage(imgData, "JPEG", 0, 0, WIDTH_MM, pageHeightMm);
        pdf.save(filename);
      }
    } finally { setReceiptBusy(""); }
  };
  return <div className="modal-backdrop" onClick={onClose}><div className="receipt-modal" onClick={(event) => event.stopPropagation()}><div className={`receipt-success${mode === "reprint" ? " reprint" : ""}`}><span>{mode === "reprint" ? <Printer size={22} /> : <Check size={22} />}</span><div><b>{mode === "reprint" ? "พิมพ์ใบเสร็จซ้ำ" : "ชำระเงินสำเร็จ"}</b><small>{mode === "reprint" ? "เรียกดูบิลย้อนหลังจากระบบ" : "ตรวจสอบรายละเอียดก่อนพิมพ์หรือเริ่มรายการใหม่"}</small></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="receipt-paper" id="receipt-paper"><div className="receipt-brand"><div className="receipt-brand-text"><b>{receiptName}</b><small>Welfare Store</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>ใบเสร็จเลขที่ <b>{receipt.orderNumber}</b></span><span>{formatReceiptDateTime(receipt.createdAt)}</span></div><div className="receipt-customer"><span>ผู้ซื้อ</span><b>{receipt.memberName ? `สมาชิก${receipt.memberName} · ${receipt.memberNumber}` : "บุคคลทั่วไป"}</b></div>{receipt.items.map((item) => <div className="receipt-line" key={`${item.productId}-${item.name}`}><span>{item.name}<small>{item.qty} {item.unit}{item.price >= 0.05 ? ` × ${money(item.price)}` : ""}</small></span><b>{money(item.amount)}</b></div>)}<div className="receipt-line"><span>ยอดรวมสินค้า</span><b>{money(receipt.subtotal)}</b></div>{receipt.discount > 0 && <div className="receipt-line"><span>ส่วนลด</span><b>- {money(receipt.discount)}</b></div>}<div className="receipt-total"><span>ยอดชำระทั้งหมด</span><b>{money(receipt.total)}</b></div><div className="receipt-payment"><span>วิธีชำระเงิน</span><b>{receipt.paymentMethod}</b></div><div className="receipt-payment"><span>ผู้ทำรายการ</span><b>{receipt.cashier?.trim() || "เจ้าหน้าที่ร้านค้า"}</b></div>{receipt.memberNumber && receipt.balanceAfter !== null && showBalance && <div className="receipt-balance"><span>ยอดเงินคงเหลือของสมาชิก</span><b>{money(receipt.balanceAfter)}</b></div>}{receipt.paymentMethod === "เงินสด" && receipt.receivedCash != null && <div className="receipt-cash-change"><div className="receipt-line"><span>รับเงินมา</span><b>{money(receipt.receivedCash)}</b></div><div className="receipt-line"><span>ทอนเงิน</span><b>{money(receipt.changeDue ?? 0)}</b></div></div>}{receipt.paymentMethod === "QR / สแกน" && (settingsQuery.data?.bankAccounts ?? []).filter(a => a.active).length > 0 && <div className="receipt-bank-wrap"><div className="receipt-divider" /><div className="receipt-bank-section"><div className="receipt-bank-head"><Bank size={13} /> บัญชีธนาคารร้าน (หากโอนผ่านแอปธนาคาร)</div>{(settingsQuery.data?.bankAccounts ?? []).filter(a => a.active).map(account => <div className="receipt-bank-line" key={account.id}><b>{account.bankName}</b><small>เลขที่ {account.accountNumber}</small><small>ชื่อ {account.accountName}</small>{account.branch && <small>สาขา {account.branch}</small>}{account.note && <small className="muted">{account.note}</small>}</div>)}</div></div>}<div className="receipt-thanks">ขอบคุณที่ใช้บริการ<br /><small>ข้อมูลรายการถูกบันทึกในระบบ Log แล้ว</small><small className="receipt-powered">⚡ Powered by PNG TEAM</small></div></div><div className="receipt-actions"><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("pdf")}><Download size={16} /> {receiptBusy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("image")}><FileImage size={16} /> {receiptBusy === "image" ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปภาพ"}</button><button className="outline-button" onClick={printReceipt} title={`พิมพ์ใบเสร็จ${printPreviewBefore ? " (พรีวิวก่อน — ปิดได้ที่ ตั้งค่า → ใบเสร็จและเครื่องพิมพ์)" : " (พิมพ์ทันที — Enter)"}${printerName ? ` · เครื่องพิมพ์ที่บันทึกไว้: ${printerName}` : " · ยังไม่ได้ตั้งชื่อเครื่องพิมพ์"}`}><Printer size={16} /> พิมพ์ใบเสร็จ{!printPreviewBefore && <kbd className="enter-hint">Enter</kbd>}{printerName && <span className="printer-name-hint">🖨 {printerName}</span>}</button>{mode === "new" ? (onNewSale && <button className="primary-button" onClick={onNewSale}><Plus size={16} /> เริ่มรายการขายใหม่</button>) : <button className="outline-button" onClick={onClose}><X size={16} /> ปิดหน้าต่าง</button>}</div>{printPreviewOpen && <PrintPreviewModal targetId="receipt-paper" title="พรีวิวก่อนพิมพ์ใบเสร็จ" subtitle={`บิล ${receipt.orderNumber} · ${formatReceiptDateTime(receipt.createdAt)}`} paper="thermal" chips={[`${receipt.items.length} รายการ`, `ยอดรวม ${money(receipt.total)}`, receipt.memberName ? `สมาชิก ${receipt.memberNumber}` : "บุคคลทั่วไป"]} onClose={() => setPrintPreviewOpen(false)} onPrint={() => onPrinted?.()} />}</div></div>;
}
