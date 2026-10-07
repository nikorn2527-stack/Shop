import { describe, expect, it } from "vitest";
import { allocateInventoryCost } from "./inventoryValuation";

describe("inventory cost allocation in satang", () => {
  it("reconciles 100 baht over 20 purchased and 2 free units", () => {
    let value = 10000n;
    let quantity = 22;
    let issued = 0n;
    for (let i = 0; i < 22; i++) {
      const result = allocateInventoryCost(value, quantity, 1);
      issued += result.issuedValueSatang;
      value = result.remainingValueSatang;
      quantity = result.remainingQuantity;
    }
    expect(issued).toBe(10000n);
    expect(value).toBe(0n);
    expect(quantity).toBe(0);
  });
  it("mixes a later purchase with residual stock value, not rounded unit cost", () => {
    const first = allocateInventoryCost(10000n, 22, 10);
    expect(first.issuedValueSatang).toBe(4545n);
    const second = allocateInventoryCost(first.remainingValueSatang + 6000n, 12 + 10, 22);
    expect(first.issuedValueSatang + second.issuedValueSatang).toBe(16000n);
    expect(second.remainingValueSatang).toBe(0n);
  });
  it("preserves stock value when no units are issued", () => {
    expect(allocateInventoryCost(100n, 3, 0).remainingValueSatang).toBe(100n);
  });
  it("supports zero-value free inventory", () => {
    expect(allocateInventoryCost(0n, 3, 3).issuedValueSatang).toBe(0n);
  });
  it("rejects invalid quantities and negative values", () => {
    for (const args of [[100n, 3, 4], [100n, 3, 0.5], [100n, 0, 0], [-1n, 3, 1]] as const)
      expect(() => allocateInventoryCost(...args)).toThrow();
  });
});