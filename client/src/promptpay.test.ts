import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "./promptpay";

describe("PromptPay payment payload", () => {
  it("contains the shop phone target and exact bill amount", () => {
    const payload = buildPromptPayPayload({ promptpayId: "081-234-5678", amount: 123.45 });
    expect(payload).toContain("01130066812345678");
    expect(payload).toContain("5406123.45");
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it("rejects unsupported target lengths instead of creating an unusable QR", () => {
    for (const promptpayId of ["12345678901", "123456789012", "12345678901234"]) {
      expect(() => buildPromptPayPayload({ promptpayId, amount: 10 })).toThrow();
    }
  });

  it("rejects invalid bill amounts instead of silently creating a no-amount QR", () => {
    for (const amount of [NaN, Infinity, -10, 0, 0.001]) {
      expect(() => buildPromptPayPayload({ promptpayId: "0812345678", amount })).toThrow();
    }
  });

  it("allows an explicitly omitted amount for a reusable shop QR", () => {
    expect(buildPromptPayPayload({ promptpayId: "0812345678" })).toContain("010211");
  });
});