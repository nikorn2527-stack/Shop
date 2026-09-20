import { useEffect } from "react";
import { FileSpreadsheet, FileText, Printer, Table2, X } from "lucide-react";
import type { ReportDocConfig } from "@/reportDoc";

/**
 * ROUND 48 (user) — "ก่อนจะ Export ควรมีพรีวิวดูก่อนได้"
 * ทุกปุ่มส่งออก (CSV / Excel / PDF / พิมพ์) เปิดโมดัลนี้ก่อนเสมอ: เห็นหัวตาราง
 * ข้อมูลทุกแถว และแถวรวม ตรงกับที่จะได้ในไฟล์จริง แล้วจึงกดยืนยันรูปแบบที่ต้องการ
 * ปุ่มที่ผู้ใช้กดเข้ามาจะถูกไฮไลต์ไว้ให้เห็นว่ารูปแบบไหนกำลังจะส่งออก
 */

export type ExportFormat = "csv" | "xlsx" | "pdf" | "print";

export type ExportPreviewState = {
  kind: "sales" | "bills" | "transactions";
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
  pdf: { label: "PDF", hint: "เอกสารรายงาน A4 พร้อมแถวรวมท้ายตาราง" },
  print: { label: "พิมพ์", hint: "เอกสารเดียวกับ PDF ส่งเครื่องพิมพ์เริ่มต้น" },
};

function formatIcon(format: ExportFormat, size = 15) {
  if (format === "csv") return <Table2 size={size} />;
  if (format === "xlsx") return <FileSpreadsheet size={size} />;
  if (format === "pdf") return <FileText size={size} />;
  return <Printer size={size} />;
}

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

  const numeric = new Set(state.numericCols);
  const hasTotals = state.hasTotalsRow && state.rows.length > 1;
  const bodyRows = hasTotals ? state.rows.slice(1, -1) : state.rows.slice(1);
  const totalsRow = hasTotals ? state.rows[state.rows.length - 1] : null;
  const headers = state.rows[0] ?? [];

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

        <div className="export-preview-summary">
          <span className="preview-chip">
            <Table2 size={13} /> {bodyRows.length.toLocaleString("th-TH")} แถวข้อมูล
          </span>
          <span className="preview-chip">{headers.length} คอลัมน์</span>
          {totalsRow && <span className="preview-chip ok">พร้อมแถวรวมท้ายตาราง</span>}
          <span className="preview-chip mute">ไฟล์: {state.fileName}.csv / .xlsx / .pdf</span>
        </div>

        <div className="export-preview-table-wrap">
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
                  <small>{FORMAT_META[format].hint}</small>
                </span>
                {state.preferred === format && <i className="preferred-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            ปิดหน้าต่างนี้
          </button>
        </div>
      </div>
    </div>
  );
}
