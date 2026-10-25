import type {
  Member,
  WalletReceipt,
  WalletTxInput,
} from "../../shared/storeTypes/members";
import { StoreError } from "./storeError";
import { money, round2 } from "./money";

export function validateWalletAmount(value: number): number {
  if (!(value > 0)) throw new StoreError("จำนวนเงินต้องมากกว่า 0");
  return round2(value);
}

/** Shared rules for synchronous SQLite and future asynchronous repositories.
 * No SQL or mutation occurs here. Call only after reading/locking the member
 * in the transaction that will apply this plan.
 */
export function planWalletOperation(
  member: Member,
  input: WalletTxInput,
  amount: number,
  now: () => string,
) {
  if (input.type === "refund" && member.status !== "active")
    throw new StoreError(`สมาชิกถูกระงับการใช้งาน · ${member.memberNumber}`);
  // Legacy REAL balances can be 99.989999...; compare the displayed cents.
  const roundedBalance = round2(member.balance);
  if (input.type !== "deposit" && roundedBalance < amount)
    throw new StoreError(
      `ยอดเงินคงเหลือไม่พอ · ${input.type === "refund" ? "คืนบัตร" : "ถอน"} ${money(amount)} คงเหลือ ${money(roundedBalance)}`,
    );
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
  const createdAt = now();
  const slipImage =
    typeof input.slipImage === "string" &&
    input.slipImage.startsWith("data:image/")
      ? input.slipImage.slice(0, 600_000)
      : null;
  const receipt: WalletReceipt = {
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
  return {
    receipt,
    ledger: {
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
    },
    releaseCard:
      input.type === "refund" &&
      balanceAfter === 0 &&
      member.cardNumber &&
      !input.retainCard
        ? {
            cardNumber: member.cardNumber,
            actor,
            actorRole: input.actorRole,
            note: "คืนเงินครบยอดและรับคืนบัตร",
          }
        : null,
    audit: {
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
    },
  };
}
