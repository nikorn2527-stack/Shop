import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveRangePick, ThaiDateRangePicker } from "./ThaiDateRangePicker";

describe("resolveRangePick", () => {
  it("keeps a forward date range", () => {
    expect(resolveRangePick("2026-10-01", "2026-10-15")).toEqual(["2026-10-01", "2026-10-15"]);
  });

  it("normalizes a range selected backwards", () => {
    expect(resolveRangePick("2026-10-15", "2026-10-01")).toEqual(["2026-10-01", "2026-10-15"]);
  });

  it("renders one accessible field for the whole range", () => {
    const html = renderToStaticMarkup(createElement(ThaiDateRangePicker, {
      from: "2026-10-01",
      to: "2026-10-15",
      onChange: () => undefined,
      ariaLabel: "ช่วงทดสอบ",
    }));
    expect(html).toContain('aria-label="ช่วงทดสอบ"');
    expect(html).toContain("1 ต.ค. 2569 – 15 ต.ค. 2569");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(1);
  });
});