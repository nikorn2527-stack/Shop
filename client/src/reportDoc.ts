import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Round 31-10 — เอกสารรายงาน PDF แบบจริง
 * ก่อนหน้านี้ปุ่ม PDF จับภาพ "หน้าแอป" ตามที่เห็นบนจอ (html2canvas บนตารางในแท็บ)
 * ตอนนี้สร้างเอกสารรายงานของตัวเองแทน: กระดาษ A4 พื้นขาว หัวเรื่อง ช่วงเวลา
 * ตารางข้อมูลเฉพาะที่เลือกไว้ แถวรวม และท้ายกระดาษ — ไม่มี UI ของแอปปนเข้ามา
 * (html2canvas + jsPDF ยังจำเป็นเพราะฟอนต์ไทย — วาด DOM ลง canvas ต่อหน้า)
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
  /** แถวรวมท้ายตาราง (ตัวหนา พื้นอ่อน) */
  totalsRow?: string[];
  brandName: string;
  brandLogo?: string;
  footnote?: string;
};

const THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function thaiStamp(date: Date) {
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543} · ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} น.`;
}

function buildPage(config: ReportDocConfig, rows: string[][], pageIndex: number, pageCount: number) {
  const numeric = new Set(config.numericCols ?? []);
  const page = document.createElement("div");
  page.className = "report-doc";
  const head = document.createElement("div");
  head.className = "rd-head";
  head.innerHTML = `
    <div class="rd-brand">${config.brandLogo ? `<img src="${config.brandLogo}" alt="" />` : `<span class="rd-mark">ร</span>`}<div><b>${escapeHtml(config.brandName)}</b><small>ระบบร้านค้าสวัสดิการ · Welfare Store</small></div></div>
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
  const table = document.createElement("table");
  table.className = "rd-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  // ROUND 48 (user) — หัวคอลัมน์ตัวเลขต้องชิดขวาเหมือนข้อมูลใต้มัน ไม่งั้นในไฟล์
  // ที่ส่งออก หัวจะเรียงชิดซ้ายในขณะที่ตัวเลขชิดขวา = ดูเหมือนเยื้องกัน
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
  const foot = document.createElement("div");
  foot.className = "rd-foot";
  foot.textContent = `หน้า ${pageIndex + 1} / ${pageCount} · เอกสารสร้างจากระบบร้านค้าสวัสดิการ${page === null ? "" : ""}`;
  page.appendChild(foot);
  return page;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** สร้างและดาวน์โหลด PDF จากข้อมูลที่เลือก — แบ่งหน้า A4 ให้อัตโนมัติ */
export async function downloadReportPdf(config: ReportDocConfig) {
  const rowsPerPage = 26;
  const chunks: string[][][] = [];
  for (let index = 0; index < config.rows.length; index += rowsPerPage) chunks.push(config.rows.slice(index, index + rowsPerPage));
  if (chunks.length === 0) chunks.push([]);
  const stage = document.createElement("div");
  stage.style.position = "fixed";
  stage.style.left = "-10000px";
  stage.style.top = "0";
  stage.style.background = "#ffffff";
  document.body.appendChild(stage);
  try {
    const canvases: HTMLCanvasElement[] = [];
    for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
      const page = buildPage(config, chunks[pageIndex], pageIndex, chunks.length);
      stage.appendChild(page);
      // eslint-disable-next-line no-await-in-loop
      const canvas = await html2canvas(page, { scale: 2, backgroundColor: "#ffffff" });
      canvases.push(canvas);
      stage.removeChild(page);
    }
    const first = canvases[0];
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [first.width, first.height], compress: true });
    canvases.forEach((canvas, index) => {
      if (index > 0) pdf.addPage([canvas.width, canvas.height], "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, canvas.width, canvas.height);
    });
    pdf.save(config.fileName.endsWith(".pdf") ? config.fileName : `${config.fileName}.pdf`);
  } finally {
    document.body.removeChild(stage);
  }
}

/**
 * Round 32-25 — สั่งพิมพ์รายงานโดยตรง: เปิดเอกสารรายงานแบบเดียวกับ PDF (กระดาษ A4
 * หัวเรื่อง ตาราง แถวรวม) ผ่าน iframe ที่ซ่อนไว้แล้วเรียกคำสั่งพิมพ์ของเบราว์เซอร์ —
 * ไม่ต้องดาวน์โหลดไฟล์มาเปิดเอง ใช้เครื่องพิมพ์เริ่มต้นของระบบได้ทันที
 */
export function printReportDoc(config: ReportDocConfig) {
  const numeric = new Set(config.numericCols ?? []);
  const metaRows = (config.meta ?? []).map(([label, text]) => `<div class="meta-item"><span>${escapeHtml(label)}</span><b>${escapeHtml(text)}</b></div>`).join("");
  const bodyRows = config.rows
    .map((row) => `<tr>${row.map((cell, index) => `<td${numeric.has(index) ? ' class="num"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const totalsRow = config.totalsRow
    ? `<tfoot><tr>${config.totalsRow.map((cell, index) => `<td${numeric.has(index) ? ' class="num"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr></tfoot>`
    : "";
  // ROUND 48 — th คอลัมน์ตัวเลขชิดขวาให้ตรงแนวกับข้อมูล (เหมือนหน้าจอ)
  const headCells = config.columns.map((column, index) => `<th${numeric.has(index) ? ' class="num"' : ""}>${escapeHtml(column)}</th>`).join("");
  const html = `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8" /><title>${escapeHtml(config.title)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Sarabun", "TH Sarabun New", "Leelawadee UI", Tahoma, sans-serif; color: #26251f; background: #fff; }
  .doc { padding: 4px 2px; }
  .rd-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0d7a55; padding-bottom: 8px; }
  .rd-brand { display: flex; align-items: center; gap: 9px; }
  .rd-brand img { width: 38px; height: 38px; object-fit: contain; border-radius: 9px; }
  .rd-mark { width: 38px; height: 38px; border-radius: 9px; background: #0d7a55; color: #fff; display: grid; place-items: center; font-size: 19px; font-weight: 700; }
  .rd-brand b { font-size: 14px; }
  .rd-brand small { display: block; color: #6f7466; font-size: 10px; }
  .rd-stamp { font-size: 10px; color: #6f7466; text-align: right; }
  h1 { font-size: 17px; margin: 12px 0 2px; }
  .rd-title p { margin: 0 0 8px; color: #5c6156; font-size: 11px; }
  .rd-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 6px 0 10px; }
  .meta-item { font-size: 11px; color: #5c6156; }
  .meta-item b { color: #26251f; margin-left: 5px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th { background: #0d7a55; color: #fff; text-align: left; padding: 6px 7px; white-space: nowrap; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td { padding: 5px 7px; border-bottom: 1px solid #e6e9e2; }
  tbody tr:nth-child(even) { background: #f7faf8; }
  tfoot td { font-weight: 700; background: #ecf5ef; border-top: 2px solid #0d7a55; }
  .rd-note { margin-top: 8px; font-size: 10px; color: #6f7466; }
  .rd-foot { margin-top: 14px; border-top: 1px solid #dfe4da; padding-top: 6px; font-size: 9.5px; color: #84897b; display: flex; justify-content: space-between; }
</style></head>
<body><div class="doc">
  <div class="rd-head">
    <div class="rd-brand">${config.brandLogo ? `<img src="${config.brandLogo}" alt="" />` : `<span class="rd-mark">ร</span>`}<div><b>${escapeHtml(config.brandName)}</b><small>ระบบร้านค้าสวัสดิการ · Welfare Store</small></div></div>
    <div class="rd-stamp">พิมพ์เมื่อ ${thaiStamp(new Date())}</div>
  </div>
  <div class="rd-title"><h1>${escapeHtml(config.title)}</h1>${config.periodLabel ? `<p>${escapeHtml(config.periodLabel)}</p>` : ""}</div>
  ${metaRows ? `<div class="rd-meta">${metaRows}</div>` : ""}
  <table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody>${totalsRow}</table>
  ${config.footnote ? `<div class="rd-note">${escapeHtml(config.footnote)}</div>` : ""}
  <div class="rd-foot"><span>พิมพ์จากระบบร้านค้าสวัสดิการ</span><span>เอกสารรายงาน A4</span></div>
</div>
<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 150); });</script>
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
