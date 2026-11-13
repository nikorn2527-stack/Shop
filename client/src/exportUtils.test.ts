import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildXlsxFileBytes } from "./exportUtils";

describe("Excel export layout", () => {
  it("serializes top alignment and wrapping while preserving identifiers, dates and money", () => {
    const rows = [
      ["บาร์โค้ด", "วันเวลา", "รายการ", "ยอดเงิน"],
      ["000012345678901234", "13/11/69 10:45", "บัตร 00123\nเติมเงิน\nรายละเอียด", "1,234.50"],
      ["00123", "14/11/69 08:00", "สินค้ายาว".repeat(15), "2"],
    ];
    const bytes = buildXlsxFileBytes("รายการ", rows, [3]);
    const zip = XLSX.CFB.read(bytes, { type: "buffer" });
    expect(zip.FullPaths.filter((path: string) => path.endsWith("/xl/styles.xml"))).toHaveLength(1);
    const styles = new TextDecoder().decode(XLSX.CFB.find(zip, "/xl/styles.xml").content);
    const cellFormats = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)![1];
    const formats = cellFormats.match(/<xf\b[^>]*>[\s\S]*?<\/xf>/g)!;
    expect(formats.length).toBeGreaterThanOrEqual(3);
    for (const format of formats) {
      expect(format).toContain('vertical="top"');
      expect(format).toContain('wrapText="1"');
    }
    const book = XLSX.read(bytes, { type: "array", cellNF: true });
    const sheet = book.Sheets["รายการ"];
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      rows[0],
      ["000012345678901234", "13/11/69 10:45", "บัตร 00123\nเติมเงิน\nรายละเอียด", 1234.5],
      ["00123", "14/11/69 08:00", "สินค้ายาว".repeat(15), 2],
    ]);
    expect(sheet.D2.z).toBe("#,##0.00");
    expect(sheet.D3.z).toBe("#,##0");
    // No fixed row height: Excel can autofit wrapped and explicit multiline text.
    const sheetXml = new TextDecoder().decode(XLSX.CFB.find(zip, "/xl/worksheets/sheet1.xml").content);
    expect(sheetXml).not.toMatch(/customHeight=|\bht=/);
    const headingStyle = Number(sheetXml.match(/<c\b[^>]*\br="D1"[^>]*\bs="(\d+)"/)?.[1] ?? 0);
    expect(formats[headingStyle]).toContain('horizontal="right"');
    const textHeadingStyle = Number(sheetXml.match(/<c\b[^>]*\br="A1"[^>]*\bs="(\d+)"/)?.[1] ?? 0);
    expect(formats[textHeadingStyle]).not.toContain('horizontal="right"');
  });

  it("aligns statement table headings after metadata without converting numeric-looking labels", () => {
    const bytes = buildXlsxFileBytes("Statement", [["รายการเดินบัญชี"], ["สมาชิก", "000123"], [], ["เลขบัตร", "รายการ", "2026"], ["00000123", "เติมเงิน", "1,234.50"]], [2], 3);
    const zip = XLSX.CFB.read(bytes, { type: "buffer" });
    const sheetXml = new TextDecoder().decode(XLSX.CFB.find(zip, "/xl/worksheets/sheet1.xml").content);
    const styles = new TextDecoder().decode(XLSX.CFB.find(zip, "/xl/styles.xml").content);
    const formats = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)![1].match(/<xf\b[^>]*>[\s\S]*?<\/xf>/g)!;
    const headingStyle = Number(sheetXml.match(/<c\b[^>]*\br="C4"[^>]*\bs="(\d+)"/)?.[1] ?? 0);
    expect(formats[headingStyle]).toContain('horizontal="right"');
    const sheet = XLSX.read(bytes, { type: "array", cellNF: true }).Sheets.Statement;
    for (const address of ["A1", "A2", "B2", "A4", "B4"]) {
      const style = Number(sheetXml.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*\\bs="(\\d+)"`))?.[1] ?? 0);
      expect(formats[style]).not.toContain('horizontal="right"');
    }
    expect(sheet.C4).toMatchObject({ t: "s", v: "2026" });
    expect(sheet.A5).toMatchObject({ t: "s", v: "00000123" });
    expect(sheet.C5).toMatchObject({ t: "n", v: 1234.5, z: "#,##0.00" });
  });
});
