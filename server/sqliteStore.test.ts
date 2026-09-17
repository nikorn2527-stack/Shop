import { afterEach, describe, expect, it } from "vitest";
import { createSqliteStore, getMemberDetail, getMemberNumberMode, seedSqliteDemoData, setMemberNumberMode, suspendMember } from "./sqliteStore";
import type { SqliteDb } from "./sqliteStore";

let db: SqliteDb | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("SQLite local test store", () => {
  it("stores a member with purchase, deposit and withdrawal history", () => {
    db = createSqliteStore();
    seedSqliteDemoData(db);

    const detail = getMemberDetail(db, "M-000218");

    expect(detail?.member.balance).toBe(1240);
    expect(detail?.member.status).toBe("active");
    expect(detail?.transactions.map((item) => item.type)).toEqual(["purchase", "deposit", "withdrawal"]);
  });

  it("persists member number mode changes", () => {
    db = createSqliteStore();
    expect(getMemberNumberMode(db)).toBe("running");
    setMemberNumberMode(db, "year");
    expect(getMemberNumberMode(db)).toBe("year");
  });

  it("suspends a member without deleting their transaction history", () => {
    db = createSqliteStore();
    seedSqliteDemoData(db);

    expect(suspendMember(db, "M-000218")).toBe(true);
    expect(getMemberDetail(db, "M-000218")?.member.status).toBe("suspended");
    expect(getMemberDetail(db, "M-000218")?.transactions).toHaveLength(3);
  });
});
