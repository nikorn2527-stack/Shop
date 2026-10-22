import { describe, expect, it } from "vitest";
import { receiptPriceInsight } from "./receiptPriceInsight";
const base = {
  purchaseQty: "4",
  freeQty: "1",
  paidAmount: "30",
  sellingPrice: "10",
  previousCost: 5,
};
describe("receiving price guidance", () => {
  it("uses free items in current cost and reports gross margin, not markup", () => {
    expect(receiptPriceInsight(base)).toEqual({
      cost: 6,
      price: 10,
      delta: 1,
      changePercent: 20,
      grossProfit: 4,
      grossMargin: 40,
    });
  });
  it("keeps the existing selling price when no new price has been entered", () => {
    expect(
      receiptPriceInsight({
        ...base,
        sellingPrice: "",
        currentSellingPrice: 12,
      }).grossProfit
    ).toBe(6);
  });
  it("distinguishes known zero costs from missing history without dividing by zero", () => {
    expect(receiptPriceInsight({ ...base, previousCost: 0 })).toMatchObject({
      delta: 6,
      changePercent: null,
    });
    expect(receiptPriceInsight({ ...base, previousCost: null })).toMatchObject({
      delta: null,
      changePercent: null,
    });
    expect(receiptPriceInsight({ ...base, paidAmount: "0" })).toMatchObject({
      cost: 0,
      grossProfit: 10,
      grossMargin: 100,
    });
  });
  it.each([
    { purchaseQty: "" },
    { purchaseQty: "0" },
    { purchaseQty: "1.5" },
    { freeQty: "-1" },
    { paidAmount: "" },
    { paidAmount: "NaN" },
    { paidAmount: "-5" },
  ])("does not show profit from invalid or incomplete inputs: %o", invalid => {
    expect(receiptPriceInsight({ ...base, ...invalid })).toMatchObject({
      cost: null,
      grossProfit: null,
      grossMargin: null,
    });
  });
  it("handles a zero selling price and a loss without NaN or Infinity", () => {
    expect(receiptPriceInsight({ ...base, sellingPrice: "0" })).toMatchObject({
      price: 0,
      grossProfit: -6,
      grossMargin: null,
    });
    expect(
      receiptPriceInsight({ ...base, sellingPrice: "5" }).grossMargin
    ).toBe(-20);
  });
});
