import type { CheckoutReceipt, MemberTransactionRow } from "../../../server/sqliteStore";

export function transactionReceipt(row: MemberTransactionRow): CheckoutReceipt | null {
  if (row.kind !== "tx" || !["deposit", "withdrawal", "refund"].includes(row.type)) return null;
  const label = row.type === "deposit" ? "เติมเงิน" : row.type === "refund" ? "คืนเงินบัตร" : "ถอนเงิน";
  const amount = Math.abs(row.amount);
  return {
    orderNumber: `TX-${row.id}`,
    createdAt: row.createdAt,
    items: [{ productId: null, name: label, unit: "รายการ", qty: 1, price: amount, amount }],
    subtotal: amount,
    discount: 0,
    total: amount,
    paymentMethod: row.paymentMethod ?? "ไม่ระบุ",
    memberNumber: row.memberNumber,
    memberName: row.memberName,
    balanceAfter: row.balanceAfter,
    cashier: row.actor,
  };
}