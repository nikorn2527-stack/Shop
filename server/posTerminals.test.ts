import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  checkout,
  createProduct,
  createSqliteStore,
  getPosTerminal,
  listPosTerminals,
  registerPosTerminal,
  releasePosTerminal,
  salesList,
  type SqliteDb,
} from "./sqliteStore";
const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({
  getWelfareDb: store.get,
  getWelfareDbPath: () => "unused.sqlite",
  getBackupDir: () => "unused-backups",
  closeWelfareDb: vi.fn(),
}));
import { appRouter } from "./routers";
let db: SqliteDb;
const device = randomUUID(),
  otherDevice = randomUUID();
beforeEach(() => {
  db = createSqliteStore();
  store.get.mockReturnValue(db);
});
afterEach(() => {
  db.close();
  vi.clearAllMocks();
});
function caller(role: "admin" | "user" | null = "admin") {
  return appRouter.createCaller({
    user: role
      ? ({
          id: 1,
          name: "Test admin",
          role,
          appRole: role === "admin" ? "administrator" : "cashier",
        } as TrpcContext["user"])
      : null,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}
const bill = (terminalDeviceId = device) => ({
  terminalDeviceId,
  items: [{ name: "Fixture special", price: 10, qty: 1 }],
  paymentMethod: "เงินสด" as const,
});
describe("POS browser registration and historical attribution", () => {
  it("starts unassigned and refuses duplicate numbers without reassigning the original device", () => {
    expect(getPosTerminal(db, device)).toBeNull();
    const first = registerPosTerminal(db, device, 1, "Admin");
    expect(registerPosTerminal(db, device, 1, "Admin").id).toBe(first.id);
    expect(() => registerPosTerminal(db, otherDevice, 1, "Admin")).toThrow(
      /เครื่องอื่น/
    );
    expect(listPosTerminals(db)).toHaveLength(1);
    expect(getPosTerminal(db, otherDevice)).toBeNull();
    expect(registerPosTerminal(db, otherDevice, 2, "Admin").number).toBe(2);
  });
  it("keeps the terminal identity when renamed and snapshots the original number for reprint/retry", () => {
    const first = registerPosTerminal(db, device, 1, "Admin");
    const receipt = checkout(db, {
      ...bill(),
      clientRequestId: "terminal-retry",
    });
    expect(receipt).toMatchObject({ terminalId: first.id, terminalNumber: 1 });
    expect(registerPosTerminal(db, device, 3, "Admin").id).toBe(first.id);
    expect(salesList(db)[0].terminalNumber).toBe(1);
    releasePosTerminal(db, first.id, "Admin");
    expect(
      checkout(db, { ...bill(), clientRequestId: "terminal-retry" })
    ).toMatchObject({ orderNumber: receipt.orderNumber, terminalNumber: 1 });
    expect(() => checkout(db, bill())).toThrow(/ยังไม่ได้กำหนดจุดขาย/);
    expect(salesList(db)).toHaveLength(1);
    expect(registerPosTerminal(db, otherDevice, 1, "Admin").id).not.toBe(
      first.id
    );
  });
  it("rejects unknown/invalid devices and leaves sales untouched", () => {
    expect(() => checkout(db, bill())).toThrow(/ยังไม่ได้กำหนดจุดขาย/);
    for (const n of [0, -1, 1.5, 1000])
      expect(() => registerPosTerminal(db, device, n, "Admin")).toThrow(
        /ไม่ถูกต้อง/
      );
    expect(() => registerPosTerminal(db, "ip-address", 1, "Admin")).toThrow(
      /ไม่ถูกต้อง/
    );
    expect(salesList(db)).toHaveLength(0);
  });
  it("preserves old unattributed bills as unknown, without inventing station 01", () => {
    const { terminalDeviceId, ...legacy } = bill();
    checkout(db, legacy);
    registerPosTerminal(db, device, 1, "Admin");
    expect(salesList(db)[0]).toMatchObject({
      terminalId: null,
      terminalNumber: null,
    });
  });
  it("persists registration through database reopen without changing existing bills", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-migration-"));
    let disk: SqliteDb | undefined;
    try {
      const target = join(dir, "test.sqlite");
      disk = createSqliteStore(target);
      registerPosTerminal(disk, device, 2, "Admin");
      const receipt = checkout(disk, bill());
      disk.close();
      disk = createSqliteStore(target);
      expect(getPosTerminal(disk, device)?.number).toBe(2);
      expect(salesList(disk)[0]).toMatchObject({
        orderNumber: receipt.orderNumber,
        terminalNumber: 2,
      });
    } finally {
      disk?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("requires login to read and administrator access to assign or release", async () => {
    await expect(
      caller(null).pos.terminal({ deviceId: device })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(null).pos.terminals()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller("user").pos.registerTerminal({ deviceId: device, number: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await caller().pos.registerTerminal({
      deviceId: device,
      number: 1,
    });
    await expect(
      caller("user").pos.releaseTerminal({ id: first.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await caller("user").pos.terminal({ deviceId: device })
    ).toMatchObject({ number: 1 });
    expect(await caller().pos.terminals()).toHaveLength(1);
    expect(await caller().pos.terminals()).not.toContainEqual(
      expect.objectContaining({ deviceId: device })
    );
  });
  it("resolves checkout station from server registration for a cashier", async () => {
    await caller().pos.registerTerminal({ deviceId: device, number: 2 });
    const product = createProduct(db, {
      name: "Terminal fixture",
      category: "ของใช้",
      price: 10,
      stock: 5,
    });
    const receipt = await caller("user").pos.checkout({
      terminalDeviceId: device,
      items: [{ productId: product.id, qty: 1 }],
      paymentMethod: "เงินสด",
      receivedCash: 10,
      clientRequestId: "station-api-retry",
    });
    expect(receipt).toMatchObject({ terminalNumber: 2 });
    expect(salesList(db)[0]).toMatchObject({
      orderNumber: receipt.orderNumber,
      terminalNumber: 2,
    });
  });
  it("rejects missing registration at checkout API before writing a bill", async () => {
    const { terminalDeviceId, ...legacy } = bill();
    await expect(caller().pos.checkout(legacy as any)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // Catalog item avoids edition gating for special lines.
    await expect(
      caller().pos.checkout({
        terminalDeviceId: device,
        items: [{ productId: 1, qty: 1 }],
        paymentMethod: "เงินสด",
      receivedCash: 10,
      })
    ).rejects.toThrow(/ยังไม่ได้กำหนดจุดขาย/);
    expect(salesList(db)).toHaveLength(0);
  });
});
