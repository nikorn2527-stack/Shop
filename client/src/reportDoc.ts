import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { printViaHelper, getPrinterName, printHtmlDocument } from "@/lib/printHelper";
import {
  buildReportDocumentHtml,
  thaiStamp,
  REPORT_DOC_CSS,
  type ReportDocConfig,
} from "@shared/reportDoc";

/**
 * P0-UX-03 — Report PDF/Pint pipeline.
 *
 * downloadReportPdf: ส่ง config ไป server /api/report/pdf (Puppeteer printToPDF)
 * → ได้ vector PDF จริง (selectable text + คมเมื่อ zoom 200-400% + ไฟล์เล็ก)
 * ถ้า server fail → ย้อนกลับไปใช้ downloadReportPdfRaster (html2canvas PNG-in-PDF)
 *
 * printReportDoc: ใช้ buildReportDocumentHtml จาก @shared/reportDoc (ชุดเดียวกับ
 * server) → Print (vector) = PDF (vector) = template เดียวกัน
 *
 * P0-UX-01 ยังคงอยู่: PDF กับ Print ใช้ REPORT_DOC_CSS ชุดเดียวกัน (single source)
 */
export type { ReportDocConfig };

/** สไตล์เฉพาะ PDF capture stage (raster fallback): ขนาด A4 + padding 14mm */
const REPORT_DOC_PDF_STAGE_CSS = `
  .report-doc { width: 794px; min-height: 1123px; padding: 14mm; background: #ffffff; }
`;

function buildPage(config: ReportDocConfig, rows: string[][], pageIndex: number, pageCount: number) {
  const numeric = new Set(config.numericCols ?? []);
  const nowrap = new Set(config.nowrapCols ?? []);
  const page = document.createElement("div");
  page.className = `report-doc${config.compact ? " compact" : ""}${config.borderlessGroups ? " rd-borderless-groups" : ""}`;
  const head = document.createElement("div");
  head.className = "rd-head";
  head.innerHTML = `
    <div class="rd-brand"><div><b>${escapeHtmlLocal(config.brandName)}</b><small>ระบบร้านค้าสวัสดิการ · Welfare Store</small></div></div>
    <div class="rd-stamp">สร้างเมื่อ ${thaiStamp(new Date())}</div>`;
  page.appendChild(head);
  const title = document.createElement("div");
  title.className = "rd-title";
  title.innerHTML = `<h1>${escapeHtmlLocal(config.title)}</h1>${config.periodLabel ? `<p>${escapeHtmlLocal(config.periodLabel)}</p>` : ""}`;
  page.appendChild(title);
  if (config.meta?.length) {
    const meta = document.createElement("div");
    meta.className = "rd-meta";
    for (const [label, text] of config.meta) {
      const item = document.createElement("div");
      item.innerHTML = `<span>${escapeHtmlLocal(label)}</span><b>${escapeHtmlLocal(text)}</b>`;
      meta.appendChild(item);
    }
    page.appendChild(meta);
  }
  if (config.summaryBlocks?.length && pageIndex === pageCount - 1) {
    const summary = document.createElement("div");
    summary.className = "rd-summary-footer";
    for (const [label, value] of config.summaryBlocks) {
      const block = document.createElement("div");
      block.innerHTML = `<span>${escapeHtmlLocal(label)}</span><b>${escapeHtmlLocal(value)}</b>`;
      summary.appendChild(block);
    }
    // Append after the table, on the last page only.
    page.appendChild(summary);
  }
  const table = document.createElement("table");
  table.className = `rd-table${config.columnWidths?.length ? " rd-fixed-layout" : ""}`;
  if (config.columnWidths?.length) {
    const colgroup = document.createElement("colgroup");
    config.columns.forEach((_, index) => {
      const col = document.createElement("col");
      const width = config.columnWidths?.[index]?.trim();
      if (width && /^\d+(?:\.\d+)?(?:%|px|mm|cm|in|pt)$/.test(width)) col.style.width = width;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
  }
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  config.columns.forEach((column, index) => {
    const th = document.createElement("th");
    th.textContent = column;
    th.className = [numeric.has(index) ? "num" : "", nowrap.has(index) ? "nowrap" : ""].filter(Boolean).join(" ");
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
      td.className = [numeric.has(index) ? "num" : "", nowrap.has(index) ? "nowrap" : ""].filter(Boolean).join(" ");
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
      td.className = [numeric.has(index) ? "num" : "", nowrap.has(index) ? "nowrap" : ""].filter(Boolean).join(" ");
      tr.appendChild(td);
    });
    tfoot.appendChild(tr);
    table.appendChild(tfoot);
  }
  page.appendChild(table);
  const summary = page.querySelector(".rd-summary-footer");
  if (summary) page.appendChild(summary);
  if (config.footnote) {
    const note = document.createElement("div");
    note.className = "rd-note";
    note.textContent = config.footnote;
    page.appendChild(note);
  }
  return page;
}

function escapeHtmlLocal(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/**
 * P0-UX-03 — ดาวน์โหลด PDF รายงานเป็น VECTOR (selectable text) ผ่าน server
 * Puppeteer printToPDF. ถ้า server fail ย้อนกลับไป raster (html2canvas PNG)
 * เพื่อความทน — ผู้ใช้ยังได้ไฟล์แม้ Chromium มีปัญหา
 */
export async function downloadReportPdf(config: ReportDocConfig) {
  const fileName = config.fileName.endsWith(".pdf") ? config.fileName : `${config.fileName}.pdf`;
  // ลอง vector path ก่อน (server Puppeteer)
  try {
    const res = await fetch("/api/report/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("application/pdf")) {
      throw new Error(`server responded ${res.status} ${res.headers.get("content-type")}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  } catch (error) {
    console.warn("[reportDoc] vector PDF (server) ล้มเหลว — ย้อนกลับไป raster:", error instanceof Error ? error.message : error);
  }
  // Fallback: raster PNG-in-PDF (html2canvas) — ยังคมเพราะ PNG lossless + scale 3
  await downloadReportPdfRaster(config);
}

/** Raster fallback: html2canvas → PNG lossless → jsPDF (ไม่ใช่ vector แต่คม) */
async function downloadReportPdfRaster(config: ReportDocConfig) {
  const PAGE_HEIGHT_LIMIT = 1123;
  const MAX_ROWS_PER_PAGE = 30;
  const stage = document.createElement("div");
  stage.style.position = "fixed";
  stage.style.left = "-10000px";
  stage.style.top = "0";
  stage.style.background = "#ffffff";
  const stageStyle = document.createElement("style");
  stageStyle.textContent = `${REPORT_DOC_CSS}${REPORT_DOC_PDF_STAGE_CSS}`;
  stage.appendChild(stageStyle);
  document.body.appendChild(stage);
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
    const fileName = config.fileName.endsWith(".pdf") ? config.fileName : `${config.fileName}.pdf`;
    pdf.save(fileName);
  } finally {
    document.body.removeChild(stage);
  }
}

/**
 * สั่งพิมพ์รายงาน: เปิดเอกสาร (buildReportDocumentHtml จาก @shared — ชุดเดียวกับ
 * server PDF) ผ่าน iframe ที่ซ่อนไว้แล้วเรียก window.print()
 * → vector text ผ่าน browser, layout ตรงกับ PDF (vector) ทุกจุด
 */
export function printReportDoc(config: ReportDocConfig) {
  const stampText = `พิมพ์เมื่อ ${thaiStamp(new Date())}`;
  const html = buildReportDocumentHtml(config, { mode: "print", stampText });
  const printerName = getPrinterName("report");
  if (printerName) {
    // ส่งไปยังเครื่องพิมพ์รายงานที่เลือกไว้ (ตั้งค่า → เครื่องพิมพ์ 3 เครื่องจริง)
    // ถ้า Helper ไม่ตอบ จะเข้า fallback อัตโนมัติ
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${REPORT_DOC_CSS}</style></head><body>${html}</body></html>`;
    printViaHelper(printerName, fullHtml).catch(() => {
      printReportDocFallback(html);
    });
    return;
  }
  void printHtmlDocument(html);
}

function printReportDocFallback(html: string) {
  void printHtmlDocument(html);
}
