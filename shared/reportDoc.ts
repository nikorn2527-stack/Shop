/**
 * P0-UX-03 — Shared report document template (single source of truth).
 *
 * ไฟล์นี้ import ได้ทั้ง client (Vite) และ server (tsx) เพราะเป็น pure JS
 * ไม่ใช้ browser API (ไม่มี document/window) — สร้าง HTML string เปล่าๆ
 *
 * ใช้โดย:
 *  - client `printReportDoc` (iframe + window.print) → vector text ผ่าน browser
 *  - server `/api/report/pdf` (Puppeteer page.pdf) → vector PDF จริง (selectable text)
 * ทำให้ PDF (vector) = Print (vector) = template เดียวกัน
 *
 * ก่อนหน้านี้ PDF ใช้ html2canvas → JPEG/PNG → jsPDF (raster เบลอ copy ไม่ได้)
 * ตอนนี้ PDF ผ่าน server Chromium printToPDF → vector (คม และ select/copy ได้)
 */

export type ReportDocConfig = {
  fileName: string;
  title: string;
  /** เช่น "1 ก.ย. 2569 → 30 ก.ย. 2569 · 30 วัน" */
  periodLabel?: string;
  /** คู่ [ป้าย, ค่า] แสดงเป็นแถวข้อมูลใต้หัวเรื่อง เช่น ["ผู้ทำรายการ", "วรพจน์"] */
  meta?: [string, string][];
  columns: string[];
  /** สัดส่วนความกว้างคอลัมน์ เช่น ["14%", "12%"] — ใช้ colgroup เพื่อไม่ให้เนื้อหายาวแย่งพื้นที่คอลัมน์อื่น */
  columnWidths?: string[];
  /** คอลัมน์ (index) ที่ต้องอยู่บรรทัดเดียว เช่น วันที่ เลขอ้างอิง และจำนวนเงิน */
  nowrapCols?: number[];
  /** คอลัมน์ (index) ที่ชิดขวา + ตัวเลข */
  numericCols?: number[];
  rows: string[][];
  /** Index of subtotal/header rows that start a distinct financial group. */
  groupStartRows?: number[];
  /** Financial summary: separate groups with whitespace instead of row rules. */
  borderlessGroups?: boolean;
  /** แถวรวมท้ายตาราง (ตัวหนา เส้นคู่) */
  totalsRow?: string[];
  /** กล่องสรุปย่อยเหนือ/ใต้ตาราง */
  summaryBlocks?: [string, string][];
  brandName: string;
  /** @deprecated — เอกสารไม่ใส่โลโก้อีกต่อไป ฟิลด์นี้เหลือไว้รองรับผู้เรียกเดิม แต่ไม่ถูกวาด */
  brandLogo?: string;
  footnote?: string;
  /** ตารางกว้าง 7-10 คอลัมน์: ลดขนาดตัวอักษร */
  compact?: boolean;
};

const THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function thaiStamp(date: Date) {
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543} · ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} น.`;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function safeColumnWidth(value: string | undefined) {
  const width = value?.trim();
  return width && /^\d+(?:\.\d+)?(?:%|px|mm|cm|in|pt)$/.test(width) ? width : "";
}

/** SINGLE SOURCE OF TRUTH สำหรับสไตล์เอกสารรายงาน (.rd-* classes) */
export const REPORT_DOC_CSS = `
  .rd-summary-footer { margin-top: 12px; border-top: 2px solid #111; padding-top: 8px; break-inside: avoid; }
  .rd-summary-footer > div { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; }
  .rd-summary-footer b { font-variant-numeric: tabular-nums; text-align: right; }
  .report-doc { background: #ffffff; color: #1c1c1a; font-family: "Sarabun", "TH Sarabun New", "Leelawadee UI", Tahoma, sans-serif; font-size: 13px; line-height: 1.5; box-sizing: border-box; }
  .report-doc.compact { font-size: 12px; }
  .rd-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 12px; border-bottom: 2.5px solid #1c1c1a; }
  .rd-brand { display: flex; align-items: center; gap: 11px; }
  .rd-brand img, .rd-mark { display: none; }
  .rd-brand b { display: block; font-size: 17px; font-weight: 800; color: #111111; line-height: 1.25; }
  .rd-brand small { display: block; color: #666666; font-size: 10px; margin-top: 2px; font-weight: 500; text-transform: uppercase; letter-spacing: .5px; }
  .rd-stamp { font-size: 10px; color: #666666; text-align: right; font-weight: 500; }
  .rd-title { margin-top: 14px; }
  .rd-title h1 { margin: 0; font-size: 18px; font-weight: 800; color: #111111; letter-spacing: .2px; }
  .rd-title p { margin: 4px 0 8px; color: #555555; font-size: 11px; font-weight: 500; }
  .rd-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 8px 0 10px; padding: 8px 12px; background: #f5f5f3; border: 1px solid #c0c0bc; border-radius: 4px; }
  .rd-meta > div { display: flex; gap: 5px; align-items: baseline; }
  .rd-meta span { color: #666666; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; font-weight: 600; }
  .rd-meta b { color: #1c1c1a; font-weight: 700; margin-left: 5px; text-transform: none; letter-spacing: 0; font-size: 12px; }
  .rd-summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 8px 0 10px; break-inside: avoid; page-break-inside: avoid; }
  .rd-summary-grid > div { min-width: 0; padding: 7px 9px; border: 1px solid #c0c0bc; border-radius: 4px; background: #fafaf8; }
  .rd-summary-grid span, .rd-summary-grid b { display: block; }
  .rd-summary-grid span { color: #666666; font-size: 9px; text-transform: uppercase; letter-spacing: .3px; font-weight: 600; }
  .rd-summary-grid b { margin-top: 3px; color: #111111; font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rd-table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.4; page-break-inside: auto; }
  .rd-table.rd-fixed-layout { table-layout: fixed; }
  .rd-table thead { display: table-header-group; }
  .rd-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .rd-table th { background: #f0f0ee; color: #111111; font-weight: 700; text-align: left; padding: 7px 8px; border-top: 2px solid #111111; border-bottom: 1.5px solid #555555; white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
  .rd-table th.num, .rd-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rd-table th.nowrap, .rd-table td.nowrap { white-space: nowrap; overflow-wrap: normal; word-break: normal; }
  .rd-table td { padding: 6px 8px; font-weight: 500; border-bottom: 1px solid #e0e0dc; vertical-align: middle; }
  .rd-table tbody.rd-row-group + tbody.rd-row-group::before { content: ""; display: table-row; height: 16px; }
  .rd-table tr.rd-group-total td { font-weight: 800; padding-top: 10px; padding-bottom: 10px; border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .rd-table tbody.rd-row-group tr:not(.rd-group-total) td:first-child { padding-left: 20px; }
  .report-doc.rd-borderless-groups .rd-table :is(th, td) { border: 0 !important; }
  .report-doc.rd-borderless-groups .rd-table tbody.rd-row-group + tbody.rd-row-group::before { height: 24px; }
  .rd-table th, .rd-table td { overflow-wrap: anywhere; }
  .rd-table tbody tr:nth-child(even) td { background: #f7f7f5; }
  .rd-table tfoot td { font-weight: 800; background: #f0f0ee; border-top: 2px solid #111111; border-bottom: 2px solid #111111; color: #111111; padding: 8px; font-size: 13px; }
  .rd-note { margin-top: 10px; font-size: 10pt; color: #444444; font-weight: 500; line-height: 1.5; break-inside: avoid; page-break-inside: avoid; }
  .report-doc.compact .rd-title h1 { font-size: 16px; }
  .report-doc.compact .rd-meta span { font-size: 9.5px; }
  .report-doc.compact .rd-meta b { font-size: 11px; }
  .report-doc.compact .rd-table { font-size: 11.5px; }
  .report-doc.compact .rd-table th { font-size: 10px; padding: 5px 6px; }
  .report-doc.compact .rd-table td { padding: 4px 6px; }
  /* Same monochrome paper in preview, vector PDF, raster fallback and print.
     Scope to the document so application theme and controls stay unchanged. */
  .report-doc, .report-doc * {
    color: #000000 !important;
    background: #ffffff !important;
    border-color: #000000 !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }
  .report-doc::before, .report-doc::after,
  .report-doc *::before, .report-doc *::after {
    color: #000000 !important;
    background: none !important;
    box-shadow: none !important;
  }
`;

/** @font-face Sarabun (12 weights, thai+latin unicode-range) สำหรับ iframe/Puppeteer */
export const REPORT_DOC_PRINT_FONT_FACE = `
  @font-face { font-family: "Sarabun"; font-weight: 300; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-300-thai.woff2") format("woff2"); unicode-range: U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC; }
  @font-face { font-family: "Sarabun"; font-weight: 300; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-300-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  @font-face { font-family: "Sarabun"; font-weight: 400; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-400-thai.woff2") format("woff2"); unicode-range: U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC; }
  @font-face { font-family: "Sarabun"; font-weight: 400; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-400-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  @font-face { font-family: "Sarabun"; font-weight: 500; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-500-thai.woff2") format("woff2"); unicode-range: U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC; }
  @font-face { font-family: "Sarabun"; font-weight: 500; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-500-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  @font-face { font-family: "Sarabun"; font-weight: 600; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-600-thai.woff2") format("woff2"); unicode-range: U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC; }
  @font-face { font-family: "Sarabun"; font-weight: 600; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-600-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  @font-face { font-family: "Sarabun"; font-weight: 700; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-700-thai.woff2") format("woff2"); unicode-range: U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC; }
  @font-face { font-family: "Sarabun"; font-weight: 700; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-700-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  @font-face { font-family: "Sarabun"; font-weight: 800; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-800-thai.woff2") format("woff2"); unicode-range: U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC; }
  @font-face { font-family: "Sarabun"; font-weight: 800; font-style: normal; font-display: swap; src: url("/fonts/Sarabun-800-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
`;

export type BuildReportHtmlOptions = {
  /** "print" = ฝัง script auto window.print(); "preview" = จำลองขอบ A4 บน iframe โดยไม่กระทบ PDF/Print จริง */
  mode?: "print" | "pdf" | "preview";
  /** ข้อความแสตมป์เวลา เช่น "สร้างเมื่อ ..." / "พิมพ์เมื่อ ..." */
  stampText: string;
  /** override @font-face block (สำหรับ server-side ที่ฝัง font เป็น base64 data URL
   *  เพราะ Puppeteer setContent ไม่สามารถโหลด /fonts/* จาก about:blank ได้) */
  fontFace?: string;
};

/**
 * สร้าง HTML document string เต็มรูปแบบสำหรับเอกสารรายงาน A4
 * — ใช้โดยทั้ง client printReportDoc (iframe) และ server /api/report/pdf (Puppeteer)
 * Pure JS ไม่มี browser API → import ได้ทั้งสองฝั่ง
 */
export function buildReportDocumentHtml(config: ReportDocConfig, opts: BuildReportHtmlOptions): string {
  const numeric = new Set(config.numericCols ?? []);
  const nowrap = new Set(config.nowrapCols ?? []);
  const metaRows = (config.meta ?? []).map(([label, text]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(text)}</b></div>`).join("");
  const summaryRows = (config.summaryBlocks ?? []).map(([label, text]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(text)}</b></div>`).join("");
  const groupStarts = new Set(config.groupStartRows ?? []);
  let bodyRows = "";
  config.rows.forEach((row, rowIndex) => {
    if (rowIndex === 0 || groupStarts.has(rowIndex)) {
      if (rowIndex > 0) bodyRows += "</tbody>";
      bodyRows += `<tbody${groupStarts.size ? ' class="rd-row-group"' : ""}>`;
    }
    bodyRows += `<tr${groupStarts.has(rowIndex) ? ' class="rd-group-total"' : ""}>${row.map((cell, index) => {
      const classes = [numeric.has(index) ? "num" : "", nowrap.has(index) ? "nowrap" : ""].filter(Boolean).join(" ");
      return `<td${classes ? ` class="${classes}"` : ""}>${escapeHtml(cell)}</td>`;
    }).join("")}</tr>`;
  });
  bodyRows += config.rows.length ? "</tbody>" : "<tbody></tbody>";
  const totalsRow = config.totalsRow
    ? `<tfoot><tr>${config.totalsRow.map((cell, index) => {
        const classes = [numeric.has(index) ? "num" : "", nowrap.has(index) ? "nowrap" : ""].filter(Boolean).join(" ");
        return `<td${classes ? ` class="${classes}"` : ""}>${escapeHtml(cell)}</td>`;
      }).join("")}</tr></tfoot>`
    : "";
  const headCells = config.columns.map((column, index) => {
    const classes = [numeric.has(index) ? "num" : "", nowrap.has(index) ? "nowrap" : ""].filter(Boolean).join(" ");
    return `<th${classes ? ` class="${classes}"` : ""}>${escapeHtml(column)}</th>`;
  }).join("");
  const colgroup = config.columnWidths?.length
    ? `<colgroup>${config.columns.map((_, index) => {
        const width = safeColumnWidth(config.columnWidths?.[index]);
        return `<col${width ? ` style="width:${width}"` : ""} />`;
      }).join("")}</colgroup>`
    : "";
  const autoPrintScript = opts.mode === "print"
    ? `<script>window.addEventListener("load", () => { const go = () => window.setTimeout(() => window.print(), 120); if (document.fonts && document.fonts.ready) { document.fonts.ready.then(go); } else { go(); } });</script>`
    : "";
  // @page margins are only applied by the print engine. Render the same safe area
  // explicitly when this document is embedded in an on-screen preview iframe.
  const previewPageCss = opts.mode === "preview"
    ? `@media screen { body { min-height: 1123px; padding: 14mm; } }`
    : "";
  const fontFace = opts.fontFace ?? REPORT_DOC_PRINT_FONT_FACE;
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8" /><title>${escapeHtml(config.title)}</title>
<style>
  ${fontFace}
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; }
  ${previewPageCss}
  ${REPORT_DOC_CSS}
</style></head>
<body>
  <div class="report-doc${config.compact ? " compact" : ""}${config.borderlessGroups ? " rd-borderless-groups" : ""}">
    <div class="rd-head">
      <div class="rd-brand"><div><b>${escapeHtml(config.brandName)}</b><small>ระบบร้านค้าสวัสดิการ · Welfare Store</small></div></div>
      <div class="rd-stamp">${escapeHtml(opts.stampText)}</div>
    </div>
    <div class="rd-title"><h1>${escapeHtml(config.title)}</h1>${config.periodLabel ? `<p>${escapeHtml(config.periodLabel)}</p>` : ""}</div>
    ${metaRows ? `<div class="rd-meta">${metaRows}</div>` : ""}
    <table class="rd-table${colgroup ? " rd-fixed-layout" : ""}">${colgroup}<thead><tr>${headCells}</tr></thead>${bodyRows}${totalsRow}</table>
    ${summaryRows ? `<div class="rd-summary-footer">${summaryRows}</div>` : ""}
    ${config.footnote ? `<div class="rd-note">${escapeHtml(config.footnote)}</div>` : ""}
  </div>
${autoPrintScript}
</body></html>`;
}
