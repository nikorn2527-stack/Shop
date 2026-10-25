import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { authenticateAppSession, createSqliteStore, getSettings, setupInitialAdmin, type SqliteDb } from "./sqliteStore";

const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({ getWelfareDb: store.get, getWelfareDbPath: () => "unused-test.sqlite", getBackupDir: () => "unused-test-backups", closeWelfareDb: vi.fn() }));
import { appRouter } from "./routers";
let db: SqliteDb;
const input = { username: "owner", displayName: "Shop owner", password: "FixturePassword123!", storeName: "New test store" };
beforeEach(() => { db = createSqliteStore(); store.get.mockReturnValue(db); });
afterEach(() => { db.close(); vi.clearAllMocks(); });
function device() {
  const cookie = vi.fn();
  const api = appRouter.createCaller({ user: null, req: { headers: {} } as TrpcContext["req"], res: { cookie } as unknown as TrpcContext["res"] });
  return { api, cookie };
}
describe("initial setup atomicity", () => {
  it("rejects an invalid license without consuming initial setup", async () => {
    const { api, cookie } = device();
    const before = getSettings(db);
    await expect(api.auth.setup({ ...input, editionChoice: "license", licenseKey: "INVALID" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await api.auth.setupStatus()).toEqual({ needsSetup: true });
    expect(getSettings(db)).toEqual(before);
    expect(cookie).not.toHaveBeenCalled();
    await expect(api.auth.setup({ ...input, editionChoice: "standard" })).resolves.toMatchObject({ username: "owner" });
  });
  it.each(["session", "login audit"])("rolls back account and settings after a late %s failure", async stage => {
    const { api, cookie } = device();
    const before = getSettings(db);
    db.exec(stage === "session"
      ? "CREATE TRIGGER fail_setup BEFORE INSERT ON app_sessions BEGIN SELECT RAISE(ABORT, 'injected session failure'); END"
      : "CREATE TRIGGER fail_setup BEFORE INSERT ON audit_logs WHEN NEW.action = 'เข้าสู่ระบบ' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
    await expect(api.auth.setup({ ...input, editionChoice: "trial" })).rejects.toThrow(/injected/);
    expect(await api.auth.setupStatus()).toEqual({ needsSetup: true });
    expect(getSettings(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_sessions").get()).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()).toMatchObject({ n: 0 });
    expect(cookie).not.toHaveBeenCalled();
    db.exec("DROP TRIGGER fail_setup");
    await expect(api.auth.setup(input)).resolves.toMatchObject({ username: "owner" });
  });
  it("also rolls back standalone administrator creation if its audit fails", () => {
    db.exec("CREATE TRIGGER fail_setup BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
    const before = getSettings(db);
    expect(() => setupInitialAdmin(db, input)).toThrow(/injected/);
    expect(getSettings(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_users").get()).toMatchObject({ n: 0 });
  });
  it.each(["trial", "standard"] as const)("commits %s setup and an authenticated session once", async editionChoice => {
    const { api, cookie } = device();
    const user = await api.auth.setup({ ...input, editionChoice });
    expect(authenticateAppSession(db, cookie.mock.calls[0][1])).toMatchObject({ id: user.id, username: "owner" });
    expect(getSettings(db)).toMatchObject({ storeName: input.storeName });
    expect(await api.auth.setupStatus()).toEqual({ needsSetup: false });
    await expect(api.auth.setup({ ...input, editionChoice })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_sessions").get()).toMatchObject({ n: 1 });
  });
});
