import { reportSellingValue } from "@shared/reportValuation";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Download, Eye, FileBarChart, FileText, Printer } from "@/lib/icons";
import { ThaiDateRangePicker } from "./ThaiDateRangePicker";
import { money } from "@/pages/pageData";
import { formatLogDateTime } from "@/pages/viewFormat";
import { ExportPreviewModal, type ExportFormat, type ExportPreviewState } from "./ExportPreviewModal";
import { downloadCsvFile, downloadXlsxFile, exportNumber } from "@/exportUtils";
import { downloadReportPdf, printReportDoc } from "@/reportDoc";
import { bangkokParts } from "@shared/storeTime";

const today = () => {
  const date = bangkokParts(new Date());
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
};

export function StockReceiptHistory({ canExport, onUpgrade, expanded = false }: { canExport: boolean; onUpgrade?: () => void; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("");
  const [preview, setPreview] = useState<ExportPreviewState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const query = trpc.stock.receipts.useQuery({ from, to, search, actor }, { enabled: open });
  const entries = query.data ?? [];
  const columns = ["วัน–เวลา", "รหัส / สินค้า", "Lot", "จำนวนรับ", "หน่วย", "ราคาต่อหน่วย (ราคาขาย)", "มูลค่ารับเข้า (ราคาขาย)", "ราคาขาย/หน่วย", "มูลค่าราคาขาย", "หมดอายุ", "เจ้าหน้าที่"];
  const rows = entries.map(row => [formatLogDateTime(row.receivedAt), `${row.sku} · ${row.name}`, row.lot,
    row.receivedQty === null ? "ไม่ระบุ" : String(row.receivedQty), row.unit,
    exportNumber(row.sellingPrice), row.receivedQty === null ? "ไม่ระบุ" : exportNumber(reportSellingValue(row.receivedQty, row.sellingPrice)),
    exportNumber(row.sellingPrice), row.sellingValue === null ? "ไม่ระบุ" : exportNumber(row.sellingValue),
    row.expiry ?? "—", row.actor ?? "ไม่ระบุ"]);
  const total = entries.reduce((sum, row) => sum + (row.sellingValue ?? 0), 0);
  const receivedTotal = entries.reduce((sum, row) => sum + (row.receivedQty === null ? 0 : reportSellingValue(row.receivedQty, row.sellingPrice)), 0);
  const unknownValues = entries.filter(row => row.receivedQty === null).length;
  const numericCols = [3, 5, 6, 7, 8];
  const buildExportState = (preferred: ExportFormat = "pdf"): ExportPreviewState => {
    const units = new Map<string, number>();
    for (const row of entries) if (row.receivedQty !== null) units.set(row.unit, (units.get(row.unit) ?? 0) + row.receivedQty);
    const periodLabel = `${from || "ทั้งหมด"} ถึง ${to || "ปัจจุบัน"}${search ? ` · ค้นหา ${search}` : ""}${actor ? ` · เจ้าหน้าที่ ${actor}` : ""}`;
    return { kind: "stock", title: "ประวัติรับเข้าสินค้า", periodLabel, label: "ประวัติรับเข้า", fileName: "stock-receipts",
      sheetName: "ประวัติรับเข้า", rows: [columns, ...rows], numericCols, preferred, hasTotalsRow: false,
      downloadNoticeBase: "ประวัติรับเข้า", printNotice: "สั่งพิมพ์ประวัติรับเข้าแล้ว",
      doc: { fileName: "stock-receipts.pdf", title: "ประวัติรับเข้าสินค้า", periodLabel, columns, rows, numericCols,
        meta: [["จำนวนบรรทัดรับเข้า", String(entries.length)], ["จำนวนตามหน่วย", Array.from(units).map(([unit, qty]) => `${qty} ${unit}`).join(" · ") || "—"], ["มูลค่ารับเข้าตามราคาขาย", money(receivedTotal)], ...(unknownValues ? [["ไม่ระบุจำนวนรับเข้า", `${unknownValues} รายการ`] as [string, string]] : []), ["มูลค่าตามราคาขายปัจจุบัน", money(total)]],
        compact: true, brandName: "ร้านค้าสวัสดิการ" }
    };
  };
  const runExportState = async (state: ExportPreviewState, format: ExportFormat) => {
    setError("");
    try {
      if (format === "csv") downloadCsvFile(state.fileName, state.rows);
      else if (format === "xlsx") downloadXlsxFile(state.fileName, state.sheetName, state.rows, state.numericCols);
      else if (format === "pdf") await downloadReportPdf(state.doc);
      else printReportDoc(state.doc);
    } catch (e) { setError(e instanceof Error ? e.message : "ส่งออกไม่สำเร็จ"); }
  };
  const openExport = async (preferred?: ExportFormat, direct = false) => {
    if (!canExport) { onUpgrade?.(); return; } // ปุ่ม export เปิดได้ทุกเวอร์ชัน — กดแล้วพาไป modal อัปเกรดเหมือนแท็บอื่น
    if (query.isFetching) return;
    if (!entries.length) { setNotice("ยังไม่มีรายการในช่วงที่เลือก — เลือกวันที่มีข้อมูลก่อน"); return; } // ไม่ disable ปุ่ม เดี๋ยวสีจางไม่เท่าหน้าอื่น
    setNotice("");
    const state = buildExportState(preferred);
    if (direct && preferred) await runExportState(state, preferred);
    else setPreview(state);
  };
  const runExport = async (format: ExportFormat) => {
    if (!preview) return;
    await runExportState(preview, format);
  };
  return <section className="panel stock-receipt-history">
    {!expanded && <button type="button" className="outline-button" aria-expanded={open} onClick={() => setOpen(!open)}>ประวัติรับเข้าสินค้า</button>}
    {open && <>
      <h2>ประวัติรับเข้าสินค้า</h2>
      <div className="receipt-history-filters">
        <label className="receipt-date-filter"><span>ช่วงวันที่</span><ThaiDateRangePicker from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} ariaLabel="เลือกช่วงวันที่ประวัติรับเข้า" /></label>
        <label className="receipt-product-filter"><span>สินค้า / SKU / Lot</span><input aria-label="ค้นหาสินค้า SKU หรือ Lot ในประวัติรับเข้า" value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาสินค้าหรือ Lot" /></label>
        <label className="receipt-actor-filter"><span>เจ้าหน้าที่</span><input aria-label="ค้นหาชื่อเจ้าหน้าที่ในประวัติรับเข้า" value={actor} onChange={e => setActor(e.target.value)} placeholder="ค้นหาชื่อเจ้าหน้าที่" /></label>
        <div className="report-export-actions stock-export-actions receipt-export-actions" aria-label="ส่งออกประวัติรับเข้าสินค้า">
          <button type="button" className="outline-button compact export-btn export-csv" onClick={() => void openExport("csv", true)} title="ดาวน์โหลด CSV"><Download size={15} /> CSV</button>
          <button type="button" className="outline-button compact export-btn export-excel" onClick={() => void openExport("xlsx", true)} title="ดาวน์โหลด Excel"><FileBarChart size={15} /> Excel</button>
          <button type="button" className="outline-button compact export-btn export-pdf" onClick={() => void openExport("pdf", true)} title="ดาวน์โหลด PDF"><FileText size={15} /> PDF</button>
          <button type="button" className="outline-button compact export-btn export-print" onClick={() => void openExport("print", true)} title="พิมพ์ประวัติรับเข้า"><Printer size={15} /> พิมพ์</button>
          <button type="button" className="outline-button compact export-btn preview-btn" onClick={() => void openExport()} title="ดูตัวอย่างเอกสารก่อนส่งออก"><Eye size={15} /> ดูพรีวิว</button>
        </div>
      </div>
      <p>{entries.length} บรรทัดรับเข้า · มูลค่ารับเข้าตามราคาขาย {money(receivedTotal)}{unknownValues > 0 ? ` · ไม่ระบุมูลค่า ${unknownValues} รายการ` : ""} · มูลค่าตามราคาขายปัจจุบัน {money(total)}</p>
      {notice && !entries.length && <p role="status">{notice}</p>}
      {query.isLoading ? <p>กำลังโหลด…</p> : query.isError ? <p role="alert">{query.error.message}</p> : <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={entries[index].id}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table>{!entries.length && <p>ไม่มีรายการรับเข้าในช่วงที่เลือก</p>}</div>}
    </>}
    {error && <p role="alert">{error}</p>}
    {preview && <ExportPreviewModal state={preview} onClose={() => setPreview(null)} onRun={format => void runExport(format)} />}
  </section>;
}