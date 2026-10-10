import { describe, expect, it } from "vitest";
import { serializeTierRows } from "./productPriceTiers";

describe("product price tier editor", () => {
  const valid = { label: "200 กรัม", price: "5", qty: "200" };
  it("ignores only completely empty rows", () => {
    const result = serializeTierRows([valid, { label: " ", price: "", qty: "" }]);
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.json!)).toEqual([{ label: "200 กรัม", price: 5, qty: 200 }]);
    expect(result.minPrice).toBe(5);
  });
  it.each([
    { label: "", price: "5", qty: "" },
    { label: "", price: "", qty: "200" },
    { label: "", price: "0", qty: "" },
    { label: "ขนาด", price: "Infinity", qty: "200" },
    { label: "ขนาด", price: "5", qty: "Infinity" },
    { label: "ขนาด", price: "5", qty: "" },
  ])("rejects incomplete or non-finite rows instead of silently dropping them: %j", row => {
    expect(serializeTierRows([valid, row])).toMatchObject({ error: expect.any(String), json: null });
  });
  it("rejects duplicate names used as POS variant keys", () => {
    expect(serializeTierRows([valid, { ...valid, price: "10" }]).error).toContain("ซ้ำ");
  });
});