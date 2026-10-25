import type { SqliteDb } from "../sqliteStore";
import type { WalletReceipt } from "../../shared/storeTypes/members";
import type { WalletRepository } from "./walletRepository";
import type { PaymentUnitOfWork } from "./memberLedgerRepository";
import { round2 } from "../domain/money";
import {
  setMemberBalance,
  insertMemberTransaction,
} from "./sqliteMemberLedger";

export type SqliteWalletDelegates = Pick<
  WalletRepository,
  "findMember" | "requireUsableMember" | "releaseCard" | "appendAudit"
> & { transaction<T>(work: () => T): T };

export function createSqliteWalletRepository(
  db: SqliteDb,
  delegates: SqliteWalletDelegates,
): PaymentUnitOfWork<WalletRepository> & { repository: WalletRepository } {
  const repository: WalletRepository = {
    findWalletByRequestId: (requestId) => findWalletByRequestId(db, requestId),
    findMember: delegates.findMember,
    requireUsableMember: delegates.requireUsableMember,
    releaseCard: delegates.releaseCard,
    appendAudit: delegates.appendAudit,
    setMemberBalance: (memberNumber, balance) =>
      setMemberBalance(db, memberNumber, balance),
    insertMemberTransaction: (input) => insertMemberTransaction(db, input),
  };
  return {
    repository,
    transaction: (work) => delegates.transaction(() => work(repository)),
  };
}
function findWalletByRequestId(
  db: SqliteDb,
  requestId: string,
): WalletReceipt | undefined {
  const existing = db
    .prepare(
      `SELECT member_number AS memberNumber, type, amount, balance_after AS balanceAfter, detail FROM member_transactions WHERE client_request_id = ? LIMIT 1`,
    )
    .get(requestId) as
    | {
        memberNumber: string;
        type: "deposit" | "withdrawal" | "refund";
        amount: number;
        balanceAfter: number | null;
        detail: string;
      }
    | undefined;
  if (existing) {
    const memberRow = db
      .prepare(
        `SELECT prename, first_name, last_name, balance FROM members WHERE member_number = ?`,
      )
      .get(existing.memberNumber) as
      | {
          prename: string | null;
          first_name: string;
          last_name: string;
          balance: number;
        }
      | undefined;
    // Match the normal-path return shape so the inferred walletTx return
    // type stays the strict `string`/`number` the UI consumers expect —
    // existing.balanceAfter is only null on legacy rows that predate the
    // balance_after column; we fall back to the live balance in that case.
    const memberName = memberRow
      ? [memberRow.prename, memberRow.first_name, memberRow.last_name]
          .filter(Boolean)
          .join(" ")
      : "";
    const balanceAfter = existing.balanceAfter ?? memberRow?.balance ?? 0;
    const balanceBefore =
      existing.type === "deposit"
        ? round2(balanceAfter - Math.abs(existing.amount))
        : round2(balanceAfter + Math.abs(existing.amount));
    return {
      memberNumber: existing.memberNumber,
      memberName,
      type: existing.type,
      amount: Math.abs(existing.amount),
      balanceBefore,
      balanceAfter,
      detail: existing.detail,
    };
  }
}
