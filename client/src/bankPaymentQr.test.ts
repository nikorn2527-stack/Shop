import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "./promptpay";
import { paymentQrChecksum, QR_BANKS, validateBankPaymentQr } from "@shared/paymentQr";

function withCrc(body: string) { return `${body}6304${paymentQrChecksum(body + "6304")}`; }

describe("bank receiving QR", () => {
  it("offers the four requested banks", () => {
    expect(QR_BANKS.map(bank => bank.code)).toEqual(["KTB", "KBANK", "SCB", "GSB"]);
  });
  it("uses the standard CRC-16/CCITT-FALSE check vector", () => {
    expect(paymentQrChecksum("123456789")).toBe("29B1");
  });
  it("preserves an original reusable receiving payload exactly", () => {
    const payload = buildPromptPayPayload({ promptpayId: "0812345678" });
    expect(validateBankPaymentQr(payload)).toBe(payload);
  });
  it("rejects corruption, URLs, slip QR and fixed-amount payments", () => {
    const reusable = buildPromptPayPayload({ promptpayId: "0812345678" });
    const invalid = [reusable.replace("0066812345678", "0066899999999"), "https://example.com", "00550006000001", buildPromptPayPayload({ promptpayId: "0812345678", amount: 100 })];
    for (const payload of invalid) expect(() => validateBankPaymentQr(payload)).toThrow();
  });
  it("rejects checksum-valid content with a nonpayment application or a duplicate tag", () => {
    const payload = buildPromptPayPayload({ promptpayId: "0812345678" });
    const body = payload.slice(0, -8);
    expect(() => validateBankPaymentQr(withCrc(body.replace("A000000677010111", "A000000000000000")))).toThrow();
    expect(() => validateBankPaymentQr(withCrc(body + "5303764"))).toThrow();
  });
});
