import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireSqliteProvider } from "./provider";
import { closeWelfareDb, getWelfareDb } from "../welfareStore";
afterEach(() => {
  closeWelfareDb();
  vi.unstubAllEnvs();
});
describe("database selection safety", () => {
  it("preserves default SQLite and the separate legacy MySQL URL", () => {
    expect(() => requireSqliteProvider({})).not.toThrow();
    expect(() =>
      requireSqliteProvider({ DATABASE_URL: "mysql://legacy" })
    ).not.toThrow();
    expect(() =>
      requireSqliteProvider({
        SHOP_DATABASE_PROVIDER: "sqlite",
        DATABASE_URL: "postgresql://unused",
      })
    ).not.toThrow();
  });
  it("does not silently treat PostgreSQL URLs or explicit PostgreSQL selection as SQLite", () => {
    for (const configuration of [
      { SHOP_DATABASE_PROVIDER: "postgresql" },
      {
        DATABASE_URL:
          "postgresql://PRIVATE_USER:PRIVATE_PASSWORD@localhost/shop",
      },
      { DATABASE_URL: "postgres://localhost/shop" },
    ]) {
      let message = "";
      try {
        requireSqliteProvider(configuration);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("no SQLite fallback");
      expect(message).not.toContain("PRIVATE_");
    }
    expect(() =>
      requireSqliteProvider({ SHOP_DATABASE_PROVIDER: "typo" })
    ).toThrow(/must be/);
  });
  it("blocks before creating any fallback database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "shop-provider-")),
      path = join(dir, "must-not-exist.sqlite");
    try {
      vi.stubEnv("SQLITE_DB_PATH", path);
      vi.stubEnv("SHOP_DATABASE_PROVIDER", "postgresql");
      expect(() => getWelfareDb()).toThrow(
        /PostgreSQL application provider is not complete/
      );
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
