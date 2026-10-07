/** Moving-average allocation in integer satang; independent of display rounding. */
export function allocateInventoryCost(
  remainingValueSatang: bigint,
  remainingQuantity: number,
  issuedQuantity: number,
): { issuedValueSatang: bigint; remainingValueSatang: bigint; remainingQuantity: number } {
  if (remainingValueSatang < BigInt(0)) throw new Error("Inventory value cannot be negative");
  if (!Number.isSafeInteger(remainingQuantity) || remainingQuantity <= 0)
    throw new Error("Remaining quantity must be a positive safe integer");
  if (!Number.isSafeInteger(issuedQuantity) || issuedQuantity < 0 || issuedQuantity > remainingQuantity)
    throw new Error("Issued quantity must be within available inventory");
  const denominator = BigInt(remainingQuantity);
  const numerator = remainingValueSatang * BigInt(issuedQuantity);
  // Round half up without binary floating-point; final issue consumes all residual value.
  const issuedValueSatang = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
  return {
    issuedValueSatang,
    remainingValueSatang: remainingValueSatang - issuedValueSatang,
    remainingQuantity: remainingQuantity - issuedQuantity,
  };
}