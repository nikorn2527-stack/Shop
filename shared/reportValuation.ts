/** General inventory documents value goods at selling prices, never catalog/receipt cost.
 * Pass current catalog prices for stock/order/receiving reports, and sale snapshots
 * for sales documents. Actual cost and its fallback belong to CostProfit reports.
 */
export function reportSellingPrice(price: number | null | undefined): number {
  return typeof price === "number" && Number.isFinite(price) && price >= 0
    ? price
    : 0;
}
export function reportSellingValue(
  qty: number,
  price: number | null | undefined
): number {
  if (!Number.isFinite(qty)) return 0;
  return (
    Math.round((qty * reportSellingPrice(price) + Number.EPSILON) * 100) / 100
  );
}
