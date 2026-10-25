import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
import { createSqliteStore, hashPassword, verifyPassword } from "./sqliteStore";
import { recoverLanTestAccount, lanTestRecoveryPaths } from "./lanTestRecovery";
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shop-recover-"));
  roots.push(root);
  mkdirSync(join(root, ".lan-test"));
  writeFileSync(
    join(root, ".lan-test/config.json"),
    JSON.stringify({
      version: 1,
      purpose: "shop-lan-test",
      secret: "s".repeat(96),
      port: 43987,
    })
  );
  const path = join(root, ".lan-test/store.sqlite"),
    db = createSqliteStore(path);
  db.prepare(
    "INSERT INTO app_users (username,password_hash,display_name,role,active,created_at,failed_attempts,locked_until,must_change_password) VALUES ('test.owner',?,'Test owner','administrator',1,'2026-10-25',5,'2099-01-01',1)"
  ).run(hashPassword("OldTest123!"));
  db.prepare(
    "INSERT INTO app_users (username,password_hash,display_name,role,active,created_at,failed_attempts,locked_until) VALUES ('other',?,'Other','staff',1,'2026-10-25',3,'2099-01-01')"
  ).run(hashPassword("OtherTest123!"));
  db.exec(
    "INSERT INTO app_sessions (id,user_id,expires_at,created_at) VALUES ('owner-session',1,'2099-01-01','2026-10-25'),('other-session',2,'2099-01-01','2026-10-25'); INSERT INTO products (sku,name,price,stock) VALUES ('001','สินค้า',25,9); INSERT INTO members (member_number,first_name,last_name,balance) VALUES ('0001','สมมติ','ทดสอบ',123.45)"
  );
  db.close();
  return { root, path };
}
function rows(path: string, query: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(query).all();
  } finally {
    db.close();
  }
}
describe("isolated LAN account recovery", () => {
  it("backs up first, updates only the selected account, revokes only its sessions and retains every business row", () => {
    const { root, path } = fixture();
    const otherBefore = rows(path, "SELECT * FROM app_users WHERE id=2"),
      products = rows(path, "SELECT * FROM products"),
      members = rows(path, "SELECT * FROM members");
    vi.stubEnv("SQLITE_DB_PATH", join(root, "BUSINESS-MUST-NOT-OPEN.sqlite"));
    const result = recoverLanTestAccount(
      root,
      "TEST.OWNER",
      "NewPrivateTest456!"
    );
    const user = rows(path, "SELECT * FROM app_users WHERE id=1")[0];
    expect(user).toMatchObject({
      role: "administrator",
      active: 1,
      failed_attempts: 0,
      locked_until: null,
      must_change_password: 0,
    });
    expect(
      verifyPassword("NewPrivateTest456!", String(user.password_hash))
    ).toBe(true);
    expect(verifyPassword("OldTest123!", String(user.password_hash))).toBe(
      false
    );
    expect(rows(path, "SELECT * FROM app_users WHERE id=2")).toEqual(
      otherBefore
    );
    expect(rows(path, "SELECT * FROM products")).toEqual(products);
    expect(rows(path, "SELECT * FROM members")).toEqual(members);
    expect(rows(path, "SELECT id FROM app_sessions")).toEqual([
      { id: "other-session" },
    ]);
    expect(
      rows(
        result.backupPath,
        "SELECT failed_attempts FROM app_users WHERE id=1"
      )[0].failed_attempts
    ).toBe(5);
    expect(rows(result.backupPath, "SELECT id FROM app_sessions")).toHaveLength(
      2
    );
    expect(
      JSON.stringify(rows(path, "SELECT * FROM audit_logs"))
    ).not.toContain("NewPrivateTest456!");
    expect(existsSync(join(root, "BUSINESS-MUST-NOT-OPEN.sqlite"))).toBe(false);
  });
  it.each(["missing", "", "test.owner "])(
    "does not modify unknown users or weak passwords: %s",
    username => {
      const { root, path } = fixture(),
        before = rows(path, "SELECT * FROM app_users");
      expect(() => recoverLanTestAccount(root, username, "short")).toThrow();
      expect(rows(path, "SELECT * FROM app_users")).toEqual(before);
      expect(existsSync(join(root, ".lan-test/recovery-backups"))).toBe(false);
    }
  );
  it("refuses disabled users and respects developer password rules", () => {
    const { root, path } = fixture();
    const db = new DatabaseSync(path);
    db.exec("UPDATE app_users SET active=0 WHERE id=1");
    db.close();
    expect(() =>
      recoverLanTestAccount(root, "test.owner", "PrivateTest123!")
    ).toThrow(/Disabled/);
    const db2 = new DatabaseSync(path);
    db2.exec("UPDATE app_users SET active=1,role='dev' WHERE id=1");
    db2.close();
    expect(() =>
      recoverLanTestAccount(root, "test.owner", "Password12345")
    ).toThrow(/สัญลักษณ์/);
  });
  it("rolls back the password, lock state and sessions if audit insertion fails", () => {
    const { root, path } = fixture();
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER reject_recovery BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit failure'); END"
    );
    db.close();
    const users = rows(path, "SELECT * FROM app_users"),
      sessions = rows(path, "SELECT * FROM app_sessions");
    expect(() =>
      recoverLanTestAccount(root, "test.owner", "NewPrivateTest456!")
    ).toThrow(/audit failure/);
    expect(rows(path, "SELECT * FROM app_users")).toEqual(users);
    expect(rows(path, "SELECT * FROM app_sessions")).toEqual(sessions);
  });
  it("does not change credentials when the backup cannot be created", () => {
    const { root, path } = fixture();
    writeFileSync(join(root, ".lan-test/recovery-backups"), "not a directory");
    const before = rows(path, "SELECT * FROM app_users");
    expect(() =>
      recoverLanTestAccount(root, "test.owner", "NewPrivateTest456!")
    ).toThrow();
    expect(rows(path, "SELECT * FROM app_users")).toEqual(before);
  });
  it("refuses missing/invalid markers, symlinks and hard links without opening a business fallback", () => {
    const { root, path } = fixture();
    const cfg = join(root, ".lan-test/config.json"),
      original = readFileSync(cfg);
    writeFileSync(cfg, JSON.stringify({ version: 1, purpose: "business" }));
    expect(() => lanTestRecoveryPaths(root)).toThrow(/marker/);
    writeFileSync(cfg, original);
    const linked = join(root, "external.sqlite");
    linkSync(path, linked);
    expect(() => lanTestRecoveryPaths(root)).toThrow(/unlinked/);
    rmSync(linked);
    const backups = join(root, ".lan-test/recovery-backups"),
      external = join(root, "external");
    mkdirSync(external);
    symlinkSync(external, backups, "dir");
    expect(() => lanTestRecoveryPaths(root)).toThrow(/linked/);
    expect(readdirSync(external)).toEqual([]);
    const missingRoot = join(root, "missing");
    expect(() => lanTestRecoveryPaths(missingRoot)).toThrow();
    expect(existsSync(missingRoot)).toBe(false);
  });
});
