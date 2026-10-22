import { describe, expect, it } from "vitest";
import { normalizeBillSearch } from "./billSearch";

describe("bill history search identifiers", () => {
  it("keeps receipt separators so server LIKE queries can find a complete receipt", () => {
    expect(normalizeBillSearch(" RC-261023-001\r\n")).toBe("RC-261023-001");
  });
  it("preserves partial codes, leading zeros and member numbers", () => {
    for (const input of ["RC-261023", "000123", "M-000218", "ชื่อสมาชิก"])
      expect(normalizeBillSearch(input)).toBe(input);
  });
  it("extracts a receipt from JSON without merging its digits", () => {
    expect(
      normalizeBillSearch('{"orderNumber":"RC-261023-001","version":2}')
    ).toBe("RC-261023-001");
  });
  it("uses a known URL query field ahead of generic route names and unrelated parameters", () => {
    expect(
      normalizeBillSearch(
        "https://shop.example/receipt?version=2&bill=RC-261023-001"
      )
    ).toBe("RC-261023-001");
  });
  it("decodes the last URL path component when no known query field exists", () => {
    expect(
      normalizeBillSearch("https://shop.example/bill/RC-261023-001?version=2")
    ).toBe("RC-261023-001");
  });
  it("supports scanner prefixes without stripping identifier punctuation", () => {
    expect(normalizeBillSearch("BILL:RC-261023-001")).toBe("RC-261023-001");
  });
  it("keeps empty and malformed payloads safe to edit", () => {
    expect(normalizeBillSearch("\r\n")).toBe("");
    expect(normalizeBillSearch('{"bill":')).toBe('{"bill":');
    expect(normalizeBillSearch("https://%/")).toBe("https://%/");
    expect(normalizeBillSearch("null")).toBe("null");
  });
});
