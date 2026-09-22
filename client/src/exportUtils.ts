import * as XLSX from "xlsx";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * ROUND 48 (user) — ชุดเครื่องมือส่งออกไฟล์กลางทาง ใช้ร่วมกันทุกจุด export
 *
 * ปัญหาเดิม: ไฟล์ Excel ที่ส่งออกไปหัวตารางกับข้อมูล "เยื้องกัน" ทั้งที่บนหน้าจอ
 * ปกติ — สาเหตุคือความกว้างคอลัมน์ตายตัว (wch คงที่) พอเจอข้อความไทยยาว ๆ บนเครื่อง
 * ที่ไม่มีฟอนต์ Sarabun ข้อความถูกตัดไปบรรทัดใหม่ แถวสูงไม่เท่ากัน ดูเหมือนเพี้ยน
 *
 * วิธีแก้: คำนวณความกว้าง "จริง" จากเนื้อหาทุกเซลล์ในคอลัมน์นั้น (นับสระบน/ล่าง
 * ภาษาไทยเป็น 0 เพราะไม่กินความกว้าง) แล้วให้คอลัมน์กว้างพอดีเนื้อหา + ใส่รูปแบบ
 * ตัวเลขให้ทศนิยม 2 ตำแหน่งเหมือนที่เห็นบนหน้าจอ หัวกับข้อมูลจึงเรียงตรงแนวกัน
 */

/**
 * ROUND 59 (user) — ตัวเลขในเอกสารส่งออกต้องมีลูกน้ำทุกจุด เหมือนที่เห็นบนหน้าจอ
 * ก่อนหน้านี้ทุกไฟล์ส่งออก (CSV / Excel / PDF / พิมพ์ A4) ใช้ .toFixed(2) เปล่า ๆ
 * เลขยอดใหญ่จึงออกมาเป็น "12345.50" อ่านลำบาก — ปัจจุบันใช้ตัวช่วยคู่นี้ทุกจุด
 */

/** ตัวเลขเงิน/ปริมาณ (ค่าเริ่มต้น 2 ตำแหน่ง): 1234.5 → "1,234.50" */
export function exportNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** จำนวนเต็ม (บิล / ชิ้น / หน่วย / ล็อต): 3391 → "3,391" */
export function exportCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

const NUMBER_LIKE = /^-?[0-9,]+(\.[0-9]+)?$/;

/** ความกว้างแสดงผลโดยประมาณของข้อความ (สระบน/ล่าง/วรรณยุกต์ไทยไม่นับ — ไม่กินความกว้าง) */
export function textWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // U+0E31 ั · U+0E34–0E3A ิีึืุู · U+0E47–0E4E ็่้๊๋์ํ = combining marks
    if (code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e)) continue;
    width += 1;
  }
  return width;
}

/** ความกว้างคอลัมน์ที่พอดีเนื้อหา: กันหัวตารางหักไปบรรทัดใหม่บน Excel ภาษาไทย */
function autoColumnWidths(rows: string[][]): XLSX.ColInfo[] {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths: number[] = new Array(columnCount).fill(0);
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index], textWidth(cell ?? ""));
    });
  }
  return widths.map((width) => ({ wch: Math.min(46, Math.max(9, Math.ceil(width * 1.25) + 3)) }));
}

/** ข้อความ CSV แบบ UTF-8 BOM — เปิดใน Excel ภาษาไทยได้ทันที */
export function buildCsvText(rows: string[][]): string {
  return "\ufeff" + rows.map((row) => row.map((cell) => `"${(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

export function downloadCsvFile(fileName: string, rows: string[][]): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([buildCsvText(rows)], { type: "text/csv;charset=utf-8" }));
  link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Excel ที่คอลัมน์กว้างพอดีเนื้อหา + เซลล์ตัวเลขเป็นตัวเลขจริงพร้อมทศนิยม 2 ตำแหน่ง
 * (numericCols = ดัชนีคอลัมน์ตัวเลข เช่น [1, 2, 3])
 *
 * ROUND 59 — แปลงเป็นตัวเลขจริง "เฉพาะคอลัมน์ที่ระบุใน numericCols" เท่านั้น
 * (เดิมแปลงทุกเซลล์ที่หน้าตาเป็นตัวเลข ทำให้บาร์โค้ด/รหัสยาว ๆ กลายเป็น
 * เลขวิทยาศาสตร์ 8.85E+12 ใน Excel) + รองรับตัวเลขที่มีลูกน้ำแล้วจาก exportNumber
 * จำนวนเต็มใช้รูปแบบ #,##0 (ไม่ต่อทศนิยม .00 ต่อท้ายจำนวนบิล/ชิ้น)
 */
export function downloadXlsxFile(fileName: string, sheetName: string, rows: string[][], numericCols: number[] = []): void {
  const numeric = new Set(numericCols);
  const sheet = XLSX.utils.aoa_to_sheet(
    rows.map((row) => row.map((cell, index) => (numeric.has(index) && NUMBER_LIKE.test(cell ?? "") ? Number(cell.replaceAll(",", "")) : cell))),
  );
  sheet["!cols"] = autoColumnWidths(rows);
  // รูปแบบตัวเลข: ตามที่พรีวิว/CSV/PDF แสดง — ตัวเลขที่มีทศนิยม (เงิน) เป็น #,##0.00
  // ตัวเลขไม่มีทศนิยม (จำนวนบิล/ชิ้น/หน่วย) เป็น #,##0 ไม่ต่อ .00 ให้ดูเวอร์
  for (const col of numericCols) {
    for (let row = 1; row < rows.length; row += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (cell && cell.t === "n") cell.z = /\.\d+$/.test(rows[row]?.[col] ?? "") ? "#,##0.00" : "#,##0";
    }
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

/**
 * ROUND 77 (user) — สลิปเติม/ถอน/คืนบัตร: ดาวน์โหลดรูป หรือ PDF จาก DOM สลิปบนหน้าจอ
 * (จับภาพ element แล้วยึดความกว้างกระดาษต่อเนื่อง 80 มม. เหมือนใบเสร็จ POS — ใช้ร่วมกันทุกจุด)
 */
export async function downloadSlipFile(elementId: string, fileName: string, format: "pdf" | "image"): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) return;
  const canvas = await html2canvas(element, { scale: 2.5, backgroundColor: "#ffffff" });
  const baseName = fileName.replace(/\.(pdf|png)$/i, "");
  if (format === "image") {
    const link = document.createElement("a");
    link.download = `${baseName}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    return;
  }
  // กระดาษต่อเนื่อง 80 มม. — สลิปออกมาพอดีหัวระบาย 58–80 มม. ที่ร้านใช้ (เหมือนใบเสร็จ)
  const WIDTH_MM = 80;
  const pageHeightMm = (canvas.height / canvas.width) * WIDTH_MM;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [WIDTH_MM, pageHeightMm] });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, WIDTH_MM, pageHeightMm);
  pdf.save(`${baseName}.pdf`);
}
