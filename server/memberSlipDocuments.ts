import type { SqliteDb } from "./sqliteStore";
import type { MemberSlipDocument } from "../shared/storeTypes/documents";
import { round2 } from "./domain/money";
import { StoreError } from "./domain/storeError";

type MoneyRow = {
  id: number;
  memberNumber: string;
  memberName: string;
  type: string;
  amount: number;
  balanceAfter: number | null;
  createdAt: string;
  paymentMethod: string | null;
  cashier: string | null;
  receiptSnapshot: string | null;
};
const moneySelect = `SELECT t.id,t.member_number AS memberNumber,TRIM(COALESCE(m.prename || ' ','') || m.first_name || ' ' || m.last_name) AS memberName,t.type,t.amount,t.balance_after AS balanceAfter,t.created_at AS createdAt,t.payment_method AS paymentMethod,t.actor AS cashier,t.receipt_snapshot AS receiptSnapshot FROM member_transactions t JOIN members m ON m.member_number=t.member_number`;
function moneyDocument(
  row: MoneyRow,
  kind?: MemberSlipDocument["kind"]
): MemberSlipDocument {
  if (row.balanceAfter === null)
    throw new StoreError(
      "ไม่พบยอดหลังรายการสำหรับเอกสาร กรุณาตรวจประวัติรายการ"
    );
  let name = row.memberName;
  if (row.receiptSnapshot) {
    try {
      const snapshot = JSON.parse(row.receiptSnapshot);
      if (typeof snapshot.memberName === "string") name = snapshot.memberName;
    } catch {
      /* Legacy names remain readable; amounts always come from the saved ledger. */
    }
  }
  return {
    kind:
      kind ??
      (row.type === "activation"
        ? "registration"
        : (row.type as MemberSlipDocument["kind"])),
    reference: `TX-${row.id}`,
    documentRef: { kind: "wallet", key: String(row.id) },
    createdAt: row.createdAt,
    memberNumber: row.memberNumber,
    memberName: name,
    amount: Math.abs(row.amount),
    balanceBefore: round2(row.balanceAfter - row.amount),
    balanceAfter: row.balanceAfter,
    paymentMethod: row.paymentMethod || "เงินสด",
    cashier: row.cashier || "เจ้าหน้าที่ร้านค้า",
  };
}
/** These readers never create, update or replay a financial operation. */
export function walletRequestSlip(
  db: SqliteDb,
  requestId: string
): MemberSlipDocument {
  const row = db
    .prepare(
      `${moneySelect} WHERE t.client_request_id=? AND t.type IN ('deposit','withdrawal','refund')`
    )
    .get(requestId) as MoneyRow | undefined;
  if (!row) throw new StoreError("ไม่พบรายการเงินที่บันทึกแล้วสำหรับสลิป");
  return moneyDocument(row);
}
export function registrationSlip(
  db: SqliteDb,
  memberNumber: string
): MemberSlipDocument {
  const activation = db
    .prepare(
      `${moneySelect} WHERE t.member_number=? AND t.type='activation' ORDER BY t.id LIMIT 1`
    )
    .get(memberNumber) as MoneyRow | undefined;
  if (activation) return moneyDocument(activation, "registration");
  const row = db
    .prepare(
      `SELECT member_number AS memberNumber,TRIM(COALESCE(prename || ' ','') || first_name || ' ' || last_name) AS memberName,created_at AS createdAt FROM members WHERE member_number=?`
    )
    .get(memberNumber) as
    { memberNumber: string; memberName: string; createdAt: string } | undefined;
  if (!row) throw new StoreError("ไม่พบสมาชิกที่ลงทะเบียนแล้ว");
  const audit = db
    .prepare(
      "SELECT actor FROM audit_logs WHERE action='ลงทะเบียนสมาชิก' AND instr(detail,?)=1 ORDER BY id LIMIT 1"
    )
    .get(memberNumber + " · ") as { actor: string } | undefined;
  return {
    ...row,
    kind: "registration",
    reference: `REG-${memberNumber}`,
    documentRef: { kind: "registration", key: memberNumber },
    amount: 0,
    balanceBefore: 0,
    balanceAfter: 0,
    paymentMethod: "—",
    cashier: audit?.actor || "เจ้าหน้าที่ร้านค้า",
  };
}
export function returnedCardSlip(
  db: SqliteDb,
  sessionId: number,
  requestId: string
): MemberSlipDocument {
  const session = db
    .prepare(
      `SELECT s.member_number AS memberNumber,s.ended_at AS createdAt,s.closed_by AS cashier,TRIM(COALESCE(m.prename || ' ','') || m.first_name || ' ' || m.last_name) AS memberName FROM card_usage_sessions s JOIN members m ON m.member_number=s.member_number WHERE s.id=? AND s.ended_at IS NOT NULL`
    )
    .get(sessionId) as
    | {
        memberNumber: string;
        createdAt: string;
        cashier: string | null;
        memberName: string;
      }
    | undefined;
  if (!session) throw new StoreError("ไม่พบรายการคืนบัตรที่สำเร็จแล้ว");
  const refund = db
    .prepare(
      `${moneySelect} WHERE t.card_usage_session_id=? AND t.type='refund' AND t.balance_after=0 AND t.client_request_id=? ORDER BY t.id DESC LIMIT 1`
    )
    .get(sessionId, requestId) as MoneyRow | undefined;
  if (refund)
    return {
      ...moneyDocument(refund, "refund"),
      documentRef: { kind: "card_return", key: String(sessionId) },
    };
  return {
    ...session,
    kind: "refund",
    reference: `RETURN-${sessionId}`,
    documentRef: { kind: "card_return_zero", key: String(sessionId) },
    amount: 0,
    balanceBefore: 0,
    balanceAfter: 0,
    paymentMethod: "—",
    cashier: session.cashier || "เจ้าหน้าที่ร้านค้า",
  };
}
