import { createHash } from "node:crypto";
import type { CheckoutInput } from "../../shared/storeTypes/sales";

/** Versioned, deterministic identity of the submitted payment, before reading mutable catalog data. */
export function checkoutRequestFingerprint(input: CheckoutInput): string {
  const payload = {
    version: 1,
    terminal: input.terminalDeviceId ?? null,
    cashier: input.cashierUserId == null ? input.cashier?.trim() || null : null,
    cashierUserId: input.cashierUserId ?? null,
    member: input.memberNumber?.trim() || null,
    method: input.paymentMethod,
    discount: input.discount ?? 0,
    receivedCash: input.paymentMethod === "เงินสด" ? input.receivedCash ?? null : null,
    paymentVerified: input.paymentMethod === "QR / สแกน" ? input.paymentVerified === true : null,
    slip: input.slipImage ?? null,
    items: input.items.map(item => "productId" in item
      ? { productId: item.productId, qty: item.qty, price: item.price ?? null, label: item.label ?? null }
      : { name: item.name.trim(), qty: item.qty, price: item.price, unit: item.unit?.trim() || "รายการ" }),
  };
  // changeDue and catalog units are deliberately absent: the server derives them.
  return `v1:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}
