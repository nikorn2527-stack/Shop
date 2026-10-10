import { describe, expect, it } from "vitest";
import { parseBangkokDate, bangkokParts, formatBangkokTime } from "../shared/storeTime";
describe("Bangkok store timestamps", () => {
  it("interprets stored wall time as Bangkok without shifting historical values", () => {
    const date = parseBangkokDate("2026-10-08 14:42:33")!;
    expect(date.toISOString()).toBe("2026-10-08T07:42:33.000Z");
    expect(formatBangkokTime(date)).toBe("14:42");
  });
  it("converts UTC instants across midnight and uses 00 instead of 24 or AM/PM", () => {
    const date = parseBangkokDate("2026-10-08T17:00:00Z")!;
    expect(bangkokParts(date)).toMatchObject({ year: 2026, month: 10, day: 9, hour: 0 });
    expect(formatBangkokTime(date)).toBe("00:00");
  });
  it("preserves date-only values and rejects invalid input", () => {
    expect(bangkokParts(parseBangkokDate("2026-10-08")!)).toMatchObject({ day: 8, hour: 0 });
    expect(parseBangkokDate("invalid")).toBeNull();
  });
});