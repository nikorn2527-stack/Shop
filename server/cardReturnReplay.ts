import { returnedCardSlip } from "./memberSlipDocuments";
import { getMemberDetail, StoreError, type SqliteDb } from "./sqliteStore";

type ReturnIdentity = {
  memberNumber: string;
  cardNumber: string;
  expectedSessionId: number;
  clientRequestId?: string;
};

/** Recover an already committed return; never release a card or move money here. */
export function replayReturnedCard(db: SqliteDb, input: ReturnIdentity) {
  const session = db
    .prepare(
      `SELECT id FROM card_usage_sessions
    WHERE id=? AND member_number=? AND card_number=? AND ended_at IS NOT NULL`
    )
    .get(input.expectedSessionId, input.memberNumber, input.cardNumber) as
    { id: number } | undefined;
  if (!session) return null;
  // The document reader verifies the authoritative closing event and, for a
  // paid return, the original request key. Reuse that single source of truth.
  const slip = returnedCardSlip(
    db,
    session.id,
    input.clientRequestId ?? ""
  );
  if (slip.memberNumber !== input.memberNumber)
    throw new StoreError(
      "ข้อมูลสมาชิกในรายการคืนบัตรไม่ตรงกัน กรุณาตรวจประวัติรายการ"
    );
  const detail = getMemberDetail(db, input.memberNumber);
  if (!detail) return null;
  return { ...detail, slip };
}
