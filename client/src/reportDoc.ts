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
  for (const column of config.columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }
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
