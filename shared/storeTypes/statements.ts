export type MemberStatementInput = {
  memberNumber: string;
  from?: string;
  to?: string;
};
export type StatementPurchase = {
  id: number;
  orderNumber: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  total: number;
  voided: boolean;
  items: {
    name: string;
    unit: string;
    qty: number;
    price: number;
    amount: number;
  }[];
};
export type StatementEntry = {
  id: number;
  kind: "wallet" | "purchase";
  type: string;
  createdAt: string;
  reference: string;
  detail: string;
  cardNumber: string | null;
  paymentMethod: string | null;
  /** Signed card-ledger movement. Cash/QR bill information has no card movement. */
  amount: number;
  balanceAfter: number | null;
  purchase: StatementPurchase | null;
};
export type MemberStatement = {
  member: {
    memberNumber: string;
    prename: string | null;
    firstName: string;
    lastName: string;
    cardNumber: string | null;
  };
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  incoming: number;
  outgoing: number;
  ledgerCount: number;
  purchaseCount: number;
  /** Non-voided bills only, including member-linked cash/QR purchases. */
  purchaseTotal: number;
  entries: StatementEntry[];
};
