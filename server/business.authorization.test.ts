import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createSqliteStore, createProduct, ensureRbacSeed, type SqliteDb } from "./sqliteStore";

const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({
  getWelfareDb: store.get,
  getWelfareDbPath: () => "unused-test.sqlite",
  getBackupDir: () => "unused-test-backups",
  closeWelfareDb: vi.fn(),
}));
import { appRouter } from "./routers";

let db: SqliteDb;
beforeEach(() => {
  db = createSqliteStore();
  ensureRbacSeed(db);
  store.get.mockReturnValue(db);
});
afterEach(() => { db.close(); vi.clearAllMocks(); });

function caller(appRole?: string) {
  return appRouter.createCaller({
    user: appRole ? {
      id: 1, name: "Test operator", role: appRole === "administrator" ? "admin" : "user",
      appRole,
    } as TrpcContext["user"] : null,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

describe("business API permissions", () => {
  it("exposes only branding before login and protects operational settings", async () => {
    const brand = await caller().settings.brand();
    expect(Object.keys(brand).sort()).toEqual(["appName", "appLogo", "appTheme", "appStyle", "appBackground", "loginBackground"].sort());
    expect(brand.loginBackground).toBe("");
    await expect(caller().settings.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires authentication to read a stock card", async () => {
    await expect(caller().stock.card({ productId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(store.get).not.toHaveBeenCalled();
  });

  it.each(["cashier", "auditor"])("blocks %s from receiving inventory", async role => {
    await expect(caller(role).stock.receiveBatch({ entries: [
      { productId: 1, purchaseQty: 1, paidAmount: 10 },
    ] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM stock_lots").get()).toMatchObject({ n: 0 });
  });

  it("allows receiving stock but reserves receipt-time repricing for administrators", async () => {
    const product=createProduct(db,{name:"Officer intake",price:20});
    await expect(caller("stock_officer").stock.receiptPricing({productId:product.id})).resolves.toMatchObject({sellingPrice:20});
    await expect(caller("stock_officer").stock.receiveBatch({entries:[{productId:product.id,purchaseQty:1,paidAmount:5,sellingPrice:25,expectedSellingPrice:20}]})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(db.prepare("SELECT stock,price FROM products WHERE id=?").get(product.id)).toMatchObject({stock:0,price:20});
    await expect(caller("stock_officer").stock.receiveBatch({entries:[{productId:product.id,purchaseQty:1,paidAmount:5}]})).resolves.toHaveLength(1);
  });

  it("protects receipt cost source details before opening the database", async () => {
    await expect(caller().stock.receiptSource({lotId:1})).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(store.get).not.toHaveBeenCalled();
  });

  it("keeps receiving API output and source references after the service extraction", async () => {
    const product = createProduct(db, { name: "API existing", price: 20 });
    const api = caller("administrator");
    const results = await api.stock.receiveBatch({ entries: [
      { newProduct: { name: "API new", sku: "API-NEW", price: 10 }, purchaseQty: 2, freeQty: 1, paidAmount: 3 },
      { productId: product.id, purchaseQty: 2, freeQty: 1, paidAmount: 6, sellingPrice: 25, expectedSellingPrice: 20 },
    ] });
    expect(results[0].product).toMatchObject({ sku: "API-NEW", stock: 3 });
    expect(results[1].product).toMatchObject({ id: product.id, stock: 3, price: 25 });
    const pricing = await api.stock.receiptPricing({ productId: product.id });
    expect(pricing).toMatchObject({ sellingPrice: 25, previousCost: 2 });
    const source = await api.stock.receiptSource({ lotId: pricing.previousReceipt!.id });
    expect(source).toMatchObject({ quantity: 3, paidAmount: 6, unitCost: 2 });
    expect(source.lines).toHaveLength(2);
    const received = await api.stock.receive({ productId: product.id, purchaseQty: 1, freeQty: 1, paidAmount: 2 });
    expect(received.product).toMatchObject({ id: product.id, stock: 5, price: 25 });
  });

  it("maps extracted business errors to BAD_REQUEST without leaving a partial receipt", async () => {
    const api = caller("administrator");
    const product = createProduct(db, { name: "API stale price", price: 20 });
    await expect(api.stock.receiveBatch({ entries: [
      { newProduct: { name: "Should roll back", sku: "API-NO-PARTIAL", price: 10 }, purchaseQty: 1, paidAmount: 1 },
      { productId: 999999, purchaseQty: 1, paidAmount: 1 },
    ] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.prepare("SELECT id FROM products WHERE sku = 'API-NO-PARTIAL'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM stock_lots").get()).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM stock_movements").get()).toMatchObject({ n: 0 });
    await expect(api.stock.receiveBatch({ entries: [
      { productId: product.id, purchaseQty: 1, paidAmount: 1, sellingPrice: 25, expectedSellingPrice: 19 },
    ] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.prepare("SELECT stock, price FROM products WHERE id = ?").get(product.id)).toMatchObject({ stock: 0, price: 20 });
  });

  it("allows stock officers to read inventory using their actual app role", async () => {
    await expect(caller("stock_officer").stock.rows()).resolves.toEqual([]);
  });

  it("blocks an auditor from changing member money and identity", async () => {
    await expect(caller("auditor").member.wallet({
      memberNumber: "700001", type: "deposit", amount: 10,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("auditor").member.setStatus({
      memberNumber: "700001", suspended: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("honors revoked permissions even for an administrator", async () => {
    db.prepare("DELETE FROM role_permissions WHERE role_name = ? AND permission_key = ?")
      .run("administrator", "STOCK.RECEIVE");
    await expect(caller("administrator").stock.receiveBatch({ entries: [
      { productId: 1, purchaseQty: 1, paidAmount: 10 },
    ] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
