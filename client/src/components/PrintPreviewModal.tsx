import { printElementDocument } from "@/lib/printHelper";
import { useEffect, useRef, useState } from "react";
import { Printer, X } from "@/lib/icons";
import { toast } from "sonner";
import { HelpDisclosure } from "./HelpDisclosure";
import { A4DocumentPreview } from "./A4DocumentPreview";
import { getThermalPrintProfile } from "@/lib/thermalPrint";

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
  card: "บัตรสมาชิก · นามบัตรไทย 90 × 55 มม.",
};

export function PrintPreviewModal({
  targetId,
  title,
  subtitle,
  paper = "thermal",
  chips = [],
  showContentLength = true,
  showPrintHelp = true,
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
  /** แสดงความยาวกระดาษที่คำนวณได้ เหมาะกับใบเสร็จที่มีหลายรายการ */
  showContentLength?: boolean;
  /** แสดงวิธีตั้งค่ากระดาษเพิ่มเติมใต้ปุ่มพิมพ์ */
  showPrintHelp?: boolean;
  /** เรียกหลังสั่ง window.print() แล้ว (ใช้ทำ toast / ล้าง state) */
  onPrint?: () => void;
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);
  // ROUND 80 — ความสูงเนื้อหาจริง (มม.) เพื่อบอกความยาวสลิป + ใส่ @page size
  const [contentMm, setContentMm] = useState<number | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const thermalProfile = getThermalPrintProfile();

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
      const documentPx = doc.getBoundingClientRect().width || stage.clientWidth || 1;
      const widthMm = paper === "a4" ? 210 : paper === "card" ? 90 : thermalProfile.printableWidthMm;
      const heightMm = Math.round((doc.scrollHeight / documentPx) * widthMm);
      if (heightMm > 0 && !Number.isNaN(heightMm)) setContentMm(heightMm);
    };
    const frame = window.requestAnimationFrame(() => { measure(); });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [ready, paper, thermalProfile.printableWidthMm]);

  // Esc closes — same affordance as the export preview modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doPrint = async () => {
    toast.dismiss();
    try {
      await printElementDocument(
        targetId,
        paper === "thermal" ? thermalProfile.paperWidthMm : undefined,
        paper === "thermal" ? contentMm ?? undefined : undefined,
      );
      onPrint?.();
    } catch {
      toast.error("เปิดหน้าต่างพิมพ์ไม่สำเร็จ ลองอีกครั้ง");
    }
  };

  return (
    <div className="modal-backdrop print-preview-scope" onClick={onClose} role="dialog" aria-modal="true" aria-label={`พรีวิวก่อนพิมพ์ ${title}`}>
      <div className={`form-modal print-preview-modal${paper === "a4" ? " export-preview-modal print-preview-a4" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ตรวจสอบก่อนพิมพ์</span>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่างพรีวิว"><X size={17} /></button>
        </div>

        {(chips.length > 0 || (paper === "thermal" && showContentLength && contentMm != null)) && <div className="export-preview-summary">
          {paper === "thermal" && showContentLength && contentMm != null && (
            <span className="preview-chip mute" title="ความยาวที่เนื้อหาต้องการตามจำนวนรายการ">
              ความยาวเนื้อหา ≈ {contentMm.toLocaleString("th-TH")} มม.
            </span>
          )}
          {chips.map((chip) => (
            <span key={chip} className="preview-chip mute">{chip}</span>
          ))}
        </div>}

        {paper === "a4" ? (
          <A4DocumentPreview label={`พรีวิว ${title}`}>
            <div className="print-preview-paper" ref={paperRef} />
            {!ready && <div className="print-preview-empty">กำลังเตรียมตัวอย่างเอกสาร…</div>}
          </A4DocumentPreview>
        ) : (
        <div className={`print-preview-stage paper-${paper}`}>
          <div className="print-preview-paper" ref={paperRef} style={paper === "thermal" ? { width: `${thermalProfile.printableWidthMm * 3.78}px` } : undefined} />
          {!ready && <div className="print-preview-empty">กำลังเตรียมตัวอย่างเอกสาร…</div>}
        </div>
        )}

        {paper === "a4" ? (
          <div className="export-preview-actions">
            <div className="preview-format-list">
              <button type="button" className="preview-format-btn preferred" onClick={doPrint} disabled={!ready}>
                <Printer size={15} /><span><b>พิมพ์</b></span>
                <i className="preferred-dot" aria-hidden="true" />
              </button>
            </div>
            <button type="button" className="ghost-button" onClick={onClose}><X size={15} /> ปิด</button>
          </div>
        ) : (
        <div className="print-preview-actions">
          <div className="print-preview-buttons">
            <button type="button" className="ghost-button" onClick={onClose}><X size={15} /> ปิด</button>
            <button type="button" className="primary-button" onClick={doPrint}><Printer size={16} /> พิมพ์เลย</button>
          </div>
        </div>
        )}

        {paper !== "a4" && showPrintHelp && <HelpDisclosure id="print-length-help" label={paper === "thermal" ? "ตั้งค่ากระดาษ" : "ข้อแนะนำการพิมพ์"}>
          {paper === "thermal" ? (
            <div className="help-disclosure-steps">
              <p><b>ถ้ากระดาษยาวหรือขาด ให้ตรวจการตั้งค่าก่อนพิมพ์</b></p>
              <ol>
                <li>เลือกขอบกระดาษ <b>ไม่มี</b> และปิด <b>หัวและท้ายกระดาษ</b></li>
                <li>เลือกม้วนกระดาษ <b>{thermalProfile.paperWidthMm} มม.</b> และพื้นที่พิมพ์จริง <b>{thermalProfile.printableWidthMm} มม.</b></li>
              </ol>
            </div>
          ) : (
            <div className="help-disclosure-steps">
              <p>เอกสาร A4 พิมพ์ด้วยขอบกระดาษ 8 มม. ตามมาตรฐาน — ถ้าต้องการเต็มหน้า ปรับขอบกระดาษในหน้าต่างพิมพ์เป็น “ไม่มี” ได้</p>
            </div>
          )}
        </HelpDisclosure>}
      </div>
    </div>
  );
}
