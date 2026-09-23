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
  /** แถวรวมท้ายตาราง (ตัวหนา เส้นคู่) — ROUND 75: ทุกฟอร์มต้องมีสรุปยอดรวมท้ายตาราง */
  totalsRow?: string[];
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

function buildPage(config: ReportDocConfig, rows: string[][], pageIndex: number, pageCount: number) {
  const numeric = new Set(config.numericCols ?? []);
  const page = document.createElement("div");
  // ROUND 77 (user) — ฟอนต์สารบรรณ 13pt เป็นฐาน (เดิม 16pt ใหญ่เกิน) · ฟอร์มตารางกว้างใช้ .compact ลดขนาดตามฟอร์ม
  page.className = `report-doc${config.compact ? " compact" : ""}`;
  const head = document.createElement("div");
  head.className = "rd-head";
  // ROUND 75 (user) — เอกสารไม่ใส่โลโก้/ตราสัญลักษณ์: หัวกระดาษเป็นชื่อร้านตัวหนาล้วน
  // (พิมพ์ขาว-ดำกับพิมพ์สีเหมือนกันทุกประการ)
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
  // ROUND 73 — ตัวอักษรในไฟล์ PDF เล็ก+บางผิดปกติ ต้นเหตุคือหน้ากระดาษ:
  // เดิมสร้างหน้าด้วยหน่วย px ขนาดเท่า canvas (scale 2 → กว้าง 1588px = กระดาษจริง
  // 16.5 นิ้ว!) พอพิมพ์/ดูบน A4 ทั้งหน้าถูกย่อ ~50% ตัวหนังสือ 10.5px เลยเหลือแค่ ~4pt
  // แก้ 3 ชั้น: (1) ยึดความกว้าง A4 จริง 595.28pt ทุกหน้า (794 CSS px = 595pt พอดี A4)
  // (2) เพิ่มขนาด/ความหนาฟอนต์ .rd-* ให้อ่านชัดแบบเอกสารราชการไทย (3) จัดหน้าแบบ
  // วัดจริง — ใส่แถวทีละแถวจนพอดีความสูง A4 (แถวชื่อยาว wrap 2 บรรทัดก็ไม่ล้น)
  // ไม่ใช่ตัดเป็นก้อนแถวเท่ากันทุกหน้าแบบเดิม ที่ทำให้หน้าสูงกว่า A4 แล้วโดนย่อตอนพิมพ์
  // A4 สูง 297mm = 1122.5 CSS px @96dpi — หน้าเปล่าถูก min-height 1123 ดันไว้
  // พอดี (เท้ากระดาษเกาะก้นหน้า) ขีดจำกัดจึงต้องเท่ากับ 1123 ไม่ใช่ต่ำกว่า
  // ไม่งั้นทุกหน้า (แม้หน้าเปล่า) จะถูกวัดว่า "ล้น" แล้วหดเหลือแถวเดียวต่อหน้า
  const PAGE_HEIGHT_LIMIT = 1123;
  const MAX_ROWS_PER_PAGE = 30;
  const stage = document.createElement("div");
  stage.style.position = "fixed";
  stage.style.left = "-10000px";
  stage.style.top = "0";
  stage.style.background = "#ffffff";
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
    // ROUND 75 — รอฟอนต์สารบรรณ (ไฟล์ในเครื่อง) โหลดเสร็จก่อนจับภาพทุกครั้ง
    // กันกรณีเพิ่งเปิดหน้าแล้วสั่ง export ทันที — ฟอนต์ยังไม่ทันพร้อม ตัวไทยจะหลุดเป็น fallback ตัวบาง
    if (document.fonts?.load) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(["300", "400", "500", "600", "700", "800"].map((weight) => document.fonts.load(`${weight} 21px Sarabun`, "ก0A")));
    }
    if (document.fonts?.ready) await document.fonts.ready;
    // ผ่านแรก — แบ่งหน้าตามความสูงจริง (ยังไม่วาดภาพ เร็ว) เพื่อนับจำนวนหน้า
    // สำหรับเขียน "หน้า x / y" ให้ถูกต้องในผ่านที่สอง
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
      const canvas = await html2canvas(page, { scale: 2.5, backgroundColor: "#ffffff" });
      canvases.push(canvas);
      stage.removeChild(page);
    }
    const first = canvases[0];
    // ความกว้าง A4 (595.28pt) เป็นตัวยึดทุกหน้า — หน้าไหนแถวเดี่ยวสูงมากจริง ๆ
    // (ข้อความยาวหลายบรรทัดในแถวเดียว) สูงขึ้นเท่าที่จำเป็น ไม่มีอะไรโดนตัด
    const A4_WIDTH_PT = 595.28;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: [A4_WIDTH_PT, (first.height / first.width) * A4_WIDTH_PT], compress: true });
    canvases.forEach((canvas, index) => {
      const pageHeight = (canvas.height / canvas.width) * A4_WIDTH_PT;
      if (index > 0) pdf.addPage([A4_WIDTH_PT, pageHeight], "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, A4_WIDTH_PT, pageHeight);
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
  /* ROUND 77 (user) — ฟอนต์ไทยสารบรรณจากไฟล์ในเครื่อง (เหมือนหน้าแอป) + ลดขนาดจาก 16pt
     เหลือ 13pt ตามที่ผู้ใช้สรุปว่า 16 ใหญ่เกิน + หัวคอลัมน์พื้นขาวตัวหนาเส้นดำ + ไม่มีโลโก้ —
     ทั้งฉบับเป็นโทนกลาง พิมพ์ขาว-ดำกับพิมพ์สีเหมือนกันทุกประการ */
  /* Thai and Latin are separate subsets; unicode-range keeps both in one family. */
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
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Sarabun", "TH Sarabun New", "Leelawadee UI", Tahoma, sans-serif; color: #1c1c1a; background: #fff; font-size: ${config.compact ? "12px" : "13px"}; }
  .doc { padding: 4px 2px; }
  .rd-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2.5px solid #1c1c1a; padding-bottom: 12px; }
  .rd-brand { display: flex; align-items: center; gap: 10px; }
  .rd-brand img { display: none; }
  .rd-brand b { font-size: 16px; color: #111; }
  .rd-brand small { display: block; color: #555; font-size: 11px; margin-top: 2px; font-weight: 500; }
  .rd-stamp { font-size: 11px; color: #444; text-align: right; font-weight: 500; }
  h1 { font-size: 20px; font-weight: 800; margin: 14px 0 4px; color: #111; }
  .rd-title p { margin: 0 0 8px; color: #444; font-size: 12px; font-weight: 500; }
  .rd-meta { display: flex; flex-wrap: wrap; gap: 5px 16px; margin: 7px 0 9px; padding: 8px 12px; background: #f5f5f4; border: 1px solid #cfcfca; border-radius: 8px; }
  .meta-item { font-size: 10.5px; color: #555; }
  .meta-item b { color: #1c1c1a; font-weight: 700; margin-left: 5px; }
  table { width: 100%; border-collapse: collapse; font-size: ${config.compact ? "11.5px" : "13px"}; line-height: 1.35; page-break-inside: auto; }
  thead { display: table-header-group; }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  th { background: #ffffff; color: #111; font-weight: 700; text-align: left; padding: 5px 7px; border-top: 2px solid #111; border-bottom: 2px solid #111; white-space: nowrap; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td { padding: 5px 7px; font-weight: 500; border-bottom: 1px solid #d8d8d3; }
  th, td { overflow-wrap: anywhere; } /* ป้องกันหัวคอลัมน์ไทยยาวดันตารางกว้างเกินหน้า A4 */
  tbody tr:nth-child(even) { background: #f4f4f2; }
  tfoot td { font-weight: 800; background: #ffffff; border-top: 3.5pt double #111; border-bottom: 2px solid #111; color: #111; }
  .rd-note { margin-top: 10px; font-size: 10pt; color: #444; font-weight: 500; line-height: 1.5; break-inside: avoid; page-break-inside: avoid; }
  .rd-foot { margin-top: 14px; border-top: 1px dashed #bbb; padding-top: 7px; font-size: 9.5pt; color: #666; display: flex; justify-content: space-between; break-inside: avoid; page-break-inside: avoid; }
</style></head>
<body><div class="doc">
  <div class="rd-head">
    <div class="rd-brand"><div><b>${escapeHtml(config.brandName)}</b><small>ระบบร้านค้าสวัสดิการ · Welfare Store</small></div></div>
    <div class="rd-stamp">พิมพ์เมื่อ ${thaiStamp(new Date())}</div>
  </div>
  <div class="rd-title"><h1>${escapeHtml(config.title)}</h1>${config.periodLabel ? `<p>${escapeHtml(config.periodLabel)}</p>` : ""}</div>
  ${metaRows ? `<div class="rd-meta">${metaRows}</div>` : ""}
  <table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody>${totalsRow}</table>
  ${config.footnote ? `<div class="rd-note">${escapeHtml(config.footnote)}</div>` : ""}
  <div class="rd-foot"><span>พิมพ์จากระบบร้านค้าสวัสดิการ</span><span>เอกสารรายงาน A4</span></div>
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
