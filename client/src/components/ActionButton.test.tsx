import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionButton } from "./ActionButton";

describe("ActionButton", () => {
  it("keeps a ready action enabled and defaults to a non-submit button", () => {
    const html = renderToStaticMarkup(createElement(ActionButton, { children: "บันทึก" }));
    expect(html).toContain('type="button"');
    expect(html).not.toContain('disabled=""');
  });
  it("blocks repeat actions while busy and exposes the busy state", () => {
    const html = renderToStaticMarkup(createElement(ActionButton, { busy: true, children: "บันทึก", disabledReason: "เลือกสินค้าก่อน" }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("กำลังบันทึก");
    expect(html).not.toContain("เลือกสินค้าก่อน");
  });
  it("links a short reason to an unavailable action", () => {
    const html = renderToStaticMarkup(createElement(ActionButton, { disabled: true, disabledReason: "เลือกสินค้าก่อน", children: "บันทึก" }));
    expect(html).toContain('aria-describedby=');
    expect(html).toContain("เลือกสินค้าก่อน");
  });
});