import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Printer, Table2, X } from "@/lib/icons";
import type { ReportDocConfig } from "@/reportDoc";
import { buildReportDocumentHtml, thaiStamp } from "@shared/reportDoc";

/**
 * P1-UX-04 — Export preview แยกเป็น 2 มุมมองตามธรรมชาติของ output:
 *  - "เอกสาร A4" (document) = พรีวิวจริงของ PDF/Print (render buildReportDocumentHtml
 *    ใน iframe scale ลง — ใช้ template เดียวกับ server PDF + client print)
 *  - "ข้อมูล" (data) = ตารางตรวจแถว/ยอดรวม (สำหรับ CSV/Excel)
 * ก่อนหน้านี้มีแค่ data table → ผู้ใช้รู้สึก "พรีวิวไม่ตรงไฟล์จริง" เพราะ PDF ใช้ layout อื่น
 * ตอนนี้พรีวิวเอกสาร = PDF = Print (template เดียวกันหมด)
 */

export type ExportFormat = "csv" | "xlsx" | "pdf" | "print";

export type ExportPreviewState = {
  kind: "sales" | "bills" | "transactions" | "stock" | "orders" | "balances" | "stockBalance";
  /** ชื่อรายงานที่โชว์บนโมดัล */
  title: string;
  periodLabel?: string;
  /** มุมมอง/หัวข้อ สำหรับข้อความแจ้งเตือน เช่น "แยกตามสินค้า" */
  label: string;
  /** ชื่อไฟล์ (ไม่รวมนามสกุล) สำหรับ CSV / Excel */
  fileName: string;
  /** ชื่อชีต Excel */
  sheetName: string;
  /** ข้อมูลที่จะส่งออก: แถวแรก = หัวตาราง แถวสุดท้าย = แถวรวม (ถ้ามี) */
  rows: string[][];
  /** ดัชนีคอลัมน์ตัวเลข (ชิดขวา + ทศนิยมใน Excel) */
  numericCols: number[];
  /** รูปแบบที่ผู้ใช้กดเข้ามา — ปุ่มนี้จะถูกไฮไลต์ */
  preferred: ExportFormat;
  /** config เอกสาร A4 สำหรับ PDF / พิมพ์ */
  doc: ReportDocConfig;
  /** แถวสุดท้ายของ rows เป็นแถวรวมหรือไม่ (โชว์ Σ ในพรีวิว) */
  hasTotalsRow: boolean;
  /** ฐานข้อความแจ้งเตือน เช่น "รายงานยอดขาย แยกตามสินค้า" → ดาวน์โหลด… CSV แล้ว */
  downloadNoticeBase: string;
  /** ข้อความแจ้งเตือนตอนสั่งพิมพ์ */
  printNotice: string;
};

const FORMAT_META: Record<ExportFormat, { label: string; hint: string }> = {
  csv: { label: "CSV", hint: "ไฟล์ข้อความ UTF-8 เปิดต่อในระบบอื่นได้" },
  xlsx: { label: "Excel", hint: "ตารางคำนวณต่อได้ คอลัมน์กว้างพอดีเนื้อหา" },
  pdf: { label: "PDF", hint: "เอกสารรายงาน A4 vector พร้อมแถวรวมท้ายตาราง" },
  print: { label: "พิมพ์", hint: "เอกสารเดียวกับ PDF ส่งเครื่องพิมพ์เริ่มต้น" },
};

function formatIcon(format: ExportFormat, size = 15) {
  if (format === "csv") return <Table2 size={size} />;
  if (format === "xlsx") return <FileSpreadsheet size={size} />;
  if (format === "pdf") return <FileText size={size} />;
  return <Printer size={size} />;
}

type PreviewTab = "document" | "data";

export function ExportPreviewModal({
  state,
  onClose,
  onRun,
}: {
  state: ExportPreviewState;
  onClose: () => void;
  onRun: (format: ExportFormat) => void;
}) {
  // Esc ปิดพรีวิวได้เลย — มือถือ/คีย์บอร์ดเข้าถึงเท่ากัน
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // P1-UX-04 — tab เริ่มตามรูปแบบที่ผู้ใช้กดเข้ามา: PDF/Print → เอกสาร A4, CSV/Excel → ข้อมูล
  const [tab, setTab] = useState<PreviewTab>(
    state.preferred === "pdf" || state.preferred === "print" ? "document" : "data",
  );

  const numeric = new Set(state.numericCols);
  const hasTotals = state.hasTotalsRow && state.rows.length > 1;
  const bodyRows = hasTotals ? state.rows.slice(1, -1) : state.rows.slice(1);
  const totalsRow = hasTotals ? state.rows[state.rows.length - 1] : null;
  const headers = state.rows[0] ?? [];

  // P1-UX-04 — build HTML ครั้งเดียว (useMemo) สำหรับ iframe srcDoc
  // ใช้ template เดียวกับ server PDF + client print → พรีวิว = ไฟล์จริง
  const docHtml = useMemo(
    () => buildReportDocumentHtml(state.doc, { mode: "pdf", stampText: `พรีวิวเมื่อ ${thaiStamp(new Date())}` }),
    [state.doc],
  );

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`พรีวิวก่อนส่งออก ${state.title}`}>
      <div className="form-modal export-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">EXPORT PREVIEW</span>
            <h2>{state.title}</h2>
            <p>{state.periodLabel ?? state.label}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่างพรีวิว">
            <X size={17} />
          </button>
        </div>

        {/* P1-UX-04 — สลับมุมมองระหว่าง "เอกสาร A4" (สำหรับ PDF/Print) กับ "ข้อมูล" (สำหรับ CSV/Excel) */}
        <div className="export-preview-tabs" role="tablist" aria-label="เลือกมุมมองพรีวิว">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "document"}
            className={`preview-tab${tab === "document" ? " active" : ""}`}
            onClick={() => setTab("document")}
          >
            <FileText size={14} /> เอกสาร A4
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "data"}
            className={`preview-tab${tab === "data" ? " active" : ""}`}
            onClick={() => setTab("data")}
          >
            <Table2 size={14} /> ข้อมูล ({bodyRows.length} แถว)
          </button>
        </div>

        {tab === "document" ? (
          // P1-UX-04 — A4 document preview: iframe ที่ render buildReportDocumentHtml
          // (template เดียวกับ server PDF + client print) scale ลงให้พอดี modal
          <div className="export-doc-preview" role="tabpanel" aria-label="พรีวิวเอกสาร A4 ที่จะส่งออก">
            <div className="export-doc-scaler">
              <iframe
                title="พรีวิวเอกสาร A4"
                srcDoc={docHtml}
                className="export-doc-iframe"
                loading="lazy"
              />
            </div>
            <p className="export-doc-hint">
              <FileText size={12} /> พรีวิวนี้ใช้ template เดียวกับ PDF/Print ที่จะส่งออก —
              หัวตาราง แถวรวม สรุปย่อย ครบตามไฟล์จริง (A4 portrait · ระยะขอบ 14 มม.)
            </p>
          </div>
        ) : (
          <div className="export-preview-table-wrap" role="tabpanel" aria-label="ตัวอย่างข้อมูลที่จะส่งออก">
            <table className="export-preview-table" aria-label="ตัวอย่างข้อมูลที่จะส่งออก">
              <thead>
                <tr>
                  <th className="rownum" aria-label="ลำดับ">#</th>
                  {headers.map((column, index) => (
                    <th key={`${column}-${index}`} className={numeric.has(index) ? "num" : undefined}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="rownum">{rowIndex + 1}</td>
                    {headers.map((_, index) => (
                      <td key={index} className={numeric.has(index) ? "num" : undefined}>
                        {row[index] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {totalsRow && (
                <tfoot>
                  <tr>
                    <td className="rownum">Σ</td>
                    {headers.map((_, index) => (
                      <td key={index} className={numeric.has(index) ? "num" : undefined}>
                        {totalsRow[index] ?? ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <div className="export-preview-actions">
          <div className="preview-format-list">
            {(["csv", "xlsx", "pdf", "print"] as ExportFormat[]).map((format) => (
              <button
                key={format}
                type="button"
                className={`preview-format-btn${state.preferred === format ? " preferred" : ""}`}
                onClick={() => onRun(format)}
                title={FORMAT_META[format].hint}
              >
                {formatIcon(format)}
                <span>
                  <b>{FORMAT_META[format].label}</b>
                </span>
                {state.preferred === format && <i className="preferred-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            <X size={15} /> ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
