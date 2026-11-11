/** Stable references to existing business documents. Printing never creates a transaction. */
export type PrintDocumentRef = {
  kind:
    | "sale"
    | "wallet"
    | "wallet_request"
    | "card_return"
    | "card_return_zero"
    | "registration";
  key: string;
};
export type SlipVariant = "original" | "copy";

/** Saved transaction evidence. Physical card numbers are intentionally excluded. */
export type MemberSlipDocument = {
  kind: "deposit" | "withdrawal" | "refund" | "registration";
  reference: string;
  documentRef: PrintDocumentRef;
  createdAt: string;
  memberNumber: string;
  memberName: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  paymentMethod: string;
  cashier: string;
};
