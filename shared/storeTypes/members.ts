/** Database-independent business contracts. No database clients or server runtime imports. */

export type Member = {
  id: number;
  memberNumber: string;
  /** คำนำหน้าชื่อ (นาย/นาง/นางสาว/…) — null = ไม่มี */
  prename?: string | null;
  firstName: string;
  lastName: string;
  idCard: string | null;
  phone: string | null;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
  photoUrl: string | null;
  gender: string | null;
  /** ROUND 65 (user) — รหัสบัตรเงินสดของสมาชิก (เช่น 2395100201) · null = ยังไม่ผูกบัตร */
  cardNumber: string | null;
  accountClosed?: number;
  /** 1 when the current physical-card binding and usage round are both live. */
  cardUsable?: number;
  /** ROUND 65 (user) — รหัสผู้ป่วย (HN) ที่ผูกกับบัตร · null = ไม่มี */
  patientCode: string | null;
};

export type Transaction = {
  id: number;
  memberNumber: string;
  type: "purchase" | "deposit" | "withdrawal" | "activation" | "refund";
  detail: string;
  amount: number;
  paymentMethod: string | null;
  balanceAfter: number | null;
  createdAt: string;
  /** เลขบัตร ณ รอบที่ทำรายการ ไม่เปลี่ยนตามบัตรปัจจุบันของสมาชิก */
  cardNumber: string | null;
  /** ROUND 63 — รายการนี้มีรูปหลักฐานแนบไหม (ตัวรูปดึงแยกที่ member.transactionSlip) */
  hasSlip?: number;
};

export type MemberSummary = {
  id: number;
  memberNumber: string;
  /** คำนำหน้าชื่อ — null = ไม่มี */
  prename?: string | null;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
  lastTransactionAt: string | null;
  photoUrl: string | null;
  gender: string | null;
  /** ROUND 65 — รหัสบัตรเงินสด / รหัสผู้ป่วย (แสดงในรายการและรายงานยอดเงินในบัตร) */
  cardNumber: string | null;
  /** 1 เมื่อบัตรยัง assigned ให้สมาชิกรายนี้และมีรอบใช้งานที่ยังไม่ปิด */
  cardUsable: number;
  patientCode: string | null;
};

/** บัตรกายภาพหมุนเวียน — แยกสต็อกบัตรออกจากตัวตนสมาชิก (member_number ไม่ reuse). */
export type PhysicalCardStatus =
  "blank" | "assigned" | "returned_vacant" | "lost" | "damaged";

export type CardUsageSession = {
  id: number;
  cardNumber: string;
  memberNumber: string;
  memberName: string;
  startedAt: string;
  endedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
  openingBalance: number;
  closingBalance: number | null;
  legacy: number;
  transactionCount: number;
  incoming: number;
  outgoing: number;
};

export type CardSessionTransaction = {
  id: number;
  type: string;
  amount: number;
  balanceAfter: number | null;
  createdAt: string;
  actor: string | null;
  detail: string;
};

export type PhysicalCardRow = {
  cardNumber: string;
  status: PhysicalCardStatus;
  assignedMemberNumber: string | null;
  note: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RegisterMemberInput = {
  prename?: string;
  firstName: string;
  lastName: string;
  citizenId?: string;
  phone?: string;
  type?: string;
  gender?: string;
  photoUrl?: string;
  initialDeposit?: number;
  memberNumber?: string;
  /** ROUND 65 — รหัสบัตรเงินสดที่ออกให้สมาชิก (เช่น 2395100201) */
  cardNumber?: string;
  /** ROUND 65 — รหัสผู้ป่วย (HN) ที่ผูกกับบัตร */
  patientCode?: string;
  actor?: string;
  actorRole?: string;
};

export type WalletTxInput = {
  memberNumber: string;
  /** ROUND 65 — 'refund' = คืนบัตรเงินสด (ผู้ป่วยคืนบัตร ร้านจ่ายเงินคืน) คิดเหมือนถอน */
  type: "deposit" | "withdrawal" | "refund";
  /** Internal account closure: refund money but keep the physical card assigned. */
  retainCard?: boolean;
  amount: number;
  note?: string;
  actor?: string;
  actorRole?: string;
  /** ROUND 63 (user) — รูปหลักฐาน (สลิปโอน/ถอน) data-URL · ไม่แนบ = ไม่ส่ง */
  slipImage?: string | null;
  /**
   * P2-b (idempotency) — client-generated key (UUID) sent once per wallet
   * operation. Retries with the SAME key return the original transaction row
   * instead of double-debiting/crediting the member. Omitted on legacy clients
   * → no idempotency.
   */
  clientRequestId?: string | null;
};

export type UpdateMemberInput = {
  memberNumber: string;
  prename?: string | null;
  firstName?: string;
  lastName?: string;
  idCard?: string | null;
  phone?: string | null;
  type?: string;
  gender?: string | null;
  photoUrl?: string | null;
  /** ROUND 65 — รหัสบัตรเงินสด · "" = ล้าง */
  cardNumber?: string | null;
  /** ROUND 65 — รหัสผู้ป่วย (HN) · "" = ล้าง */
  patientCode?: string | null;
  actor?: string;
  actorRole?: string;
};

export type DeleteMemberInput = {
  memberNumber: string;
  actor?: string;
  actorRole?: string;
};

export type MemberSpendingStats = {
  totalSpent: number;
  billCount: number;
  lastPurchaseAt: string | null;
  topProducts: { name: string; qty: number; total: number }[];
};

/** Result of a deposit, withdrawal or refund, including idempotent replay. */
export type WalletReceipt = {
  memberNumber: string;
  memberName: string;
  type: "deposit" | "withdrawal" | "refund";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  detail: string;
};
