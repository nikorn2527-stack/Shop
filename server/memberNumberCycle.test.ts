import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteStore, generateMemberNumber, setSettings } from "./sqliteStore";
import { memberNumberHead, nextMemberNumberSequence } from "../shared/memberNumber";

afterEach(() => vi.useRealTimers());
describe("member numbering ending-year cycle", () => {
  const format = { prefix: "23951", yearMode: "buddhist" as const, yearDigits: 2 as const, resetMonth: 9, sequenceDigits: 4, separator: "" as const };
  it("changes Buddhist year on October 1 and keeps it through next September", () => {
    expect(memberNumberHead("year", format, new Date(2026, 8, 30))).toBe("2395169");
    expect(memberNumberHead("year", format, new Date(2026, 9, 1))).toBe("2395170");
    expect(memberNumberHead("year", format, new Date(2027, 0, 1))).toBe("2395170");
    expect(memberNumberHead("year", format, new Date(2027, 9, 1))).toBe("2395171");
  });
  it("supports calendar year and Gregorian year", () => {
    expect(memberNumberHead("year", { ...format, resetMonth: 12 }, new Date(2026, 11, 31))).toBe("2395169");
    expect(memberNumberHead("year", { ...format, resetMonth: 12 }, new Date(2027, 0, 1))).toBe("2395170");
    expect(memberNumberHead("year", { ...format, yearMode: "gregorian" }, new Date(2026, 9, 1))).toBe("2395127");
  });
  it("resets yearly sequences but continues running sequences across years", () => {
    const members = [{ memberNumber: "23951690042" }, { memberNumber: "23951700003" }];
    const now = new Date(2026, 9, 1);
    expect(nextMemberNumberSequence(members, "year", format, now)).toBe(4);
    expect(nextMemberNumberSequence(members, "running", format, now)).toBe(43);
  });
  it("generates actual database numbers with the same format and preserves manual numbers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 12));
    const db = createSqliteStore();
    try {
      setSettings(db, { memberNumberPrefix: "23951", memberNumberYearMode: "buddhist", memberNumberYearDigits: 2, memberNumberResetMonth: 9, memberNumberSequenceDigits: 4, memberNumberSeparator: "" });
      expect(generateMemberNumber(db, "year")).toBe("23951700001");
      expect(generateMemberNumber(db, "manual", "EXISTING-001")).toBe("EXISTING-001");
    } finally { db.close(); }
  });
});