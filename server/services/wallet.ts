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
import { money, round2 } from "../domain/money";

export function walletTxInTransaction(
  repository: WalletRepository,
  input: WalletTxInput,
  runtime: PaymentRuntime,
): WalletReceipt {
  // P2-b (idempotency) — short-circuit a retried submit BEFORE touching the
  // member's balance. The client is expected to send the SAME clientRequestId
  // for every retry of one logical wallet operation. We replay the original
  // ledger row so the UI shows the same slip/result again.
  if (input.clientRequestId) {
    const existing = repository.findWalletByRequestId(input.clientRequestId);
    if (existing) return existing;
  }
  if (!(input.amount > 0)) throw new StoreError("จำนวนเงินต้องมากกว่า 0");
  const amount = round2(input.amount);
  // Refund is a recovery operation: it must remain available for lost/damaged cards.
  const member =
    input.type === "refund"
      ? repository.findMember(input.memberNumber?.trim() ?? "")
      : repository.requireUsableMember(input.memberNumber);
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  if (input.type === "refund" && member.status !== "active")
    throw new StoreError(`สมาชิกถูกระงับการใช้งาน · ${member.memberNumber}`);
  // FIX-4 issue 3 — SQLite stores REAL as IEEE-754 double, so a stored 99.99
  // may come back as 99.98999999999. Comparing raw balance < amount would
  // reject a refund that exactly matches the displayed balance. Round both
  // sides to 2 decimals before the check (refund = return-all-money case).
  const roundedBalance = round2(member.balance);
  if (input.type !== "deposit" && roundedBalance < amount) {
    throw new StoreError(
      `ยอดเงินคงเหลือไม่พอ · ${input.type === "refund" ? "คืนบัตร" : "ถอน"} ${money(amount)} คงเหลือ ${money(roundedBalance)}`,
    );
  }
  const signedAmount = input.type === "deposit" ? amount : -amount;
  const balanceAfter = round2(member.balance + signedAmount);
  const note = input.note?.trim();
  const fallbackDetail =
    input.type === "deposit"
      ? "เติมเงินเข้าบัญชีสมาชิก · เงินสด"
      : input.type === "refund"
        ? "คืนบัตรเงินสด · จ่ายเงินคืนตามยอดคงเหลือ"
        : "ถอนเงินจากบัญชีสมาชิก · เงินสด";
  const detail = note || fallbackDetail;
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  const createdAt = runtime.formatDateTime();
  // ROUND 63 — รูปหลักฐานที่แนบมากับการเติม/ถอน (เช่น สลิปโอนเข้า) เก็บไปกับรายการ
  const slipImage =
    typeof input.slipImage === "string" &&
    input.slipImage.startsWith("data:image/")
      ? input.slipImage.slice(0, 600_000)
      : null;
  repository.setMemberBalance(member.memberNumber, balanceAfter);
  repository.insertMemberTransaction({
    memberNumber: member.memberNumber,
    type: input.type,
    detail,
    amount: signedAmount,
    paymentMethod: "เงินสด",
    balanceAfter,
    actor,
    createdAt,
    slipImage,
    clientRequestId: input.clientRequestId ?? null,
  });
  // Record the refund in the holding round before closing and releasing the card.
  if (
    input.type === "refund" &&
    balanceAfter === 0 &&
    member.cardNumber &&
    !input.retainCard
  ) {
    repository.releaseCard(
      member.cardNumber,
      actor,
      input.actorRole,
      "คืนเงินครบยอดและรับคืนบัตร",
    );
  }
  repository.appendAudit({
    action:
      input.type === "deposit"
        ? "เติมเงินสมาชิก"
        : input.type === "refund"
          ? "คืนบัตรเงินสด"
          : "ถอนเงินสมาชิก",
    actor,
    detail: `${member.memberNumber} · ${money(amount)} · ${note || "เงินสด"}${slipImage ? " · แนบหลักฐานแล้ว" : ""}`,
    tone:
      input.type === "deposit"
        ? "green"
        : input.type === "refund"
          ? "amber"
          : "purple",
    actorRole: input.actorRole ?? null,
    createdAt,
  });
  return {
    memberNumber: member.memberNumber,
    memberName: [member.prename, member.firstName, member.lastName]
      .filter(Boolean)
      .join(" "),
    type: input.type,
    amount,
    balanceBefore: member.balance,
    balanceAfter,
    detail,
  };
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
