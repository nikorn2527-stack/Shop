import { useRef, useState } from "react";
import { WorkflowDialog } from "./WorkflowDialog";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Bank, Check, Download, FileImage, Plus, Printer, X } from "@/lib/icons";
import type { CheckoutReceipt } from "../../../server/sqliteStore";
import { money } from "../pages/pageData";
import { trpc } from "@/lib/trpc";
import { PrintPreviewModal } from "./PrintPreviewModal";
import { printElementDocument } from "@/lib/printHelper";
import { parseBangkokDate, STORE_TIME_ZONE } from "../../../shared/storeTime";
import { toast } from "sonner";
import { getThermalPrintProfile, thermalContentLeftMm } from "@/lib/thermalPrint";

/** "2026-09-18 14:42:33" → "18 ก.ย. 2569 · 14:42 น." */
function formatReceiptDateTime(value: string) {
  const date = parseBangkokDate(value);
  if (!date) return value;
  return `${date.toLocaleDateString("th-TH", { timeZone: STORE_TIME_ZONE, day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("th-TH", { timeZone: STORE_TIME_ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })} น.`;
}

/**
 * Shared receipt modal — extracted from the POS checkout success screen.
 * mode "new"     → completed sale; print or skip printing, then return to a clean POS
 * mode "reprint" → print an existing receipt, then return to the history view
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
export function ReceiptModal({ receipt, onClose, onNewSale, onPrinted, mode = "new", documentTitle = "ใบเสร็จรับเงิน · ซื้อสินค้า" }: {
  receipt: CheckoutReceipt;
  onClose: () => void;
  onNewSale?: () => void;
  onPrinted?: () => void;
  mode?: "new" | "reprint";
  documentTitle?: string;
}) {
  const [receiptBusy, setReceiptBusy] = useState("");
  const busyRef = useRef(false);
  const [documentError, setDocumentError] = useState("");
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const showBalance = settingsQuery.data?.showBalanceOnReceipt !== false;
  // FIX-26 (user) — ปุ่ม 'พิมพ์' พิมพ์เลย ไม่เข้าพรีวิวก่อน
  // ROUND 25 — แบรนด์ที่ผู้บริหารปรับเอง แสดงบนหัวใบเสร็จด้วย
  const receiptName = (settingsQuery.data?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  // พิมพ์สลิป Thermal ตรง ๆ — ฉีด @page size ให้ตรงความกว้างสลิป (58/72/80 มม.)
  // ก่อนสั่งพิมพ์ ไม่เช่นนั้นเบราว์เซอร์จะใช้กระดาษ A4/Letter ปริ้นใบเสร็จเล็กอยู่กลางหน้า
  // (พรีวิวก่อนพิมพ์ใน PrintPreviewModal ฉีดกฎนี้อยู่แล้ว — เส้นทางตรงนี้เคยขาด)
  const printReceipt = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setDocumentError("");
    setReceiptBusy("printing");
    const profile = getThermalPrintProfile(settingsQuery.data?.receiptPaperWidth);
    try {
      const result = await printElementDocument("receipt-paper", profile.paperWidthMm);
      if (result.usedFallback) {
        toast.info("กลับจากหน้าต่างพิมพ์แล้ว", { description: "ตรวจเอกสารที่เครื่องพิมพ์ หากยกเลิกการพิมพ์สามารถพิมพ์ซ้ำจากประวัติได้" });
      } else {
        toast.info("ส่งงานพิมพ์แล้ว · ตรวจเอกสารที่เครื่องพิมพ์", { description: result.message });
      }
      onPrinted?.();
      if (mode === "new") onNewSale?.();
      else onClose();
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : "ลองตรวจเครื่องพิมพ์แล้วพิมพ์อีกครั้ง");
    } finally { busyRef.current = false; setReceiptBusy(""); }
  };

  // Enter activates the focused button. Never intercept other receipt actions globally.
  const downloadReceipt = async (format: "pdf" | "image") => {
    const element = document.getElementById("receipt-paper");
    if (!element || busyRef.current) return;
    busyRef.current = true;
    setDocumentError("");
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
      const canvas = await html2canvas(element, { scale: 2.0, backgroundColor: "#ffffff", useCORS: true, onclone: (doc) => {
        const paper = doc.getElementById("receipt-paper");
        if (paper) {
          paper.style.lineHeight = "1.8";
          paper.querySelectorAll<HTMLElement>(".receipt-total, .receipt-customer, .receipt-payment, .receipt-balance").forEach(row => {
            row.style.minHeight = "32px";
            row.style.paddingTop = "8px";
            row.style.paddingBottom = "8px";
            row.style.alignItems = "center";
          });
        }
      } });
      const filename = `${receipt.orderNumber}.${format === "pdf" ? "pdf" : "png"}`;
      if (format === "image") {
        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        const profile = getThermalPrintProfile(settingsQuery.data?.receiptPaperWidth);
        const contentHeightMm = (canvas.height / canvas.width) * profile.printableWidthMm;
        const pageHeightMm = contentHeightMm + profile.bottomFeedMm;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [profile.paperWidthMm, pageHeightMm] });
        // ใช้ JPEG quality สูงแทน PNG ลดขนาดไฟล์ + ไม่เพี้ยนสี
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        pdf.addImage(imgData, "JPEG", thermalContentLeftMm(profile), 0, profile.printableWidthMm, contentHeightMm);
        pdf.save(filename);
      }
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : "สร้างเอกสารไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally { busyRef.current = false; setReceiptBusy(""); }
  };
  return <WorkflowDialog title={mode === "new" ? "ชำระเงินสำเร็จ" : "พิมพ์ใบเสร็จซ้ำ"} onClose={onClose} busy={Boolean(receiptBusy)} className="receipt-modal"><div className={`receipt-success${mode === "reprint" ? " reprint" : ""}`}><span>{mode === "reprint" ? <Printer size={22} /> : <Check size={22} />}</span><div><b>{mode === "reprint" ? "พิมพ์ใบเสร็จซ้ำ" : "ชำระเงินสำเร็จ"}</b><small>{mode === "reprint" ? "เรียกดูบิลย้อนหลังจากระบบ" : "บันทึกรายการแล้ว · เลือกพิมพ์หรือกลับ POS เพื่อเริ่มบิลถัดไป"}</small></div><button type="button" className="icon-button" aria-label="ปิดใบเสร็จ" disabled={Boolean(receiptBusy)} onClick={onClose}><X size={17} /></button></div><div className="receipt-paper" id="receipt-paper"><div className="receipt-brand"><div className="receipt-brand-text"><b>{receiptName}</b><small>Welfare Store</small></div></div><h2 className="receipt-document-title">{documentTitle}</h2><div className="receipt-divider" /><div className="receipt-meta"><span>ใบเสร็จเลขที่ <b>{receipt.orderNumber}</b></span><span>{formatReceiptDateTime(receipt.createdAt)}</span></div><div className="receipt-customer"><span>ผู้ซื้อ</span><b>{receipt.memberName ? `สมาชิก${receipt.memberName} · ${receipt.memberNumber}` : "บุคคลทั่วไป"}</b></div>{receipt.items.map((item) => <div className="receipt-line" key={`${item.productId}-${item.name}`}><span>{item.name}<small>{item.qty} {item.unit}{item.price >= 0.05 ? ` × ${money(item.price)}` : ""}</small></span><b>{money(item.amount)}</b></div>)}<div className="receipt-line"><span>ยอดรวมสินค้า</span><b>{money(receipt.subtotal)}</b></div>{receipt.discount > 0 && <div className="receipt-line"><span>ส่วนลด</span><b>- {money(receipt.discount)}</b></div>}<div className="receipt-total"><span>ยอดชำระทั้งหมด</span><b>{money(receipt.total)}</b></div><div className="receipt-payment"><span>วิธีชำระเงิน</span><b>{receipt.paymentMethod}</b></div>{receipt.terminalNumber != null && <div className="receipt-payment"><span>จุดขาย</span><b>{String(receipt.terminalNumber).padStart(2, "0")}</b></div>}<div className="receipt-payment"><span>ผู้ทำรายการ</span><b>{receipt.cashier?.trim() || "เจ้าหน้าที่ร้านค้า"}</b></div>{receipt.memberNumber && receipt.balanceAfter !== null && showBalance && <div className="receipt-balance"><span>ยอดเงินคงเหลือของสมาชิก</span><b>{money(receipt.balanceAfter)}</b></div>}{receipt.paymentMethod === "เงินสด" && receipt.receivedCash != null && <div className="receipt-cash-change"><div className="receipt-line"><span>รับเงินมา</span><b>{money(receipt.receivedCash)}</b></div><div className="receipt-line"><span>ทอนเงิน</span><b>{money(receipt.changeDue ?? 0)}</b></div></div>}{receipt.paymentMethod === "QR / สแกน" && (settingsQuery.data?.bankAccounts ?? []).filter(a => a.active).length > 0 && <div className="receipt-bank-wrap"><div className="receipt-divider" /><div className="receipt-bank-section"><div className="receipt-bank-head"><Bank size={13} /> บัญชีธนาคารร้าน (หากโอนผ่านแอปธนาคาร)</div>{(settingsQuery.data?.bankAccounts ?? []).filter(a => a.active).map(account => <div className="receipt-bank-line" key={account.id}><b>{account.bankName}</b><small>เลขที่ {account.accountNumber}</small><small>ชื่อ {account.accountName}</small>{account.branch && <small>สาขา {account.branch}</small>}{account.note && <small className="muted">{account.note}</small>}</div>)}</div></div>}<div className="receipt-thanks">ขอบคุณที่ใช้บริการ<br /></div></div>{documentError && <div className="receipt-document-error" role="alert"><b>บันทึกรายการขายแล้ว แต่จัดการเอกสารไม่สำเร็จ</b><p>{documentError}</p><small>ลองเอกสารอีกครั้งได้โดยไม่ชำระเงินซ้ำ หรือกลับไปทำรายการถัดไปและพิมพ์จากประวัติ</small></div>}<div className="receipt-actions"><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("pdf")} title="ดาวน์โหลดใบเสร็จเป็น PDF"><Download size={16} /> {receiptBusy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("image")} title="ดาวน์โหลดใบเสร็จเป็นรูปภาพ"><FileImage size={16} /> {receiptBusy === "image" ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปภาพ"}</button><button type="button" autoFocus className="primary-button receipt-print-action" disabled={Boolean(receiptBusy)} onClick={printReceipt}><Printer size={16} /> {receiptBusy === "printing" ? "กำลังจัดการงานพิมพ์…" : mode === "new" ? "พิมพ์และกลับ POS" : "พิมพ์และปิดหน้าต่าง"}</button>{mode === "new" ? (onNewSale && <button type="button" className="outline-button receipt-finish-action" data-action-tone="success" disabled={Boolean(receiptBusy)} onClick={onNewSale}><Plus size={16} /> {documentError ? "กลับ POS · ทำรายการถัดไป" : "ไม่พิมพ์และกลับ POS"}</button>) : <button className="outline-button" disabled={Boolean(receiptBusy)} onClick={onClose}><X size={16} /> ปิดหน้าต่าง</button>}</div></WorkflowDialog>;
}
