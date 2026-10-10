import { describe, expect, it } from "vitest";
import { normalizeExpiryDate } from "@shared/expiryDate";
describe("typed expiry dates", () => {
  it("accepts Buddhist, Gregorian and ISO dates", () => {
    expect(normalizeExpiryDate("31/12/2570")).toBe("2027-12-31");
    expect(normalizeExpiryDate("31/12/2027")).toBe("2027-12-31");
    expect(normalizeExpiryDate("2028-02-29")).toBe("2028-02-29");
    expect(normalizeExpiryDate("")).toBe("");
  });
  it("rejects impossible dates and incomplete years", () => {
    for (const text of ["31/02/2570", "29/02/2027", "01/13/2570", "1/1/70", "abc"]) expect(normalizeExpiryDate(text)).toBeNull();
  });
});