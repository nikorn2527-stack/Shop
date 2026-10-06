import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { buildReportDocumentHtml, type ReportDocConfig } from "../shared/reportDoc";

const config: ReportDocConfig = {
  fileName: "monochrome-check",
  title: "รายงานตรวจพื้นขาวดำ",
  brandName: "ร้านสวัสดิการ",
  meta: [["ช่วงเวลา", "วันนี้"]],
  summaryBlocks: [["ยอดรวม", "30"]],
  columns: ["สินค้า", "จำนวน"],
  rows: [["สินค้า A", "10"], ["สินค้า B", "20"]],
  totalsRow: ["รวม", "30"],
};
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  for (const mode of ["preview", "pdf", "print"] as const) {
    await page.setContent(buildReportDocumentHtml(config, { mode, stampText: "ตรวจเอกสาร", fontFace: "" }));
    await page.emulateMediaType(mode === "preview" ? "screen" : "print");
    const styles = await page.evaluate(() => [...document.querySelectorAll(".report-doc, .report-doc *")].map(node => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor, image: style.backgroundImage };
    }));
    assert.ok(styles.length > 20);
    assert.ok(styles.every(style => style.color === "rgb(0, 0, 0)" && style.background === "rgb(255, 255, 255)" && style.image === "none"), `${mode} must be black text on white paper`);
    console.log(`${mode}: monochrome styles verified`);
  }
  const output = path.join(os.tmpdir(), "shop-monochrome-check.pdf");
  await page.pdf({ path: output, format: "A4", printBackground: true });
  console.log(`PDF generated: ${output}`);
} finally {
  await browser.close();
}