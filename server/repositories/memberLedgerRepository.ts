import type { WalletReceipt } from "../../shared/storeTypes/members";
import type { AuditLog } from "../../shared/storeTypes/reports";

export type MemberLedgerInput = {
  memberNumber: string;
  type: "purchase" | "deposit" | "withdrawal" | "refund";
  detail: string;
  amount: number;
  paymentMethod: string;
  balanceAfter: number;
  actor: string;
  createdAt: string;
  slipImage: string | null;
  clientRequestId: string | null;
  requestFingerprint?: string | null;
  receiptSnapshot?: WalletReceipt | null;
};

export interface MemberLedgerRepository {
  setMemberBalance(memberNumber: string, balance: number): void;
  insertMemberTransaction(input: MemberLedgerInput): void;
  appendAudit(input: Omit<AuditLog, "id">): void;
}

/** Synchronous SQLite stage only. Async providers need a connection-scoped async service. */
export interface PaymentUnitOfWork<Repository> {
  transaction<T>(work: (repository: Repository) => T): T;
}

export type PaymentRuntime = {
  now(): Date;
  formatDateTime(date?: Date): string;
};
