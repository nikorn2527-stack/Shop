/** Display-only calculations. Receipt writes continue to validate and calculate on the server. */
export function receiptPriceInsight(input: {
  purchaseQty: string;
  freeQty: string;
  paidAmount: string;
  sellingPrice: string;
  currentSellingPrice?: number;
  previousCost?: number | null;
}) {
  const purchased = Number(input.purchaseQty);
  const free = input.freeQty.trim() ? Number(input.freeQty) : 0;
  const paid = Number(input.paidAmount);
  const validQuantity =
    input.purchaseQty.trim() !== "" &&
    Number.isInteger(purchased) &&
    purchased > 0 &&
    Number.isInteger(free) &&
    free >= 0;
  const validPaid =
    input.paidAmount.trim() !== "" && Number.isFinite(paid) && paid >= 0;
  const cost = validQuantity && validPaid ? paid / (purchased + free) : null;
  const candidate = input.sellingPrice.trim()
    ? Number(input.sellingPrice)
    : input.currentSellingPrice;
  const price =
    candidate !== undefined && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : null;
  const previous =
    input.previousCost != null &&
    Number.isFinite(input.previousCost) &&
    input.previousCost >= 0
      ? input.previousCost
      : null;
  const delta = cost !== null && previous !== null ? cost - previous : null;
  return {
    cost,
    price,
    delta,
    changePercent:
      delta !== null && previous !== null && previous > 0
        ? (delta / previous) * 100
        : null,
    grossProfit: cost !== null && price !== null ? price - cost : null,
    grossMargin:
      cost !== null && price !== null && price > 0
        ? ((price - cost) / price) * 100
        : null,
  };
}
