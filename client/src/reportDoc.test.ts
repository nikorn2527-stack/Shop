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

  it("supports fixed column proportions and single-line reference fields", () => {
    const html = buildReportDocumentHtml({
      ...config,
      columnWidths: ["70%", "30%"],
      nowrapCols: [1],
    }, { mode: "preview", stampText: "test" });

    expect(html).toContain('class="rd-table rd-fixed-layout"');
    expect(html).toContain('<col style="width:70%" />');
    expect(html).toContain('<th class="num head-nowrap">จำนวน</th>');
    expect(html).toContain('<td class="num nowrap">10</td>');
  });

  it("ignores unsafe column width values", () => {
    const html = buildReportDocumentHtml({
      ...config,
      columnWidths: ['10%";color:red', "30%"],
    }, { mode: "preview", stampText: "test" });

    expect(html).toContain("<col />");
    expect(html).not.toContain("color:red");
  });
});
it('keeps document anchors even without period/metadata and reduces dense table text only',()=>{
 const html=buildReportDocumentHtml({...config,columns:Array.from({length:8},(_,i)=>`ช่อง ${i}`),meta:undefined,periodLabel:undefined},{stampText:'test'});
 expect(html).toContain('rd-meta-slot');
 expect(html).toContain('rd-period');
 expect(html).toContain('rd-dense');
 expect(REPORT_DOC_CSS).toContain('.rd-meta-slot');
 expect(REPORT_DOC_CSS).toContain('font-size: 10.5px');
});
it('preserves card-first detail lines, escapes HTML, and leaves single-line products intact',()=>{
 const html=buildReportDocumentHtml({...config,multilineCols:[0],rows:[['บัตร 0000123\nเติมเงิน · เงินสด\n<script>','10'],['สินค้า A','1']]},{stampText:'test'});
 expect(html).toContain('<span style="white-space:nowrap">บัตร 0000123</span><br><span>เติมเงิน · เงินสด</span>');
 expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
 expect(html).toContain('<td>สินค้า A</td>');
});

it("keeps heading units together without forcing a second line when the column can fit", () => {
 const html=buildReportDocumentHtml({...config,columns:["ชื่อสมาชิก","จำนวนเงิน (บาท)"],numericCols:[1]},{stampText:"test"});
 expect(html).toContain('จำนวนเงิน <span class="rd-heading-unit">(บาท)</span>');
 expect(html).not.toContain('จำนวนเงิน<br>');
 expect(REPORT_DOC_CSS).toMatch(/\.rd-table th \{[^}]*vertical-align: top/);
});

it("breaks a narrow selling-value heading between its meaningful words", () => {
 const html=buildReportDocumentHtml({...config,columns:["สินค้า","มูลค่าราคาขาย"]},{stampText:"test"});
 expect(html).toContain('มูลค่า<wbr><span class="rd-heading-word">ราคาขาย</span>');
});
