import { describe, expect, it } from "vitest";
import { StoreError } from "../domain/storeError";
import { TransactionCommitUnknownError } from "../database/postgresTransaction";
import { withStoreErrors, withStoreErrorsAsync } from "./storeErrors";

describe("sync and async business error mapping", () => {
  it("keeps existing synchronous routes synchronous", () => {
    expect(withStoreErrors(() => 7)).toBe(7);
    expect(() =>
      withStoreErrors(() => {
        throw new StoreError("ยอดไม่พอ");
      }),
    ).toThrow("ยอดไม่พอ");
  });
  it("maps business failures thrown after await to BAD_REQUEST", async () => {
    await expect(
      withStoreErrorsAsync(async () => {
        await Promise.resolve();
        throw new StoreError("ยอดไม่พอ");
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "ยอดไม่พอ" });
  });
  it("maps a synchronous throw inside an async route too", async () => {
    await expect(
      withStoreErrorsAsync(() => {
        throw new StoreError("ข้อมูลไม่ครบ");
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "ข้อมูลไม่ครบ" });
  });
  it("preserves successful async values and unrelated failure identities", async () => {
    expect(await withStoreErrorsAsync(async () => ({ id: 5 }))).toEqual({
      id: 5,
    });
    const error = new Error("unexpected failure");
    expect(() =>
      withStoreErrors(() => {
        throw error;
      }),
    ).toThrow(error);
    await expect(
      withStoreErrorsAsync(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
  it("does not turn an unknown COMMIT result into a business validation error", async () => {
    const error = new TransactionCommitUnknownError(
      new Error("connection lost"),
    );
    await expect(
      withStoreErrorsAsync(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
