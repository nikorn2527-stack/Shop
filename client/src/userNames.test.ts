import { describe, expect, it } from "vitest";
import { suggestReportName, suggestUsername } from "@shared/userNames";

describe("staff name suggestions", () => {
  it("uses the entered English name without transliterating Thai", () => {
    expect(suggestUsername(" Nikorn   Punnonngiw ", [])).toBe("nikorn.p");
    expect(suggestUsername("นิกร พันโนนงิ้ว", [])).toBe("");
    expect(suggestUsername("นิกร Punnonngiw", [])).toBe("");
    expect(suggestUsername("", [])).toBe("");
    expect(suggestUsername("Nikorn", [])).toBe("nikorn");
    expect(suggestUsername("José O'Neil", [])).toBe("jose.o");
  });
  it("extends surnames before using digits and checks all accounts ignoring case", () => {
    expect(suggestUsername("Nikorn Punnonngiw", ["NIKORN.P"])).toBe("nikorn.pu");
    expect(suggestUsername("Ann Li", ["ann.l", "ann.li"])).toBe("ann.li2");
    expect(suggestUsername("Al Li", ["al.l"])).toBe("al.li");
  });
  it("keeps long names within the existing username format", () => {
    const name = "A".repeat(50) + " " + "B".repeat(50);
    const first = suggestUsername(name, []);
    const next = suggestUsername(name, [first]);
    expect(first).toMatch(/^[a-z0-9_.]{3,30}$/);
    expect(next).toMatch(/^[a-z0-9_.]{3,30}$/);
    expect(next).not.toBe(first);
  });
  it("suggests readable Thai initials and handles titles and missing surnames", () => {
    expect(suggestReportName("นิกร พันโนนงิ้ว")).toBe("นิกร.พ");
    expect(suggestReportName("นาย นิกร พันโนนงิ้ว")).toBe("นิกร.พ");
    expect(suggestReportName("สมศรี แสงจันทร์")).toBe("สมศรี.ส");
    expect(suggestReportName("นิกร")).toBe("นิกร");
    expect(suggestReportName("")).toBe("");
  });
});
