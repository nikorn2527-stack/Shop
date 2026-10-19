import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import type { TrpcContext } from "./_core/context";
import { authenticateAppSession, createAppUser, createSqliteStore, listAppSessions, type SqliteDb } from "./sqliteStore";

const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({
  getWelfareDb: store.get,
  getWelfareDbPath: () => "unused-test.sqlite",
  getBackupDir: () => "unused-test-backups",
  closeWelfareDb: vi.fn(),
}));
import { appRouter } from "./routers";

let db: SqliteDb;
const password = "FixturePassword123!";
beforeEach(() => {
  db = createSqliteStore();
  store.get.mockReturnValue(db);
  createAppUser(db, { username: "transfer_staff", displayName: "Staff", password, role: "staff" });
  createAppUser(db, { username: "transfer_admin", displayName: "Admin", password, role: "admin" });
});
afterEach(() => { db.close(); vi.clearAllMocks(); });

function device(sessionId?: string) {
  const cookie = vi.fn();
  const caller = appRouter.createCaller({
    user: null,
    req: { ip: "127.0.0.1", headers: sessionId ? { cookie: `${COOKIE_NAME}=${sessionId}` } : {} } as TrpcContext["req"],
    res: { cookie, clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  });
  return { caller, cookie, sessionId: () => cookie.mock.calls.at(-1)?.[1] as string };
}

describe("login API session transfer", () => {
  it("allows different accounts to log in concurrently", async () => {
    const staff = device();
    const admin = device();
    const results = await Promise.all([
      staff.caller.auth.login({ username: "transfer_staff", password }),
      admin.caller.auth.login({ username: "transfer_admin", password }),
    ]);
    expect(results.map(result => result.requiresTransfer)).toEqual([undefined, undefined]);
    expect(authenticateAppSession(db, staff.sessionId())?.username).toBe("transfer_staff");
    expect(authenticateAppSession(db, admin.sessionId())?.username).toBe("transfer_admin");
    expect(listAppSessions(db)).toHaveLength(2);
  });

  it("requests confirmation without replacing the old session or setting a new cookie", async () => {
    const original = device();
    await original.caller.auth.login({ username: "transfer_staff", password });
    const sessions = listAppSessions(db);
    const next = device();
    const result = await next.caller.auth.login({ username: "transfer_staff", password });
    expect(result).toMatchObject({ requiresTransfer: true, createdAt: expect.any(String), lastSeenAt: expect.any(String) });
    expect(next.cookie).not.toHaveBeenCalled();
    // Cancelling in the UI sends no further request, so this session remains usable.
    expect(listAppSessions(db)).toEqual(sessions);
    expect(authenticateAppSession(db, original.sessionId())?.username).toBe("transfer_staff");
  });

  it("revokes only that account's old session after explicit confirmation", async () => {
    const original = device();
    const admin = device();
    await original.caller.auth.login({ username: "transfer_staff", password });
    await admin.caller.auth.login({ username: "transfer_admin", password });
    const next = device();
    await next.caller.auth.login({ username: "transfer_staff", password });
    await next.caller.auth.login({ username: "transfer_staff", password, replaceSession: true });
    expect(authenticateAppSession(db, original.sessionId())).toBeUndefined();
    expect(authenticateAppSession(db, next.sessionId())?.username).toBe("transfer_staff");
    expect(authenticateAppSession(db, admin.sessionId())?.username).toBe("transfer_admin");
    expect(listAppSessions(db)).toHaveLength(2);
  });

  it("does not ask for transfer when logging in from the current session", async () => {
    const original = device();
    await original.caller.auth.login({ username: "transfer_staff", password });
    const same = device(original.sessionId());
    expect(await same.caller.auth.login({ username: "transfer_staff", password })).not.toHaveProperty("requiresTransfer");
    expect(authenticateAppSession(db, same.sessionId())?.username).toBe("transfer_staff");
    expect(listAppSessions(db)).toHaveLength(1);
  });

  it("requires the correct password even when transfer is requested", async () => {
    const original = device();
    await original.caller.auth.login({ username: "transfer_staff", password });
    const next = device();
    await expect(next.caller.auth.login({ username: "transfer_staff", password: "wrong", replaceSession: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(next.cookie).not.toHaveBeenCalled();
    expect(authenticateAppSession(db, original.sessionId())?.username).toBe("transfer_staff");
  });

  it("allows a new device to log in directly after the original logs out", async () => {
    const original = device();
    await original.caller.auth.login({ username: "transfer_staff", password });
    await device(original.sessionId()).caller.auth.logout();
    const next = device();
    expect(await next.caller.auth.login({ username: "transfer_staff", password })).not.toHaveProperty("requiresTransfer");
    expect(authenticateAppSession(db, next.sessionId())?.username).toBe("transfer_staff");
  });
});
