import { useMemo, useState } from "react";
import { WorkflowDialog } from "./WorkflowDialog";
import { A4DocumentPreview } from "./A4DocumentPreview";
import { ThaiDateRangePicker } from "./ThaiDateRangePicker";
import { FileCsv, FileSpreadsheet, FilePdf, Printer, X } from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import { downloadCsvFile, downloadXlsxFile } from "@/exportUtils";
import { downloadReportPdf, printReportDoc } from "@/reportDoc";
import { buildReportDocumentHtml } from "@shared/reportDoc";
import { bangkokParts } from "@shared/storeTime";
import { memberStatementExport } from "@/lib/memberStatementExport";
import type { ExportFormat } from "./ExportPreviewModal";

/** Dedicated read-only source: full history, independent of the 50-row profile preview. */
export function StatementModal({
  memberNumber,
  onClose,
}: {
  memberNumber: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState("");
  const settings = trpc.settings.get.useQuery(undefined);
  const statement = trpc.member.statement.useQuery(
    { memberNumber, from, to },
    { staleTime: 0, refetchOnMount: "always" }
  );
  const generatedAt = useMemo(() => new Date(), [statement.data]);
  const exportData = useMemo(
    () =>
      statement.data
        ? memberStatementExport(statement.data, {
            brandName: settings.data?.appName?.trim() || "ร้านค้าสวัสดิการ",
            storeAddress: settings.data?.storeAddress,
            generatedAt,
          })
        : null,
    [statement.data, settings.data, generatedAt]
  );
  const html = useMemo(
    () =>
      exportData
        ? buildReportDocumentHtml(exportData.doc, {
            mode: "preview",
            stampText: "",
          })
        : "",
    [exportData]
  );
  const unavailable =
    Boolean(busy) || statement.isFetching || statement.isError || !exportData;
  const run = async (format: ExportFormat) => {
    if (unavailable || !exportData) return;
    setBusy(format);
    setError("");
    try {
      if (format === "csv")
        downloadCsvFile(exportData.fileName, exportData.rows);
      else if (format === "xlsx")
        downloadXlsxFile(
          exportData.fileName,
          "รายการเดินบัญชีสมาชิก",
          exportData.rows,
          exportData.numericCols,
          exportData.headerRowIndex
        );
      else if (format === "pdf") await downloadReportPdf(exportData.doc);
      else printReportDoc(exportData.doc);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "ส่งออกไม่สำเร็จ กรุณาลองอีกครั้ง"
      );
    } finally {
      setBusy(null);
    }
  };
  const thisMonth = () => {
    const now = bangkokParts(new Date());
    const month = String(now.month).padStart(2, "0");
    setFrom(`${now.year}-${month}-01`);
    setTo(`${now.year}-${month}-${String(now.day).padStart(2, "0")}`);
  };
  const formats = [
    { key: "csv", label: "CSV", Icon: FileCsv },
    { key: "xlsx", label: "Excel", Icon: FileSpreadsheet },
    { key: "pdf", label: "PDF", Icon: FilePdf },
    { key: "print", label: "พิมพ์", Icon: Printer },
  ] as const;
  return (
    <WorkflowDialog
      title="รายการเดินบัญชีสมาชิก"
      onClose={onClose}
      busy={Boolean(busy)}
      className="statement-modal"
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">MEMBER STATEMENT</span>
          <h2>รายการเดินบัญชีสมาชิก</h2>
          <p>
            เลขสมาชิก {memberNumber} ·
            รายการเงินในบัตรและรายละเอียดสินค้าแยกตามบิล
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="ปิดรายการเดินบัญชี"
          disabled={Boolean(busy)}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="statement-filters">
        <label>
          <span>ช่วงวันที่ทำรายการ</span>
          <ThaiDateRangePicker
            from={from}
            to={to}
            onChange={(a, b) => {
              if (!busy) {
                setFrom(a);
                setTo(b);
              }
            }}
            ariaLabel="เลือกช่วงวันที่รายการเดินบัญชี"
            placeholder="ประวัติทั้งหมด"
          />
        </label>
        <button
          type="button"
          className="outline-button"
          disabled={Boolean(busy)}
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          ทั้งหมด
        </button>
        <button
          type="button"
          className="outline-button"
          disabled={Boolean(busy)}
          onClick={thisMonth}
        >
          เดือนนี้
        </button>
      </div>
      {(error || statement.isError) && (
        <div className="notice-bar error" role="alert">
          {error || statement.error?.message}
          <button
            type="button"
            className="outline-button"
            disabled={Boolean(busy)}
            onClick={() => {
              setError("");
              void statement.refetch();
            }}
          >
            ลองอีกครั้ง
          </button>
        </div>
      )}
      <div className="statement-stage">
        {statement.isFetching ? (
          <p role="status">กำลังโหลดรายการเดินบัญชีและรายละเอียดสินค้า…</p>
        ) : !statement.isError && exportData ? (
          <>
            <p className="statement-hint" role="status">
              {statement.data?.entries.length === 0
                ? "ไม่มีรายการในช่วงที่เลือก · แสดงยอดยกมาและยอดปลายช่วง"
                : `${statement.data?.ledgerCount} รายการเงินในบัตร · ${statement.data?.purchaseCount} บิลซื้อสินค้า`}
            </p>
            <A4DocumentPreview html={html} label="พรีวิวรายการเดินบัญชีสมาชิก A4" />
          </>
        ) : null}
      </div>
      <div className="statement-actions modal-actions">
        <span className="statement-hint">A4 · ครบทุกรายการในช่วงที่เลือก</span>
        <div className="preview-format-list">
          {formats.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`preview-format-btn format-${key}`}
              disabled={unavailable}
              onClick={() => void run(key)}
            >
              <Icon size={16} />
              <b>{busy === key ? "กำลังดำเนินการ…" : label}</b>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ghost-button"
          disabled={Boolean(busy)}
          onClick={onClose}
        >
          ปิด
        </button>
      </div>
    </WorkflowDialog>
  );
}
