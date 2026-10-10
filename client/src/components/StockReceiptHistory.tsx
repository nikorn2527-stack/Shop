import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Eye } from "@/lib/icons";
import { ThaiDatePicker } from "./ThaiDatePicker";
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

export function StockReceiptHistory({ canExport, expanded = false }: { canExport: boolean; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("");
  const [preview, setPreview] = useState<ExportPreviewState | null>(null);
  const [error, setError] = useState("");
  const query = trpc.stock.receipts.useQuery({ from, to, search, actor }, { enabled: open });
  const entries = query.data ?? [];
  const columns = ["วัน–เวลา", "รหัส / สินค้า", "Lot", "จำนวนรับ", "หน่วย", "ต้นทุน/หน่วย", "มูลค่ารับเข้า", "ราคาขาย/หน่วย", "มูลค่าราคาขาย", "หมดอายุ", "เจ้าหน้าที่"];
  const rows = entries.map(row => [formatLogDateTime(row.receivedAt), `${row.sku} · ${row.name}`, row.lot,
    row.receivedQty === null ? "ไม่ระบุ" : String(row.receivedQty), row.unit,
    row.value === null ? "ไม่ระบุ" : exportNumber(row.cost), row.value === null ? "ไม่ระบุ" : exportNumber(row.value),
    exportNumber(row.sellingPrice), row.sellingValue === null ? "ไม่ระบุ" : exportNumber(row.sellingValue),
    row.expiry ?? "—", row.actor ?? "ไม่ระบุ"]);
  const total = entries.reduce((sum, row) => sum + (row.sellingValue ?? 0), 0);
  const receivedTotal = entries.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const unknownValues = entries.filter(row => row.value === null).length;
  const numericCols = [3, 5, 6, 7, 8];
  const showPreview = () => {
    const units = new Map<string, number>();
    for (const row of entries) if (row.receivedQty !== null) units.set(row.unit, (units.get(row.unit) ?? 0) + row.receivedQty);
    const periodLabel = `${from || "ทั้งหมด"} ถึง ${to || "ปัจจุบัน"}${search ? ` · ค้นหา ${search}` : ""}${actor ? ` · เจ้าหน้าที่ ${actor}` : ""}`;
    setPreview({ kind: "stock", title: "ประวัติรับเข้าสินค้า", periodLabel, label: "ประวัติรับเข้า", fileName: "stock-receipts",
      sheetName: "ประวัติรับเข้า", rows: [columns, ...rows], numericCols, preferred: "pdf", hasTotalsRow: false,
      downloadNoticeBase: "ประวัติรับเข้า", printNotice: "สั่งพิมพ์ประวัติรับเข้าแล้ว",
      doc: { fileName: "stock-receipts.pdf", title: "ประวัติรับเข้าสินค้า", periodLabel, columns, rows, numericCols,
        meta: [["จำนวนบรรทัดรับเข้า", String(entries.length)], ["จำนวนตามหน่วย", Array.from(units).map(([unit, qty]) => `${qty} ${unit}`).join(" · ") || "—"], ["มูลค่ารับเข้าที่ระบุได้", money(receivedTotal)], ...(unknownValues ? [["ไม่ระบุมูลค่ารับเข้า", `${unknownValues} รายการ`] as [string, string]] : []), ["มูลค่าตามราคาขายปัจจุบัน", money(total)]],
        compact: true, brandName: "ร้านค้าสวัสดิการ" }
    });
  };
  const runExport = async (format: ExportFormat) => {
    if (!preview) return;
    setError("");
    try {
      if (format === "csv") downloadCsvFile(preview.fileName, preview.rows);
      else if (format === "xlsx") downloadXlsxFile(preview.fileName, preview.sheetName, preview.rows, preview.numericCols);
      else if (format === "pdf") await downloadReportPdf(preview.doc);
      else printReportDoc(preview.doc);
    } catch (e) { setError(e instanceof Error ? e.message : "ส่งออกไม่สำเร็จ"); }
  };
  return <section className="panel stock-receipt-history">
    {!expanded && <button type="button" className="outline-button" aria-expanded={open} onClick={() => setOpen(!open)}>ประวัติรับเข้าสินค้า</button>}
    {open && <>
      <h2>ประวัติรับเข้าสินค้า</h2>
      <div className="receipt-history-filters">
        <button type="button" className="outline-button" onClick={() => { setFrom(today()); setTo(today()); }}>วันนี้</button>
        <label>ตั้งแต่<ThaiDatePicker value={from} max={to || undefined} onChange={setFrom} ariaLabel="วันเริ่มต้นประวัติรับเข้า" /></label>
        <label>ถึง<ThaiDatePicker value={to} min={from || undefined} onChange={setTo} ariaLabel="วันสิ้นสุดประวัติรับเข้า" /></label>
        <label>สินค้า / SKU / Lot<input value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label>เจ้าหน้าที่<input value={actor} onChange={e => setActor(e.target.value)} /></label>
        <button type="button" className="outline-button" disabled={!canExport || !entries.length || query.isFetching} onClick={showPreview}><Eye size={15} /> พรีวิว / ส่งออก</button>
      </div>
      <p>{entries.length} บรรทัดรับเข้า · มูลค่ารับเข้า {money(receivedTotal)}{unknownValues > 0 ? ` · ไม่ระบุมูลค่า ${unknownValues} รายการ` : ""} · มูลค่าตามราคาขายปัจจุบัน {money(total)}</p>
      {query.isLoading ? <p>กำลังโหลด…</p> : query.isError ? <p role="alert">{query.error.message}</p> : <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={entries[index].id}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table>{!entries.length && <p>ไม่มีรายการรับเข้าในช่วงที่เลือก</p>}</div>}
    </>}
    {error && <p role="alert">{error}</p>}
    {preview && <ExportPreviewModal state={preview} onClose={() => setPreview(null)} onRun={format => void runExport(format)} />}
  </section>;
}