import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWelfareStore, createAppUser, updateAppUser, listAppUsers, findAppUserByUsername, verifyPassword, setupInitialAdmin } from "./sqliteStore";

describe("staff full and report names", () => {
  it("retains the initial administrator full name when assigning its first report alias", () => {
    const db = openWelfareStore(":memory:");
    try {
      const user = setupInitialAdmin(db, { username: "initial.owner", displayName: "นิกร พันโนนงิ้ว", password: "LocalTest1234" });
      const updated = updateAppUser(db, { userId: user.id, fullName: "นิกร พันโนนงิ้ว", displayName: "นิกร.พ" });
      expect(updated.fullName).toBe("นิกร พันโนนงิ้ว");
    } finally { db.close(); }
  });
  it("migrates a legacy account without changing its username, ID or password", () => {
    const dir = mkdtempSync(join(tmpdir(), "staff-profile-migration-"));
    const file = join(dir, "legacy.sqlite");
    try {
      const old = new DatabaseSync(file);
      old.exec("CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL)");
      old.prepare("INSERT INTO app_users VALUES (42, ?, ?, ?, 'staff', 1, '2026-01-01 00:00:00')").run("Legacy.Mixed", "unchanged-legacy-hash", "สมศรี ใจดี");
      old.close();
      const db = openWelfareStore(file);
      const migrated = listAppUsers(db).find(row => row.id === 42)!;
      expect(migrated).toMatchObject({ id: 42, username: "Legacy.Mixed", displayName: "สมศรี ใจดี", fullName: "สมศรี ใจดี", englishName: "" });
      updateAppUser(db, { userId: 42, displayName: "สมศรี.จ" });
      db.close();
      const reopened = openWelfareStore(file);
      try {
        expect(listAppUsers(reopened).find(row => row.id === 42)?.fullName).toBe("สมศรี ใจดี");
        expect(reopened.prepare("SELECT username, password_hash FROM app_users WHERE id = 42").get()).toMatchObject({ username: "Legacy.Mixed", password_hash: "unchanged-legacy-hash" });
      } finally { reopened.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("keeps full identities separate from the short display name", () => {
    const db = openWelfareStore(":memory:");
    try {
      const user = createAppUser(db, { username: "nikorn.p", password: "LocalTest1234", displayName: "นิกร.พ", fullName: "นิกร พันโนนงิ้ว", englishName: "Nikorn Punnonngiw", role: "staff" });
      expect(user.fullName).toBe("นิกร พันโนนงิ้ว");
      expect(user.englishName).toBe("Nikorn Punnonngiw");
      expect(user.displayName).toBe("นิกร.พ");
      expect(JSON.stringify(listAppUsers(db))).not.toContain("passwordHash");
      const updated = updateAppUser(db, { userId: user.id, displayName: "นิกร.พน", fullName: "นิกร พันโนนงิ้ว", englishName: "nikorn punnonngiw" });
      expect(updated.username).toBe("nikorn.p");
      expect(updated.id).toBe(user.id);
      expect(updated.displayName).toBe("นิกร.พน");
      const login = findAppUserByUsername(db, "nikorn.p")!;
      expect(login.id).toBe(user.id);
      expect(verifyPassword("LocalTest1234", login.passwordHash)).toBe(true);
    } finally { db.close(); }
  });
  it("preserves old-client full names when editing only display name or role", () => {
    const db = openWelfareStore(":memory:");
    try {
      const user = createAppUser(db, { username: "legacy.user", password: "LocalTest1234", displayName: "สมศรี ใจดี", role: "staff" });
      expect(user.fullName).toBe("สมศรี ใจดี");
      updateAppUser(db, { userId: user.id, displayName: "สมศรี.จ" });
      const updated = listAppUsers(db).find(row => row.id === user.id)!;
      expect(updated.fullName).toBe("สมศรี ใจดี");
      expect(updated.username).toBe("legacy.user");
      expect(updated.englishName).toBe("");
      expect(() => updateAppUser(db, { userId: user.id, fullName: " " })).toThrow();
    } finally { db.close(); }
  });
});
