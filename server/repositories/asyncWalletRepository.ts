import type { WalletReplay } from "../domain/walletRequest";
import type { Member } from "../../shared/storeTypes/members";
import type { AuditLog } from "../../shared/storeTypes/reports";
import type { MemberLedgerInput } from "./memberLedgerRepository";

/** The PostgreSQL implementation must lock the member and physical-card state
 * on its current transaction connection before returning a writable snapshot.
 * This contract alone does not implement those locks or a database provider.
 */
export interface AsyncWalletRepository {
  findWalletByRequestId(requestId: string): Promise<WalletReplay | undefined>;
  findMember(memberNumber: string): Promise<Member | undefined>;
  requireUsableMember(memberNumber: string): Promise<Member>;
  setMemberBalance(memberNumber: string, balance: number): Promise<void>;
  insertMemberTransaction(input: MemberLedgerInput): Promise<void>;
  releaseCard(
    cardNumber: string,
    actor: string,
    actorRole: string | undefined,
    note: string,
  ): Promise<void>;
  appendAudit(input: Omit<AuditLog, "id">): Promise<void>;
}
