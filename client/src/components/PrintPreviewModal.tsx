import { useEffect, useRef, useState } from "react";
import { Printer, X } from "@/lib/icons";
import { toast } from "sonner";
import { HelpDisclosure } from "./HelpDisclosure";

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
 *
 * ROUND 80 (user) — ความยาวกระดาษสลิปตามจำนวนรายการจริง:
 * ก่อน window.print() ระบบฉีดกฎ @page ชั่วคราว (ไฟล์ <style id="print-page-runtime">)
 * · สลิป/กระดาษต่อเนื่อง → margin 0 (เดิม margin 8 มม. กินหัว-ท้ายกระดาษเปลี่ยว ๆ)
 *   พร้อม size ตามความกว้างที่ตั้งไว้ + ความสูงตามเนื้อหาจริงที่วัดจากพรีวิว
 *   (Chrome ยังไม่อ่าน @page size — ตัวช่วยตั้งค่ากระดาษอยู่ใน "ข้อแนะนำ" ด้านล่าง)
 * · A4 → margin 8 มม. เหมือนเดิม
 * กฎฉีดช้ากว่า paper-width-page ของ theme.ts จึงชนะเสมอ และถูกถอดออกทันที
 * หลัง afterprint — ไม่กระทบการพิมพ์ครั้งถัดไป
 */
export type PrintPreviewPaper = "thermal" | "a4" | "card";

const PAPER_LABEL: Record<PrintPreviewPaper, string> = {
  thermal: "สลิป · กระดาษต่อเนื่อง 58–80 มม.",
  a4: "กระดาษ A4 · 210 × 297 มม.",
  card: "บัตรพลาสติก 85.6 × 54 มม. (CR80)",
};

/** ความกว้างกระดาษสลิป (มม.) ตามที่ตั้งใน ตั้งค่า → ใบเสร็จ */
function thermalPaperWidthMm(): number {
  const width = document.documentElement.dataset.paperWidth;
  return width === "58" ? 58 : width === "80" ? 80 : 72;
}

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
  // ROUND 80 — ความสูงเนื้อหาจริง (มม.) เพื่อบอกความยาวสลิป + ใส่ @page size
  const [contentMm, setContentMm] = useState<number | null>(null);
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

  // ROUND 80 — วัดความสูงของเอกสารโคลนแล้วคำนวณเป็นมิลลิเมตร
  // (stage สลิปกว้าง 300px = ความกว้างกระดาษจริง · A4 กว้าง 800px = 210 มม.)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const measure = () => {
      const holder = paperRef.current;
      if (!holder || cancelled) return;
      const stage = holder.closest(".print-preview-stage") as HTMLElement | null;
      const doc = holder.firstElementChild as HTMLElement | null;
      if (!stage || !doc) return;
      const stagePx = stage.clientWidth || 1;
      const widthMm = paper === "a4" ? 210 : paper === "card" ? 85.6 : thermalPaperWidthMm();
      const heightMm = Math.round((doc.scrollHeight / stagePx) * widthMm);
      if (heightMm > 0 && !Number.isNaN(heightMm)) setContentMm(heightMm);
    };
    const frame = window.requestAnimationFrame(() => { measure(); });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [ready, paper]);

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

    // ROUND 80 — ฉีดกฎ @page ให้เหมาะกับชนิดกระดาษของเอกสารนี้ก่อนพิมพ์
    // (สลิป: ไม่มีขอบ + บอกความสูงตามเนื้อหา · A4: ขอบ 8 มม. ตามเดิม)
    const runtimeId = "print-page-runtime";
    let styleEl = document.getElementById(runtimeId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = runtimeId;
      document.head.appendChild(styleEl);
    }
    if (paper === "thermal") {
      const widthMm = thermalPaperWidthMm();
      // +10 มม. กันขาดท้าย (เบราว์เซอร์ที่อ่าน @page size จะได้ไม่ตัดเนื้อหา)
      const heightMm = contentMm != null ? Math.max(60, contentMm + 10) : 0;
      styleEl.textContent = heightMm > 0
        ? `@media print { @page { margin: 0; size: ${widthMm}mm ${heightMm}mm; } .receipt-paper, .receipt-line, .receipt-total, .receipt-meta, .receipt-customer, .receipt-payment, .receipt-balance, .receipt-thanks, .receipt-brand, .receipt-divider { break-inside: avoid; page-break-inside: avoid; } body { margin: 0; padding: 0; } }`
        : `@media print { @page { margin: 0; } .receipt-paper, .receipt-line, .receipt-total, .receipt-meta, .receipt-customer, .receipt-payment, .receipt-balance, .receipt-thanks, .receipt-brand, .receipt-divider { break-inside: avoid; page-break-inside: avoid; } body { margin: 0; padding: 0; } }`;
    } else {
      styleEl.textContent = `@media print { @page { margin: 8mm; } }`;
    }
    const cleanup = () => {
      styleEl?.remove();
      document.body.classList.remove("printing-receipt");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // ปีกไฟล์ Chrome บางรุ่นไม่ยิง afterprint — เผื่อไว้ถอดเอง
    window.setTimeout(cleanup, 4000);

    // เพิ่ม class เพื่อซ่อนส่วนอื่นขณะพิมพ์ (รองรับเบราว์เซอร์ที่ไม่มี :has)
    document.body.classList.add("printing-receipt");
    window.print();
    document.body.classList.remove("printing-receipt");
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
          {paper === "thermal" && contentMm != null && (
            <span className="preview-chip mute" title="ความยาวที่เนื้อหาต้องการตามจำนวนรายการ">
              ความยาวเนื้อหา ≈ {contentMm.toLocaleString("th-TH")} มม.
            </span>
          )}
          {chips.map((chip) => (
            <span key={chip} className="preview-chip mute">{chip}</span>
          ))}
        </div>

        <div className={`print-preview-stage paper-${paper}`}>
          <div className="print-preview-paper" ref={paperRef} />
          {!ready && <div className="print-preview-empty">กำลังเตรียมตัวอย่างเอกสาร…</div>}
        </div>

        <div className="print-preview-actions">
          <div className="print-preview-buttons">
            <button type="button" className="ghost-button" onClick={onClose}><X size={15} /> ปิด</button>
            <button type="button" className="primary-button" onClick={doPrint}><Printer size={16} /> พิมพ์เลย</button>
          </div>
        </div>

        <HelpDisclosure id="print-length-help" label={paper === "thermal" ? "พิมพ์แล้วกระดาษยาวเกิน / ขาด?" : "ข้อแนะนำการพิมพ์"}>
          {paper === "thermal" ? (
            <div className="help-disclosure-steps">
              <p><b>ความยาวกระดาษเท่าไร มาจาก "ขนาดกระดาษ" ในไดรเวอร์เครื่องพิมพ์</b> — ระบบจัดหน้าให้เนื้อหายาวตามรายการสินค้าแล้ว (ไม่มีขอบกระดาษ) ถ้าออกมาแล้วมีส่วนเกิน ปรับตามนี้:</p>
              <ol>
                <li>หน้าต่างพิมพ์ของ Chrome → <b>การตั้งค่าเพิ่มเติม</b> → ขอบกระดาษ = <b>ไม่มี (None)</b> และปิด <b>หัว-ท้ายกระดาษ</b> (Headers and footers)</li>
                <li>ตรวจ <b>ขนาดกระดาษ</b> ให้กว้างตรงเครื่อง (เช่น 72×มม.) — ถ้ามีตัวเลือกความสูงหลายแบบ เลือกแบบที่สูงใกล้ความยาวสลิปจริง</li>
                <li>ยังยาวอยู่: ไปที่ <b>Windows การตั้งค่า → อุปกรณ์ → เครื่องพิมพ์ → ปรับแต่งการพิมพ์ (Printing preferences) → ขนาดกระดาษ</b> ตั้งความสูงกระดาษให้เท่ากับสลิปที่พิมพ์บ่อยที่สุด — ตั้งครั้งเดียวทุกสลิปจะออกพอดี</li>
              </ol>
              <p className="help-disclosure-muted">ทดสอบง่าย ๆ ได้ที่ ตั้งค่า → เครื่องมือติดตั้งระบบ → พิมพ์สลิปทดสอบ</p>
            </div>
          ) : (
            <div className="help-disclosure-steps">
              <p>เอกสาร A4 พิมพ์ด้วยขอบกระดาษ 8 มม. ตามมาตรฐาน — ถ้าต้องการเต็มหน้า ปรับขอบกระดาษในหน้าต่างพิมพ์เป็น “ไม่มี” ได้</p>
            </div>
          )}
        </HelpDisclosure>
      </div>
    </div>
  );
}
