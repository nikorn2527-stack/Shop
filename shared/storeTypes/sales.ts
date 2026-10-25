/** Database-independent business contracts. No database clients or server runtime imports. */

export const PAYMENT_METHODS = [
  "เงินสด",
  "QR / สแกน",
  "หักบัญชีสมาชิก",
] as const;

export type Sale = {
  id: number;
  orderNumber: string;
  paymentMethod: string;
  memberNumber: string | null;
  subtotal: number;
  discount: number;
  total: number;
  cashier: string | null;
  createdAt: string;
};

export type SaleItem = {
  id: number;
  saleId: number;
  productId: number | null;
  name: string;
  qty: number;
  price: number;
  cost: number;
};

export type CheckoutReceipt = {
  terminalId?: string | null;
  terminalNumber?: number | null;
  orderNumber: string;
  createdAt: string;
  items: {
    productId: number | null;
    name: string;
    unit: string;
    qty: number;
    price: number;
    amount: number;
  }[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  memberNumber: string | null;
  memberName: string | null;
  balanceAfter: number | null;
  cashier: string | null;
  /** FIX-7 (user) — ยอดเงินสดที่รับมา (เฉพาะ "เงินสด") ใช้พิมพ์ "รับเงินมา X / ทอน Y" ท้ายใบเสร็จ */
  receivedCash?: number | null;
  /** FIX-7 (user) — ยอดเงินทอน (เฉพาะ "เงินสด") */
  changeDue?: number | null;
  /** FIX-7 (user) — บิล QR ที่แคชเชียร์ยืนยันตรวจสอบแล้ว (เก็บไว้ในตารางเพื่อ audit) */
  paymentVerified?: boolean | null;
  /** FIX-8 (user) — พรีวิวก่อนพิมพ์ใบเสร็จ/บัตร/รายงาน: true = เปิด preview ก่อน (default, ปลอดภัย)
   *  false = กดปุ่มพิมพ์แล้ว window.print() เลย (เร็วกว่า แต่ไม่มีโอกาสตรวจก่อน) */
  printPreviewBefore?: boolean;
};

/** A past receipt rebuilt from the sales/sale_items tables — balanceAfter is replayed from the member ledger when that bill was a wallet purchase. */
export type SaleHistoryEntry = CheckoutReceipt & {
  /** รหัสแถวในตาราง sales — ใช้ดึงหลักฐานแนบ (sales.slip) รอบหลัง */
  id: number;
  /** ROUND 63 — บิลนี้มีรูปหลักฐานการชำระแนบอยู่ไหม (ตัวรูปดึงแยกที่ sales.slip เพื่อไม่ให้ลิสต์หนัก) */
  hasSlip: boolean;
  /** FEAT-9 — บิลนี้ถูกยกเลิกหรือไม่ (true = void, แสดง red strikethrough ใน RecentBillsWidget) */
  voided?: boolean;
};

/** A catalog line references a product; a "รายการพิเศษ" line is a priced ad-hoc item with no product/stock behind it. */
export type CheckoutItemInput =
  | {
      productId: number;
      qty: number;
      price?: number;
      unit?: string;
      label?: string;
    }
  | { name: string; price: number; qty: number; unit?: string };

export type PosTerminal = {
  id: string;
  number: number;
  registeredBy: string;
  createdAt: string;
};

export type CheckoutInput = {
  terminalDeviceId?: string;
  items: CheckoutItemInput[];
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  memberNumber?: string | null;
  discount?: number;
  cashier?: string;
  /** Server-supplied authenticated identity; public checkout ignores client-supplied values. */
  cashierUserId?: number;
  actorRole?: string;
  /** ROUND 63 (user) — รูปหลักฐานการชำระ (สลิปโอน/สแกนจ่าย) data-URL · ไม่แนบ = ไม่ส่ง */
  slipImage?: string | null;
  /**
   * P2-b (idempotency) — client-generated key (UUID) sent once per checkout
   * attempt. Retries with the SAME key return the original receipt instead
   * of writing a second bill. Omitted on legacy clients → no idempotency.
   */
  clientRequestId?: string | null;
  /** FIX-7 (user) — ยอดเงินที่รับมาจากลูกค้า (เฉพาะ "เงินสด") · null/undefined สำหรับ QR/wallet */
  receivedCash?: number | null;
  /** FIX-7 (user) — ยอดเงินทอน (เฉพาะ "เงินสด") · null/undefined สำหรับ QR/wallet */
  changeDue?: number | null;
  /** FIX-7 (user) — แคชเชียร์ยืนยันว่าตรวจสอบการชำระแล้ว (เฉพาะ "QR / สแกน") · null สำหรับเงินสด/wallet */
  paymentVerified?: boolean | null;
};

export type SalesListInput = {
  search?: string;
  limit?: number;
};

export interface CashierShift {
  id: number;
  cashierName: string;
  status: string;
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  cashDifference: number | null;
  expectedQr: number;
  expectedWallet: number;
  billsCount: number;
  pieces: number;
  salesTotal: number;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
}
