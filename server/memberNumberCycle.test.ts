import { describe, expect, it } from "vitest";
import { memberNumberHead, nextMemberNumberSequence } from "../shared/memberNumber";

describe("member year numbering follows saved cycle month", () => {
  const format = { prefix: "", yearMode: "buddhist" as const, yearDigits: 2 as const,
    sequenceDigits: 4, separator: "" as const, resetMonth: 10 };
  const number = (members: { memberNumber: string }[], now: Date) =>
    memberNumberHead("year", format, now) + String(nextMemberNumberSequence(members, "year", format, now)).padStart(4, "0");

  it("uses the saved end month without silently starting a month early", () => {
    expect(number([], new Date(2026, 9, 31, 23, 59, 59))).toBe("690001");
    expect(number([], new Date(2026, 10, 1))).toBe("700001");
  });
  it("continues within a cycle and resets only the new cycle", () => {
    const members = [{ memberNumber: "690999" }, { memberNumber: "700001" }, { memberNumber: "700150" }];
    expect(number(members, new Date(2026, 10, 1))).toBe("700151");
    expect(number(members, new Date(2027, 0, 1))).toBe("700151");
    expect(number(members, new Date(2027, 9, 31))).toBe("700151");
    expect(number(members, new Date(2027, 10, 1))).toBe("710001");
  });
  it("honors a changed saved end month for an October start", () => {
    const october = { ...format, resetMonth: 9 };
    expect(memberNumberHead("year", october, new Date(2026, 8, 30))).toBe("69");
    expect(memberNumberHead("year", october, new Date(2026, 9, 1))).toBe("70");
  });
});