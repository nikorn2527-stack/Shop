import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * P0-UX-01 — Unified report document rendering pipeline (Single Document Source).
 *
 * ก่อนหน้านี้ Preview / PDF / Print ใช้ source คนละชุด:
 *  - PDF (downloadReportPdf) สร้าง DOM แล้วจับภาพด้วย html2canvas โดยใช้สไตล์จาก index.css
 *  - Print (printReportDoc) สร้าง HTML string อีกชุด พร้อม <style> ฝังใน iframe
 *  ผลคือ PDF กับ Print มี layout / ขนาดตัวอักษร / padding ต่างกัน และ PDF เป็นภาพ JPEG เบลอ
 *
 * ตอนนี้ทั้งสอง path ใช้ REPORT_DOC_CSS ชุดเดียวกัน (single source of truth):
 *  - downloadReportPdf: ฉีด REPORT_DOC_CSS เข้า stage ก่อนจับภาพ → ภาพตรงกับ Print
 *    ใช้ PNG (lossless) แทน JPEG เพื่อตัด artifacts ของตัวอักษร + scale 3 ให้คมขึ้น
 *  - printReportDoc: ใช้ .report-doc + .rd-table class เดียวกับ PDF + REPORT_DOC_CSS
 *    (browser-native pagination, vector text — คมกว่า PDF เสมอ)
 *
 * ข้อจำกัดที่ยังเหลือ (บันทึกไว้สำหรับรอบถัดไป): PDF ยังเป็น raster (PNG ฝังใน PDF)
 * ตัวอักษรคมขึ้นแล้วแต่ยัง copy/search ใน PDF ไม่ได้ — ต้อง migration ไป server-side
 * Chromium printToPDF เพื่อให้ได้ vector PDF จริง ( selectable text ) ตาม acceptance criteria
 */
export type ReportDocConfig = {
  fileName: string;
  title: string;
  /** เช่น "1 ก.ย. 2569 → 30 ก.ย. 2569 · 30 วัน" */
  periodLabel?: string;
  /** คู่ [ป้าย, ค่า] แสดงเป็นแถวข้อมูลใต้หัวเรื่อง เช่น ["ผู้ทำรายการ", "วรพจน์"] */
  meta?: [string, string][];
  columns: string[];
  /** คอลัมน์ (index) ที่ชิดขวา + ตัวเลข */
  numericCols?: number[];
  rows: string[][];
  /** แถวรวมท้ายตาราง (ตัวหนา เส้นคู่) — ROUND 75: ทุกฟอร์มต้องมีสรุปยอดรวมท้ายตาราง */
  totalsRow?: string[];
  /** กล่องสรุปย่อยเหนือ/ใต้ตาราง เช่น ยอดเติมเงิน/ถอน/ซื้อ แยกอ่านง่าย */
  summaryBlocks?: [string, string][];
  brandName: string;
  /** @deprecated ROUND 75 — เอกสารไม่ใส่โลโก้อีกต่อไป (พิมพ์ขาว-ดำ/สีเหมือนกัน) ฟิลด์นี้เหลือไว้เพื่อรองรับผู้เรียกเดิม แต่จะไม่ถูกวาด */
  brandLogo?: string;
  footnote?: string;
  /** ROUND 75 — ตารางกว้าง 7-10 คอลัมน์: ลดขนาดตัวอักษรตามฟอร์ม (~13pt) ให้อยู่บรรทัดเดียวได้ */
  compact?: boolean;
};

const THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function thaiStamp(date: Date) {
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543} · ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} น.`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/**
 * SINGLE SOURCE OF TRUTH สำหรับสไตล์เอกสารรายงาน (.rd-* classes).
 * ใช้โดยทั้ง downloadReportPdf (ฉีดเข้า capture stage) และ printReportDoc (ฝังใน iframe)
 * ทำให้ PDF กับ Print มีหัวตาราง / ตัวอักษร / สี / padding ตรงกันทุกจุด — แก้ที่นี่ที่เดียว
 * มีผลทั้งสอง output. ค่าตัวอักษรยึดตามมาตรฐานเอกสารสำนักงานไทย (สารบรรณ ~13pt).
 */
const REPORT_DOC_CSS = `
  .report-doc { background: #ffffff; color: #1c1c1a; font-family: "Sarabun", "TH Sarabun New", "Leelawadee UI", Tahoma, sans-serif; font-size: 13px; line-height: 1.5; box-sizing: border-box; }
  .report-doc.compact { font-size: 12px; }
  .rd-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 12px; border-bottom: 2.5px solid #1c1c1a; }
  .rd-brand { display: flex; align-items: center; gap: 11px; }
  .rd-brand img, .rd-mark { display: none; } /* ROUND 75 — เอกสารไม่ใส่โลโก้ (พิมพ์ขาว-ดำ/สีเหมือนกัน) */
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
  .rd-table thead { display: table-header-group; }
  .rd-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .rd-table th { background: #f0f0ee; color: #111111; font-weight: 700; text-align: left; padding: 7px 8px; border-top: 2px solid #111111; border-bottom: 1.5px solid #555555; white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
  .rd-table th.num, .rd-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rd-table td { padding: 6px 8px; font-weight: 500; border-bottom: 1px solid #e0e0dc; vertical-align: middle; }
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
`;

/** สไตล์เฉพาะ PDF capture stage: ขนาด A4 + padding 14mm ให้ตรงกับ @page margin ของ Print */
const REPORT_DOC_PDF_STAGE_CSS = `
  .report-doc { width: 794px; min-height: 1123px; padding: 14mm; background: #ffffff; }
`;

/** @font-face สำหรับ print iframe (iframe เป็น document แยก ต้องโหลดฟอนต์เอง) */
const REPORT_DOC_PRINT_FONT_FACE = `
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

function buildPage(config: ReportDocConfig, rows: string[][], pageIndex: number, pageCount: number) {
  const numeric = new Set(config.numericCols ?? []);
  const page = document.createElement("div");
  page.className = `report-doc${config.compact ? " compact" : ""}`;
  const head = document.createElement("div");
  head.className = "rd-head";
  head.innerHTML = `
    <div class="rd-brand"><div><b>${escapeHtml(config.brandName)}</b><small>ระบบร้านค้าสวัสดิการ · Welfare Store</small></div></div>
    <div class="rd-stamp">สร้างเมื่อ ${thaiStamp(new Date())}</div>`;
  page.appendChild(head);
  const title = document.createElement("div");
  title.className = "rd-title";
  title.innerHTML = `<h1>${escapeHtml(config.title)}</h1>${config.periodLabel ? `<p>${escapeHtml(config.periodLabel)}</p>` : ""}`;
  page.appendChild(title);
  if (config.meta?.length) {
    const meta = document.createElement("div");
    meta.className = "rd-meta";
    for (const [label, text] of config.meta) {
      const item = document.createElement("div");
      item.innerHTML = `<span>${escapeHtml(label)}</span><b>${escapeHtml(text)}</b>`;
      meta.appendChild(item);
    }
    page.appendChild(meta);
  }
  if (config.summaryBlocks?.length) {
    const summary = document.createElement("div");
    summary.className = "rd-summary-grid";
    for (const [label, value] of config.summaryBlocks) {
      const block = document.createElement("div");
      block.innerHTML = `<span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>`;
      summary.appendChild(block);
    }
    page.appendChild(summary);
  }
  const table = document.createElement("table");
  table.className = "rd-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  config.columns.forEach((column, index) => {
    const th = document.createElement("th");
    th.textContent = column;
    if (numeric.has(index)) th.className = "num";
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((cell, index) => {
      const td = document.createElement("td");
      td.textContent = cell;
      if (numeric.has(index)) td.className = "num";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  if (config.totalsRow && pageIndex === pageCount - 1) {
    const tfoot = document.createElement("tfoot");
    const tr = document.createElement("tr");
    config.totalsRow.forEach((cell, index) => {
      const td = document.createElement("td");
      td.textContent = cell;
      if (numeric.has(index)) td.className = "num";
      tr.appendChild(td);
    });
    tfoot.appendChild(tr);
    table.appendChild(tfoot);
  }
  page.appendChild(table);
  if (config.footnote) {
    const note = document.createElement("div");
    note.className = "rd-note";
    note.textContent = config.footnote;
    page.appendChild(note);
  }
  return page;
}

/**
 * สร้างและดาวน์โหลด PDF จากข้อมูลที่เลือก — แบ่งหน้า A4 อัตโนมัติ
 * P0-UX-01: ใช้ REPORT_DOC_CSS ชุดเดียวกับ printReportDoc + PNG (lossless) + scale 3
 * ทำให้ตัวอักษรคมขึ้นและ layout ตรงกับ Print
 */
export async function downloadReportPdf(config: ReportDocConfig) {
  const PAGE_HEIGHT_LIMIT = 1123;
  const MAX_ROWS_PER_PAGE = 30;
  const stage = document.createElement("div");
  stage.style.position = "fixed";
  stage.style.left = "-10000px";
  stage.style.top = "0";
  stage.style.background = "#ffffff";
  // P0-UX-01: ฉีด REPORT_DOC_CSS เข้า stage ให้ DOM ที่จับภาพใช้สไตล์เดียวกับ Print
  // (แทนการพึ่ง index.css ที่มีค่า .rd-* ต่างจาก print template) + ขนาด A4 จริง
  const stageStyle = document.createElement("style");
  stageStyle.textContent = `${REPORT_DOC_CSS}${REPORT_DOC_PDF_STAGE_CSS}`;
  stage.appendChild(stageStyle);
  document.body.appendChild(stage);
  /** วัดหน้าจริงบน DOM: ถ้าเกินความสูง A4 ตัดแถวท้ายออกทีละแถวจนพอดี */
  const fitRows = (rows: string[][]): string[][] => {
    let current = rows;
    for (;;) {
      const probe = buildPage(config, current, 0, 1);
      stage.appendChild(probe);
      const fits = probe.scrollHeight <= PAGE_HEIGHT_LIMIT;
      stage.removeChild(probe);
      if (fits || current.length <= 1) return current;
      current = current.slice(0, current.length - 1);
    }
  };
  try {
    // รอฟอนต์สารบรรณ (โหลดจาก tokens.css ในเครื่อง) พร้อมก่อนจับภาพทุกครั้ง
    if (document.fonts?.load) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(["300", "400", "500", "600", "700", "800"].map((weight) => document.fonts.load(`${weight} 21px Sarabun`, "ก0A")));
    }
    if (document.fonts?.ready) await document.fonts.ready;
    const pages: string[][][] = [];
    let rest = config.rows.slice();
    while (rest.length > 0) {
      const fitted = fitRows(rest.slice(0, MAX_ROWS_PER_PAGE));
      pages.push(fitted);
      rest = rest.slice(fitted.length);
    }
    if (pages.length === 0) pages.push([]);
    const canvases: HTMLCanvasElement[] = [];
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = buildPage(config, pages[pageIndex], pageIndex, pages.length);
      stage.appendChild(page);
      // P0-UX-03: PNG (lossless) แทน JPEG เพื่อตัด artifacts ของตัวอักษร + scale 3 ให้คม
      // (PDF ยังเป็น raster — migration ไป server-side Chromium สำหรับ vector PDF อยู่รอบถัดไป)
      // eslint-disable-next-line no-await-in-loop
      const canvas = await html2canvas(page, { scale: 3, backgroundColor: "#ffffff", useCORS: true, logging: false });
      canvases.push(canvas);
      stage.removeChild(page);
    }
    const first = canvases[0];
    const A4_WIDTH_PT = 595.28;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: [A4_WIDTH_PT, (first.height / first.width) * A4_WIDTH_PT], compress: true });
    canvases.forEach((canvas, index) => {
      const pageHeight = (canvas.height / canvas.width) * A4_WIDTH_PT;
      if (index > 0) pdf.addPage([A4_WIDTH_PT, pageHeight], "portrait");
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, A4_WIDTH_PT, pageHeight);
    });
    pdf.save(config.fileName.endsWith(".pdf") ? config.fileName : `${config.fileName}.pdf`);
  } finally {
    document.body.removeChild(stage);
  }
}

/**
 * สั่งพิมพ์รายงาน: เปิดเอกสารรายงานผ่าน iframe ที่ซ่อนไว้แล้วเรียก window.print()
 * P0-UX-01: ใช้ .report-doc + .rd-table + REPORT_DOC_CSS ชุดเดียวกับ downloadReportPdf
 * → Print กับ PDF มี layout / ตัวอักษร / padding ตรงกัน
 */
export function printReportDoc(config: ReportDocConfig) {
  const numeric = new Set(config.numericCols ?? []);
  const metaRows = (config.meta ?? []).map(([label, text]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(text)}</b></div>`).join("");
  const summaryRows = (config.summaryBlocks ?? []).map(([label, text]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(text)}</b></div>`).join("");
  const bodyRows = config.rows
    .map((row) => `<tr>${row.map((cell, index) => `<td${numeric.has(index) ? ' class="num"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const totalsRow = config.totalsRow
    ? `<tfoot><tr>${config.totalsRow.map((cell, index) => `<td${numeric.has(index) ? ' class="num"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr></tfoot>`
    : "";
  const headCells = config.columns.map((column, index) => `<th${numeric.has(index) ? ' class="num"' : ""}>${escapeHtml(column)}</th>`).join("");
  const html = `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8" /><title>${escapeHtml(config.title)}</title>
<style>
  ${REPORT_DOC_PRINT_FONT_FACE}
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; }
  ${REPORT_DOC_CSS}
</style></head>
<body>
  <div class="report-doc${config.compact ? " compact" : ""}">
    <div class="rd-head">
      <div class="rd-brand"><div><b>${escapeHtml(config.brandName)}</b><small>ระบบร้านค้าสวัสดิการ · Welfare Store</small></div></div>
      <div class="rd-stamp">พิมพ์เมื่อ ${thaiStamp(new Date())}</div>
    </div>
    <div class="rd-title"><h1>${escapeHtml(config.title)}</h1>${config.periodLabel ? `<p>${escapeHtml(config.periodLabel)}</p>` : ""}</div>
    ${metaRows ? `<div class="rd-meta">${metaRows}</div>` : ""}
    ${summaryRows ? `<div class="rd-summary-grid">${summaryRows}</div>` : ""}
    <table class="rd-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody>${totalsRow}</table>
    ${config.footnote ? `<div class="rd-note">${escapeHtml(config.footnote)}</div>` : ""}
  </div>
<script>window.addEventListener("load", () => { const go = () => window.setTimeout(() => window.print(), 120); if (document.fonts && document.fonts.ready) { document.fonts.ready.then(go); } else { go(); } });</script>
</body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.srcdoc = html;
  document.body.appendChild(frame);
  window.setTimeout(() => { frame.remove(); }, 60_000);
}
