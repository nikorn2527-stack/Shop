import * as XLSX from "xlsx";

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
 * (numericCols = ดัชนีคอลัมน์ตัวเลข เช่น [1, 2, 3] — เซลล์อื่นที่ดูเหมือนตัวเลขก็แปลงให้)
 */
export function downloadXlsxFile(fileName: string, sheetName: string, rows: string[][], numericCols: number[] = []): void {
  const numeric = new Set(numericCols);
  const sheet = XLSX.utils.aoa_to_sheet(
    rows.map((row) => row.map((cell, index) => (NUMBER_LIKE.test(cell ?? "") ? Number(cell) : cell))),
  );
  sheet["!cols"] = autoColumnWidths(rows);
  // รูปแบบตัวเลข: ทศนิยม 2 ตำแหน่ง (ตรงกับที่หน้าจอโชว์) — จำนวนเต็มก็แสดงพร้อมจุดทศนิยม
  for (const col of numericCols) {
    for (let row = 1; row < rows.length; row += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (cell && cell.t === "n") cell.z = "#,##0.00";
    }
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}
