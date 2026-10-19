import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createSqliteStore, getSettings, type SqliteDb } from "./sqliteStore";
import { QR_BANKS } from "@shared/paymentQr";
import { buildPromptPayPayload } from "../client/src/promptpay";

const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({ getWelfareDb: store.get, getWelfareDbPath: () => "unused.sqlite", getBackupDir: () => "unused-backups", closeWelfareDb: vi.fn() }));
import { appRouter } from "./routers";

let db: SqliteDb;
beforeEach(() => { db = createSqliteStore(); store.get.mockReturnValue(db); });
afterEach(() => { db.close(); vi.clearAllMocks(); });
function caller(admin = true) {
  return appRouter.createCaller({ user: { id: 1, name: "Test", role: admin ? "admin" : "user", appRole: admin ? "administrator" : "cashier" } as TrpcContext["user"], req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });
}
const qrPayload = buildPromptPayPayload({ promptpayId: "0812345678" });
const account = (bankCode = "KTB") => ({ id: "account-one", bankCode, bankName: "Fixture bank", accountNumber: "1234567890", accountName: "Fixture account", active: true, qrPayload });

describe("bank QR settings API", () => {
  it.each(QR_BANKS)("persists $code QR and preference without clearing PromptPay", async bank => {
    await caller().settings.set({ promptpayId: "0899999999", bankAccounts: [{ ...account(bank.code), bankName: bank.name }], paymentQrSource: "account-one" });
    const saved = await caller().settings.get();
    expect(saved.bankAccounts[0].qrPayload).toBe(qrPayload);
    expect(saved.paymentQrSource).toBe("account-one");
    expect(saved.promptpayId).toBe("0899999999");
  });
  it("rejects invalid or unsupported bank QR before changing settings", async () => {
    const before = getSettings(db);
    for (const bank of [account("UNKNOWN"), { ...account(), qrPayload: "1234567890" }, { ...account(), qrPayload: buildPromptPayPayload({ promptpayId: "0812345678", amount: 30 }) }]) {
      await expect(caller().settings.set({ bankAccounts: [bank] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(getSettings(db)).toEqual(before);
    }
  });
  it("requires administrator access and preserves legacy accounts without QR", async () => {
    await expect(caller(false).settings.set({ bankAccounts: [account()] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { qrPayload: omitted, ...legacy } = account();
    await caller().settings.set({ bankAccounts: [legacy] });
    expect(getSettings(db).bankAccounts[0]).toEqual(legacy);
  });
});
