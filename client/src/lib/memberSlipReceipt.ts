import type { MemberSlipDocument } from "@shared/storeTypes/documents";
import type { CheckoutReceipt } from "@shared/storeTypes/sales";

export function memberSlipLabels(document: MemberSlipDocument) {
  const receiving =
    document.kind === "deposit" || document.kind === "registration";
  const titles = {
    deposit: "ใบยืนยันการเติมเงิน",
    withdrawal: "ใบยืนยันการถอนเงิน",
    refund: "ใบยืนยันการคืนบัตรและคืนเงิน",
    registration: "ใบยืนยันลงทะเบียนสมาชิก",
  };
  const actions = {
    deposit: "เติมเงินสำเร็จ",
    withdrawal: "ถอนเงินสำเร็จ",
    refund: "คืนบัตรสำเร็จ",
    registration: "ลงทะเบียนสมาชิกสำเร็จ",
  };
  const amounts = {
    deposit: "จำนวนเงินที่เติม",
    withdrawal: "จำนวนเงินที่ถอน",
    refund: "จำนวนเงินที่คืน",
    registration: "เงินฝากเริ่มต้น",
  };
  return {
    title: titles[document.kind],
    success: actions[document.kind],
    amount: amounts[document.kind],
    signatures: receiving
      ? ["ผู้ฝากเงิน / ผู้สมัคร", "ผู้รับเงิน"]
      : ["ผู้รับเงิน / ญาติ", "ผู้จ่ายเงิน"],
  };
}
export function memberSlipReceipt(
  document: MemberSlipDocument
): CheckoutReceipt {
  return {
    orderNumber: document.reference,
    documentRef: document.documentRef,
    createdAt: document.createdAt,
    items: [],
    subtotal: document.amount,
    discount: 0,
    total: document.amount,
    paymentMethod: document.paymentMethod,
    memberNumber: document.memberNumber,
    memberName: document.memberName,
    balanceAfter: document.balanceAfter,
    cashier: document.cashier,
  };
}
