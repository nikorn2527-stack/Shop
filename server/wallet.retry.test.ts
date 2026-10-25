import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrpcContext } from "./_core/context";
import type { WalletTxInput } from "../shared/storeTypes/members";
import { closeMemberAccount, createBlankCards, createSqliteStore, ensureRbacSeed, getMemberDetail, registerMember, walletTx, type SqliteDb } from "./sqliteStore";
const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({ getWelfareDb: store.get, getWelfareDbPath: () => "unused-test.sqlite", getBackupDir: () => "unused-test-backups", closeWelfareDb: vi.fn() }));
import { appRouter } from "./routers";
let db: SqliteDb;
let dir: string;
let memberNumber: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shop-wallet-retry-")); db = createSqliteStore(join(dir, "fixture.sqlite")); store.get.mockReturnValue(db);
  ensureRbacSeed(db); createBlankCards(db, ["RETRY-CARD"]);
  memberNumber = registerMember(db, { firstName: "Original", lastName: "Member", cardNumber: "RETRY-CARD", initialDeposit: 100 }).member.memberNumber;
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks(); });
function input(): WalletTxInput { return { memberNumber, type: "deposit", amount: 20, actor: "Cashier", clientRequestId: "wallet-attempt" }; }
function state() {
  return Object.fromEntries(["members", "member_transactions", "physical_cards", "card_assignments", "card_usage_sessions", "audit_logs", "sqlite_sequence"].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function api(appRole = "cashier", id = 1, name = "Cashier") {
  return appRouter.createCaller({ user: { id, name, role: appRole === "administrator" ? "admin" : "user", appRole } as TrpcContext["user"], req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });
}
describe("durable member money requests", () => {
  it.each(["deposit", "withdrawal", "refund"] as const)("replays %s after restart and profile/balance changes without another ledger or audit", type => {
    const request = { ...input(), type, amount: type === "refund" ? 100 : 20 };
    const receipt = walletTx(db, request);
    db.prepare("UPDATE members SET first_name='Renamed', balance=7 WHERE member_number=?").run(memberNumber);
    db.close(); db = createSqliteStore(join(dir, "fixture.sqlite")); store.get.mockReturnValue(db);
    const before = state(); expect(walletTx(db, request)).toEqual(receipt); expect(state()).toEqual(before);
  });
  it.each([
    ["amount", (v: WalletTxInput) => ({ ...v, amount: 30 })],
    ["member", (v: WalletTxInput) => ({ ...v, memberNumber: "OTHER" })],
    ["operation", (v: WalletTxInput) => ({ ...v, type: "withdrawal" as const })],
    ["note", (v: WalletTxInput) => ({ ...v, note: "Changed" })],
    ["operator", (v: WalletTxInput) => ({ ...v, actorUserId: 99 })],
    ["retain card", (v: WalletTxInput) => ({ ...v, retainCard: true })],
  ] as const)("rejects a reused key with changed %s before changing money", (_kind, change) => {
    walletTx(db, input()); const before = state();
    expect(() => walletTx(db, change(input()))).toThrow(/ข้อมูลเปลี่ยนไป/); expect(state()).toEqual(before);
  });
  it("does not touch a returned card's new holder when replaying the old refund", () => {
    const request = { ...input(), type: "refund" as const, amount: 100 };
    const receipt = walletTx(db, request);
    const nextMember = registerMember(db, { firstName: "New", lastName: "Holder", cardNumber: "RETRY-CARD", initialDeposit: 50 }).member;
    const before = state(); expect(walletTx(db, request)).toEqual(receipt); expect(state()).toEqual(before);
    expect(getMemberDetail(db, nextMember.memberNumber)!.member).toMatchObject({ balance: 50, cardNumber: "RETRY-CARD" });
  });
  it("rejects legacy keys without sufficient identity instead of guessing from live balance", () => {
    walletTx(db, input()); db.prepare("UPDATE member_transactions SET request_fingerprint=NULL, receipt_snapshot=NULL WHERE client_request_id=?").run(input().clientRequestId!);
    const before = state(); expect(() => walletTx(db, input())).toThrow(/ยืนยันคำขอเก่าไม่ได้/); expect(state()).toEqual(before);
  });
  it("rolls back the balance if persisting the request snapshot fails", () => {
    db.exec("CREATE TRIGGER fail_wallet_snapshot BEFORE INSERT ON member_transactions WHEN NEW.receipt_snapshot IS NOT NULL BEGIN SELECT RAISE(ABORT, 'wallet snapshot failure'); END");
    const before = state(); expect(() => walletTx(db, input())).toThrow(/wallet snapshot failure/); expect(state()).toEqual(before);
    db.exec("DROP TRIGGER fail_wallet_snapshot"); expect(walletTx(db, input()).balanceAfter).toBe(120);
  });
  it("does not close an account when its request key belongs to another money operation", () => {
    walletTx(db, input());
    const session = db.prepare("SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL").get(memberNumber) as { id: number };
    const before = state();
    expect(() => closeMemberAccount(db, { memberNumber, cardNumber: "RETRY-CARD", expectedSessionId: session.id, clientRequestId: input().clientRequestId! })).toThrow(/ข้อมูลเปลี่ยนไป/);
    expect(state()).toEqual(before);
  });
  it("upgrades an older ledger file with nullable metadata columns and preserves balances and rows", () => {
    walletTx(db, input());
    db.exec("ALTER TABLE member_transactions DROP COLUMN request_fingerprint; ALTER TABLE member_transactions DROP COLUMN receipt_snapshot");
    db.close(); db = createSqliteStore(join(dir, "fixture.sqlite")); store.get.mockReturnValue(db);
    expect(getMemberDetail(db, memberNumber)!.member.balance).toBe(120);
    expect(db.prepare("SELECT COUNT(*) AS n FROM member_transactions").get()).toMatchObject({ n: 2 });
    expect(() => walletTx(db, input())).toThrow(/ยืนยันคำขอเก่าไม่ได้/);
  });
  it.each([NaN, Infinity, -Infinity, 0, -1, 0.001, Number.MAX_VALUE])("rejects invalid internal money amount %s without writes", amount => {
    const before = state(); expect(() => walletTx(db, { ...input(), amount })).toThrow(); expect(state()).toEqual(before);
  });
  it.each([undefined, null, "", "   "])("requires a nonempty key at the public money API: %s", async clientRequestId => {
    const before = state(); await expect(api().member.wallet({ ...input(), clientRequestId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state()).toEqual(before);
  });
  it("uses session identity, replays after operator rename and rejects a different authenticated operator", async () => {
    const receipt = await api().member.wallet({ ...input(), actor: "Spoofed manager" });
    expect(db.prepare("SELECT actor FROM member_transactions WHERE client_request_id=?").get(input().clientRequestId!)).toMatchObject({ actor: "Cashier" });
    const before = state(); await expect(api("cashier", 1, "Renamed operator").member.wallet(input())).resolves.toEqual(receipt);
    await expect(api("cashier", 2).member.wallet(input())).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state()).toEqual(before);
  });
  it.each(["auditor", "stock_officer"])("requires wallet permission for %s to return a card with money", async role => {
    const session = db.prepare("SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL").get(memberNumber) as { id: number };
    const before = state(); await expect(api(role).card.return({ memberNumber, cardNumber: "RETRY-CARD", expectedSessionId: session.id, mode: "refund" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(state()).toEqual(before);
  });
});
