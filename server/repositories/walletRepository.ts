import type { Member, WalletReceipt } from "../../shared/storeTypes/members";
import type { MemberLedgerRepository } from "./memberLedgerRepository";

export interface WalletRepository extends MemberLedgerRepository {
  findWalletByRequestId(requestId: string): WalletReceipt | undefined;
  findMember(memberNumber: string): Member | undefined;
  requireUsableMember(memberNumber: string): Member;
  releaseCard(
    cardNumber: string,
    actor: string,
    actorRole: string | undefined,
    note: string,
  ): void;
}
