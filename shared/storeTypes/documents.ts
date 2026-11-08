/** Stable references to existing business documents. Printing never creates a transaction. */
export type PrintDocumentRef = {
  kind: "sale" | "wallet" | "wallet_request" | "card_return";
  key: string;
};
export type SlipVariant = "original" | "copy";
