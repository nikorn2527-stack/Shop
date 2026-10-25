import type {
  WalletReceipt,
  WalletTxInput,
} from "../../shared/storeTypes/members";
import type { AsyncWalletRepository } from "../repositories/asyncWalletRepository";
import type { AsyncUnitOfWork } from "../repositories/asyncUnitOfWork";
import type { PaymentRuntime } from "../repositories/memberLedgerRepository";
import { StoreError } from "../domain/storeError";
import {
  planWalletOperation,
  validateWalletAmount,
} from "../domain/walletPlan";

/** For a caller that already owns an async transaction, such as account closure. */
export async function walletTxInAsyncTransaction(
  repository: AsyncWalletRepository,
  input: WalletTxInput,
  runtime: PaymentRuntime,
): Promise<WalletReceipt> {
  if (input.clientRequestId) {
    const existing = await repository.findWalletByRequestId(
      input.clientRequestId,
    );
    if (existing) return existing;
  }
  const amount = validateWalletAmount(input.amount);
  const member =
    input.type === "refund"
      ? await repository.findMember(input.memberNumber?.trim() ?? "")
      : await repository.requireUsableMember(input.memberNumber);
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  const plan = planWalletOperation(member, input, amount, () =>
    runtime.formatDateTime(),
  );
  await repository.setMemberBalance(
    member.memberNumber,
    plan.receipt.balanceAfter,
  );
  await repository.insertMemberTransaction(plan.ledger);
  if (plan.releaseCard) {
    const card = plan.releaseCard;
    await repository.releaseCard(
      card.cardNumber,
      card.actor,
      card.actorRole,
      card.note,
    );
  }
  await repository.appendAudit(plan.audit);
  return plan.receipt;
}

/** Not wired to the live SQLite router. PostgreSQL must be enabled as a complete
 * provider after async repositories, locks, migrations and reconciliation exist.
 */
export async function walletTxAsync(
  unitOfWork: AsyncUnitOfWork<AsyncWalletRepository>,
  input: WalletTxInput,
  runtime: PaymentRuntime,
): Promise<WalletReceipt> {
  return unitOfWork.transaction((repository) =>
    walletTxInAsyncTransaction(repository, input, runtime),
  );
}
