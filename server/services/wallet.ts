import type {
  WalletTxInput,
  WalletReceipt,
} from "../../shared/storeTypes/members";
import type { WalletRepository } from "../repositories/walletRepository";
import type {
  PaymentRuntime,
  PaymentUnitOfWork,
} from "../repositories/memberLedgerRepository";
import { StoreError } from "../domain/storeError";
import {
  planWalletOperation,
  validateWalletAmount,
} from "../domain/walletPlan";

export function walletTxInTransaction(
  repository: WalletRepository,
  input: WalletTxInput,
  runtime: PaymentRuntime,
): WalletReceipt {
  // Replay before card validation: a completed refund has already released it.
  if (input.clientRequestId) {
    const existing = repository.findWalletByRequestId(input.clientRequestId);
    if (existing) return existing;
  }
  const amount = validateWalletAmount(input.amount);
  const member =
    input.type === "refund"
      ? repository.findMember(input.memberNumber?.trim() ?? "")
      : repository.requireUsableMember(input.memberNumber);
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  const plan = planWalletOperation(member, input, amount, () =>
    runtime.formatDateTime(),
  );
  repository.setMemberBalance(member.memberNumber, plan.receipt.balanceAfter);
  repository.insertMemberTransaction(plan.ledger);
  if (plan.releaseCard) {
    const card = plan.releaseCard;
    repository.releaseCard(
      card.cardNumber,
      card.actor,
      card.actorRole,
      card.note,
    );
  }
  repository.appendAudit(plan.audit);
  return plan.receipt;
}

export function walletTx(
  unitOfWork: PaymentUnitOfWork<WalletRepository>,
  input: WalletTxInput,
  runtime: PaymentRuntime,
): WalletReceipt {
  return unitOfWork.transaction((repository) =>
    walletTxInTransaction(repository, input, runtime),
  );
}
