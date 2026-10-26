import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  checkout,
  createProduct,
  createSqliteStore,
  ensureRbacSeed,
  getSettings,
  registerPosTerminal,
  setupInitialAdmin,
  type SqliteDb,
} from "./sqliteStore";
const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({
  getWelfareDb: store.get,
  getWelfareDbPath: () => "unused-release-fixture.sqlite",
  getBackupDir: () => "unused-test-backups",
}));
import { appRouter } from "./routers";
let db: SqliteDb;
let productId: number;
const deviceId = "12345678-1234-4234-8234-123456789012";
const account = {
  username: "owner",
  displayName: "Fixture owner",
  password: "FixturePassword123!",
  storeName: "Fixture store",
};
function caller(role = "administrator") {
  return appRouter.createCaller({
    req: { headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn() } as unknown as TrpcContext["res"],
    user: {
      id: 1,
      openId: "owner",
      name: "Fixture owner",
      role: role === "administrator" ? "admin" : "user",
      appRole: role,
      mustChangePassword: true,
    } as TrpcContext["user"],
  });
}
beforeEach(() => {
  db = createSqliteStore();
  store.get.mockReturnValue(db);
  ensureRbacSeed(db);
  setupInitialAdmin(db, account);
  productId = createProduct(db, {
    name: "Fixture product",
    category: "อาหาร",
    unit: "ชิ้น",
    price: 10,
    cost: 4,
    stock: 5,
  }).id;
});
afterEach(() => {
  db.close();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
function bill() {
  return {
    items: [{ productId, qty: 1 }],
    paymentMethod: "เงินสด" as const,
    receivedCash: 10,
    clientRequestId: "release-channel-attempt",
  };
}
describe("release channel behavior with isolated store", () => {
  it("Railway skips the first-password screen without rewriting account or session state", async () => {
    const before = db.prepare("SELECT * FROM app_users").all();
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    expect(await caller().auth.me()).toMatchObject({
      mustChangePassword: false,
    });
    expect(db.prepare("SELECT * FROM app_users").all()).toEqual(before);
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "windows-final");
    expect(await caller().auth.me()).toMatchObject({
      mustChangePassword: true,
    });
  });
  it("Railway permits unregistered checkout and preserves duplicate-submit protection", async () => {
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    const settings = getSettings(db);
    const receipt = await caller().pos.checkout(bill());
    expect(receipt.terminalId).toBeNull();
    expect(await caller().pos.checkout(bill())).toEqual(receipt);
    expect(
      db.prepare("SELECT stock FROM products WHERE id=?").get(productId)
    ).toMatchObject({ stock: 4 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toMatchObject({
      n: 1,
    });
    expect(getSettings(db)).toEqual(settings);
  });
  it("Railway login still checks the existing password", async () => {
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    await expect(
      caller().auth.login({
        username: account.username,
        password: "WrongFixturePassword!",
      })
    ).rejects.toThrow();
    await expect(
      caller().auth.login({
        username: account.username,
        password: account.password,
      })
    ).resolves.toMatchObject({ mustChangePassword: false });
    expect(
      db.prepare("SELECT must_change_password FROM app_users WHERE id=1").get()
    ).toMatchObject({ must_change_password: 1 });
  });
  it("Railway initial setup does not start a trial or consume license settings", async () => {
    db.close();
    db = createSqliteStore();
    store.get.mockReturnValue(db);
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    await expect(
      caller().auth.setup({ ...account, editionChoice: "trial" })
    ).resolves.toMatchObject({ mustChangePassword: false });
    expect(getSettings(db).trialStart).toBe("");
    expect(
      db.prepare("SELECT must_change_password FROM app_users").get()
    ).toMatchObject({ must_change_password: 1 });
  });
  it("Railway retains already registered terminal identity", async () => {
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    registerPosTerminal(db, deviceId, 2, "Fixture admin");
    expect(
      await caller().pos.checkout({ ...bill(), terminalDeviceId: deviceId })
    ).toMatchObject({ terminalNumber: 2 });
  });
  it("Final rejects missing registration before changing stock or money", () => {
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "windows-final");
    expect(() => checkout(db, bill())).toThrow(/กำหนดจุดขาย/);
    expect(
      db.prepare("SELECT stock FROM products WHERE id=?").get(productId)
    ).toMatchObject({ stock: 5 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toMatchObject({
      n: 0,
    });
    registerPosTerminal(db, deviceId, 1, "Fixture admin");
    expect(
      checkout(db, { ...bill(), terminalDeviceId: deviceId })
    ).toMatchObject({ terminalNumber: 1 });
  });
  it("Railway continues enforcing staff permissions and valid money", async () => {
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    await expect(
      caller("stock_officer").pos.checkout(bill())
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().pos.checkout({ ...bill(), receivedCash: 1 })
    ).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toMatchObject({
      n: 0,
    });
  });
});
