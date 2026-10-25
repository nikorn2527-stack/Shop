import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createSqliteStore, createProduct, ensureRbacSeed, registerPosTerminal, type SqliteDb } from "./sqliteStore";
const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({ getWelfareDb: store.get, getWelfareDbPath: () => "unused-test.sqlite", getBackupDir: () => "unused-test-backups", closeWelfareDb: vi.fn() }));
import { appRouter } from "./routers";
let db: SqliteDb;
let productId: number;
const deviceId = "12345678-1234-4234-8234-123456789012";
beforeEach(() => {
  db = createSqliteStore(); ensureRbacSeed(db); store.get.mockReturnValue(db);
  registerPosTerminal(db, deviceId, 1, "Test admin");
  productId = createProduct(db, { name: "Catalog test", price: 100, stock: 10, cost: 20 }).id;
});
afterEach(() => { db.close(); vi.clearAllMocks(); });
function api() {
  return appRouter.createCaller({ user: { id: 1, name: "Cashier", role: "user", appRole: "cashier" } as TrpcContext["user"], req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });
}
function bill() { return { clientRequestId: "integrity-attempt", terminalDeviceId: deviceId, items: [{ productId, qty: 1 }], paymentMethod: "เงินสด" as const, receivedCash: 100 }; }
function expectUnchanged() {
  expect(db.prepare("SELECT stock FROM products WHERE id=?").get(productId)).toMatchObject({ stock: 10 });
  for (const table of ["sales", "sale_items", "member_transactions", "stock_movements"]) {
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
  }
}
describe("checkout API payment integrity", () => {
  it.each([undefined, null, "", "   "])("requires a nonempty request ID before payment: %s", async clientRequestId => {
    await expect(api().pos.checkout({ ...bill(), clientRequestId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectUnchanged();
  });
  it.each([undefined, null, 0, 99, NaN, Infinity])("rejects missing, invalid or insufficient cash: %s", async receivedCash => {
    await expect(api().pos.checkout({ ...bill(), receivedCash })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectUnchanged();
  });
  it("derives change on the server, persists it and replays the same receipt", async () => {
    const input = { ...bill(), receivedCash: 150, changeDue: 999, clientRequestId: "cash-math" };
    const receipt = await api().pos.checkout(input);
    expect(receipt).toMatchObject({ total: 100, receivedCash: 150, changeDue: 50, paymentVerified: null });
    expect(db.prepare("SELECT received_cash, change_due FROM sales").get()).toMatchObject({ received_cash: 150, change_due: 50 });
    await expect(api().pos.checkout(input)).resolves.toEqual(receipt);
    await expect(api().pos.checkout({ ...input, items: [{ productId, qty: 2 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.prepare("SELECT stock FROM products WHERE id=?").get(productId)).toMatchObject({ stock: 9 });
  });
  it.each([undefined, null, false])("requires QR cashier confirmation: %s", async paymentVerified => {
    await expect(api().pos.checkout({ ...bill(), paymentMethod: "QR / สแกน", paymentVerified })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectUnchanged();
  });
  it("allows confirmed QR and ignores irrelevant cash details", async () => {
    const receipt = await api().pos.checkout({ ...bill(), paymentMethod: "QR / สแกน", paymentVerified: true, changeDue: 999 });
    expect(receipt).toMatchObject({ total: 100, paymentVerified: true, receivedCash: null, changeDue: null });
  });
  it.each([0.01, 99, 101])("rejects a client catalog price override: %s", async price => {
    await expect(api().pos.checkout({ ...bill(), items: [{ productId, qty: 1, price }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectUnchanged();
  });
  it("uses the server catalog unit and name", async () => {
    const receipt = await api().pos.checkout({ ...bill(), items: [{ productId, qty: 1, price: 100, unit: "Forged unit" }] });
    expect(receipt.items[0]).toMatchObject({ name: "Catalog test", unit: "ชิ้น", price: 100, amount: 100 });
  });
  it.each(["discount", "special"])("honors revoked %s permission even when sale permission remains", async kind => {
    const key = kind === "discount" ? "POS.DISCOUNT" : "POS.SPECIAL";
    db.prepare("DELETE FROM role_permissions WHERE role_name='cashier' AND permission_key=?").run(key);
    const input = kind === "discount" ? { ...bill(), discount: 10 } : { ...bill(), items: [{ name: "Special", qty: 1, price: 100 }] };
    await expect(api().pos.checkout(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectUnchanged();
  });
  it("preserves configured money tiers and exact portion amounts despite repeating unit prices", async () => {
    const ice = createProduct(db, { name: "Ice", price: 10, stock: 300, unit: "ก.", sellMode: "money", priceTiers: JSON.stringify([{ label: "Small", qty: 3, price: 10 }, { label: "Large", qty: 6, price: 15 }]) });
    const receipt = await api().pos.checkout({ ...bill(), receivedCash: 50, items: [{ productId: ice.id, qty: 6, label: "Small", price: 3.3333 }, { productId: ice.id, qty: 6, label: "Large", price: 2.5 }] });
    expect(receipt).toMatchObject({ subtotal: 35, total: 35, changeDue: 15 });
    expect(receipt.items).toMatchObject([{ name: "Ice · Small", qty: 6, amount: 20 }, { name: "Ice · Large", qty: 6, amount: 15 }]);
    expect(db.prepare("SELECT stock FROM products WHERE id=?").get(ice.id)).toMatchObject({ stock: 288 });
  });
  it.each([
    { label: "Small", qty: 3, price: 0.01 },
    { label: "Nonexistent", qty: 3, price: 3.3333 },
    { label: "Small", qty: 2, price: 3.3333 },
    { qty: 3 },
  ])("rejects invalid money tier requests without changing stock: %j", async line => {
    db.prepare("UPDATE products SET sell_mode='money', price_tiers=? WHERE id=?").run(JSON.stringify([{ label: "Small", qty: 3, price: 10 }]), productId);
    await expect(api().pos.checkout({ ...bill(), items: [{ productId, ...line }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectUnchanged();
  });
  it("rejects unpriced catalog items", async () => {
    db.prepare("UPDATE products SET price=0 WHERE id=?").run(productId);
    await expect(api().pos.checkout(bill())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectUnchanged();
  });
});
