import { useEffect, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import { toast } from "sonner";

/**
 * ROUND 51 (user) — "ทุกหน้าที่มีการสั่งพิมพ์ ควรมีการพรีวิวเหมือนกัน"
 * โมดัลพรีวิวกลางก่อนสั่งพิมพ์ทุกชนิดเอกสาร: ใบเสร็จ บัตรสมาชิก รายงานยอดเงิน
 * สลิปเติม/ถอนเงิน สรุปรอบตัดยอด และสลิปทดสอบเครื่องพิมพ์
 *
 * วิธีทำงาน: โคลนเอกสารต้นฉบับ (ตาม targetId) มาแสดงในกรอบกระดาษขนาดจริง
 * (ตัด id ออกทั้งหมดกัน selector ชนกับต้นฉบับ) — ผู้ใช้ตรวจสอบก่อน แล้วกด
 * "พิมพ์เลย" → window.print() โดยตัวเอกสารต้นฉบับยังอยู่ใน DOM ตามปกติ
 * กฎ @media print เดิม (body:has(#target-id)) จึงทำงานเหมือนเดิมทุกประการ
 * ส่วนโมดัลพรีวิวนี้ถูกซ่อนเสมอตอนพิมพ์ผ่านกฎ .print-preview-scope
 */
export type PrintPreviewPaper = "thermal" | "a4" | "card";

const PAPER_LABEL: Record<PrintPreviewPaper, string> = {
  thermal: "สลิป · กระดาษต่อเนื่อง 58–80 มม.",
  a4: "กระดาษ A4 · 210 × 297 มม.",
  card: "บัตรพลาสติก 85.6 × 54 มม. (CR80)",
};

export function PrintPreviewModal({
  targetId,
  title,
  subtitle,
  paper = "thermal",
  chips = [],
  onPrint,
  onClose,
}: {
  /** id ของ element เอกสารที่จะพิมพ์ (ต้องถูก mount ไว้ใน DOM ขณะเปิดพรีวิว) */
  targetId: string;
  title: string;
  subtitle?: string;
  paper?: PrintPreviewPaper;
  /** ข้อมูลเสริม เช่น "3 รายการ · พนักงาน: กัญญาณัฐ" */
  chips?: string[];
  /** เรียกหลังสั่ง window.print() แล้ว (ใช้ทำ toast / ล้าง state) */
  onPrint?: () => void;
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);
  const paperRef = useRef<HTMLDivElement | null>(null);

  // Clone the live document — always reflects the current render (photos,
  // barcodes are data-URL <img> so cloneNode keeps them perfectly).
  useEffect(() => {
    const source = document.getElementById(targetId);
    const holder = paperRef.current;
    if (!source || !holder) return;
    const copy = source.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    copy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    copy.classList.add("print-preview-clone");
    holder.replaceChildren(copy);
    setReady(true);
    return () => setReady(false);
  }, [targetId]);

  // Esc closes — same affordance as the export preview modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doPrint = () => {
    // ROUND 72 (user) — ปิด toast ที่ยังเด้งอยู่ทั้งหมดก่อนสั่งพิมพ์
    // (เคยมีข้อความแจ้งเตือนค้างอยู่บนจอ แล้วหลุดไปติดในสลิปที่พิมพ์ออกมา —
    // คู่กับกฎ @media print ที่ซ่อน [data-sonner-toaster] ใน index.css)
    toast.dismiss();
    window.print();
    onPrint?.();
  };

  return (
    <div className="modal-backdrop print-preview-scope" onClick={onClose} role="dialog" aria-modal="true" aria-label={`พรีวิวก่อนพิมพ์ ${title}`}>
      <div className="form-modal print-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">PRINT PREVIEW</span>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่างพรีวิว"><X size={17} /></button>
        </div>

        <div className="export-preview-summary">
          <span className="preview-chip ok">{PAPER_LABEL[paper]}</span>
          {chips.map((chip) => (
            <span key={chip} className="preview-chip mute">{chip}</span>
          ))}
          <span className="preview-chip mute">พิมพ์จากเครื่องพิมพ์เริ่มต้นของเครื่องนี้</span>
        </div>

        <div className={`print-preview-stage paper-${paper}`}>
          <div className="print-preview-paper" ref={paperRef} />
          {!ready && <div className="print-preview-empty">กำลังเตรียมตัวอย่างเอกสาร…</div>}
        </div>

        <div className="print-preview-actions">
          <span className="print-preview-note">ตรวจข้อมูลด้านบนให้ถูกต้องก่อนกดพิมพ์ — เอกสารที่พิมพ์ออกมาเหมือนตัวอย่างนี้ทุกบรรทัด</span>
          <div className="print-preview-buttons">
            <button type="button" className="ghost-button" onClick={onClose}><X size={15} /> ปิด</button>
            <button type="button" className="primary-button" onClick={doPrint}><Printer size={16} /> พิมพ์เลย</button>
          </div>
        </div>
      </div>
    </div>
  );
}
