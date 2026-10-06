import { useEffect, useMemo } from "react";
import { FileSpreadsheet, FileText, Printer, Table2, X } from "@/lib/icons";
import type { ReportDocConfig } from "@/reportDoc";
import { buildReportDocumentHtml, thaiStamp } from "@shared/reportDoc";
import { A4DocumentPreview } from "./A4DocumentPreview";

/**
 * ExportPreviewModal — พรีวิวเอกสาร A4 ก่อนส่งออก (CSV/Excel/PDF/พิมพ์)
 * P1-UX-04 (owner rev): ลบ tabs "เอกสาร A4" / "ข้อมูล N แถว" ออก —
 * เหลือแค่พรีวิวเอกสาร A4 เดียว (template เดียวกับ server PDF + client print)
 * พื้นหลังขาวสะอาด (ไม่มี gray wrapper) สัดส่วน A4 ถูกต้อง
 */

export type ExportFormat = "csv" | "xlsx" | "pdf" | "print";

export type ExportPreviewState = {
  kind: "sales" | "bills" | "transactions" | "stock" | "orders" | "balances" | "stockBalance";
  title: string;
  periodLabel?: string;
  label: string;
  fileName: string;
  sheetName: string;
  rows: string[][];
  numericCols: number[];
  preferred: ExportFormat;
  doc: ReportDocConfig;
  hasTotalsRow: boolean;
  downloadNoticeBase: string;
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

export function ExportPreviewModal({
  state,
  onClose,
  onRun,
}: {
  state: ExportPreviewState;
  onClose: () => void;
  onRun: (format: ExportFormat) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const docHtml = useMemo(
    () => buildReportDocumentHtml(state.doc, { mode: "preview", stampText: `พรีวิวเมื่อ ${thaiStamp(new Date())}` }),
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

        <A4DocumentPreview html={docHtml} label="พรีวิวเอกสาร A4 ที่จะส่งออก" />

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
