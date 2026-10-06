import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const database = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./welfareStore", () => ({
  getWelfareDb: database.get,
  getWelfareDbPath: () => "unused-test.sqlite",
  getBackupDir: () => "unused-test-backups",
  closeWelfareDb: vi.fn(),
}));

import { appRouter } from "./routers";

describe("shift authorization", () => {
  const caller = () => appRouter.createCaller({
    user: null,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });

  it("rejects anonymous reads before opening the database", async () => {
    await expect(caller().shift.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(database.get).not.toHaveBeenCalled();
  });

  it("rejects anonymous shift creation before opening the database", async () => {
    await expect(caller().shift.open({ cashierName: "Forged operator", openingCash: 100 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(database.get).not.toHaveBeenCalled();
  });

  it("rejects anonymous shift closure before opening the database", async () => {
    await expect(caller().shift.close({ shiftId: 1, countedCash: 100 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(database.get).not.toHaveBeenCalled();
  });

  it("rejects anonymous sale cancellation before opening the database", async () => {
    await expect(caller().pos.void({ saleId: 1, reason: "Unauthorized cancellation" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(database.get).not.toHaveBeenCalled();
  });
});