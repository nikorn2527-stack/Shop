import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppUser, openWelfareStore, createAppSession, type SqliteDb } from "./sqliteStore";
import type { TrpcContext } from "./_core/context";
import { COOKIE_NAME } from "../shared/const";

const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({ getWelfareDb: store.get, getWelfareDbPath: () => "unused-test.sqlite", getBackupDir: () => "unused-test-backups", closeWelfareDb: vi.fn() }));
import { appRouter } from "./routers";
import { createContext } from "./_core/context";

let db: SqliteDb;
beforeEach(() => { db = openWelfareStore(":memory:"); store.get.mockReturnValue(db); });
afterEach(() => { db.close(); vi.clearAllMocks(); });
const caller = (role: "admin" | "user", id: number) => appRouter.createCaller({
  user: { id, name: "Test admin", role, appRole: role === "admin" ? "admin" : "staff" } as TrpcContext["user"],
  req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"],
});

describe("staff profile API", () => {
  it("persists full/English names through create and update, with short session identity", async () => {
    const admin = createAppUser(db, { username: "admin.test", displayName: "Admin", password: "LocalTest1234", role: "admin" });
    const api = caller("admin", admin.id);
    const user = await api.user.create({ username: "NIKORN.P", password: "LocalTest1234", displayName: "นิกร.พ", fullName: "นิกร พันโนนงิ้ว", englishName: "Nikorn Punnonngiw", role: "staff" });
    expect(user).toMatchObject({ username: "nikorn.p", fullName: "นิกร พันโนนงิ้ว", englishName: "Nikorn Punnonngiw" });
    const updated = await api.user.update({ userId: user.id, displayName: "นิกร.พน", fullName: "นิกร พันโนนงิ้ว", englishName: "nikorn punnonngiw" });
    expect(updated).toMatchObject({ id: user.id, username: "nikorn.p", englishName: "nikorn punnonngiw", displayName: "นิกร.พน" });
    const session = createAppSession(db, user.id);
    const ctx = await createContext({ req: { headers: { cookie: `${COOKIE_NAME}=${session.sessionId}` } } as TrpcContext["req"], res: {} as TrpcContext["res"], info: {} as never });
    expect(ctx.user).toMatchObject({ id: user.id, openId: "nikorn.p", name: "นิกร.พน" });
    await expect(api.user.create({ username: "Nikorn.P", password: "LocalTest1234", displayName: "Other", role: "staff" })).rejects.toThrow(/ชื่อผู้ใช้/);
    await expect(api.user.update({ userId: admin.id, role: "staff", fullName: "Changed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user", user.id).user.update({ userId: user.id, fullName: "Changed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
