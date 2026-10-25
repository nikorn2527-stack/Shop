import { createHash } from "node:crypto";
import type { WalletReceipt, WalletTxInput } from "../../shared/storeTypes/members";
import { StoreError } from "./storeError";

export type WalletReplay = { receipt: WalletReceipt; requestFingerprint: string | null };

export function walletRequestFingerprint(input: WalletTxInput, amount: number): string {
  const payload = {
    version: 1,
    member: input.memberNumber.trim(),
    type: input.type,
    amount,
    retainCard: input.retainCard === true,
    note: input.note?.trim() || null,
    actor: input.actorUserId == null ? input.actor?.trim() || null : null,
    actorUserId: input.actorUserId ?? null,
    slip: input.slipImage ?? null,
  };
  return `v1:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export function replayWalletReceipt(existing: WalletReplay, fingerprint: string): WalletReceipt {
  if (!existing.requestFingerprint) {
    throw new StoreError("พบรายการเงินเดิมแต่ยืนยันคำขอเก่าไม่ได้ กรุณาตรวจสอบประวัติธุรกรรมก่อนจ่ายหรือรับเงินซ้ำ");
  }
  if (existing.requestFingerprint !== fingerprint) {
    throw new StoreError("รหัสคำขอนี้บันทึกรายการเงินแล้ว แต่ข้อมูลเปลี่ยนไป กรุณาตรวจสอบประวัติธุรกรรมก่อนทำรายการใหม่");
  }
  return existing.receipt;
}
