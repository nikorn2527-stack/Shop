import { describe, expect, it } from "vitest";
import { buildReportDocumentHtml, REPORT_DOC_CSS, type ReportDocConfig } from "@shared/reportDoc";

const config: ReportDocConfig = {
  fileName: "monochrome-report",
  title: "รายงานสินค้าคงคลัง",
  brandName: "ร้านสวัสดิการ",
  columns: ["สินค้า", "จำนวน"],
  numericCols: [1],
  rows: [["สินค้า A", "10"], ["สินค้า B", "20"]],
  totalsRow: ["รวม", "30"],
  summaryBlocks: [["จำนวน", "30"]],
};

describe("monochrome report document", () => {
  it("places the summary after the table without summary cards", () => {
    const html = buildReportDocumentHtml(config, { mode: "preview", stampText: "test" });
    expect(html.indexOf('class="rd-summary-footer"')).toBeGreaterThan(html.indexOf("</table>"));
    expect(html).not.toContain('class="rd-summary-grid"');
  });
  it("protects paper, text and borders from application theme styles", () => {
    expect(REPORT_DOC_CSS).toContain(".report-doc, .report-doc *");
    expect(REPORT_DOC_CSS).toContain("color: #000000 !important;");
    expect(REPORT_DOC_CSS).toContain("background: #ffffff !important;");
    expect(REPORT_DOC_CSS).toContain("border-color: #000000 !important;");
  });

  it.each(["preview", "pdf", "print"] as const)("uses identical paper styles in %s", (mode) => {
    const html = buildReportDocumentHtml(config, { mode, stampText: "สร้างเมื่อ 4 ต.ค. 2569" });
    expect(html).toContain(REPORT_DOC_CSS);
    expect(html).toContain("สินค้า A");
    expect(html).toContain("<tfoot>");
    expect(html).not.toContain("preview-format-btn");
    expect(html).not.toContain("pagination");
  });
});