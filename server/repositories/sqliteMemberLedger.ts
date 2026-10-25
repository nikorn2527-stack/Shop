import type { SqliteDb } from "../sqliteStore";
import type { MemberLedgerInput } from "./memberLedgerRepository";

/** Uses the caller's current transaction; never begins or commits independently. */
export function setMemberBalance(
  db: SqliteDb,
  memberNumber: string,
  balance: number,
) {
  db.prepare("UPDATE members SET balance = ? WHERE member_number = ?").run(
    balance,
    memberNumber,
  );
}

export function insertMemberTransaction(
  db: SqliteDb,
  input: MemberLedgerInput,
) {
  db.prepare(
    `INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at, slip_url, client_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.memberNumber,
    input.type,
    input.detail,
    input.amount,
    input.paymentMethod,
    input.balanceAfter,
    input.actor,
    input.createdAt,
    input.slipImage,
    input.clientRequestId,
  );
}
