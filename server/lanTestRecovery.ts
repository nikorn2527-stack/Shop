import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
import { existsSync, lstatSync, readFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { backupSqliteDatabase } from "./sqliteBackup";
import {
  formatDateTime,
  hashPassword,
  validatePasswordStrength,
} from "./sqliteStore";
import type { AppUserRole } from "../shared/storeTypes/access";

/** Local filesystem-owner recovery for the isolated LAN fixture only. Never routed over HTTP. */
export function lanTestRecoveryPaths(projectRoot: string) {
  const folder = resolve(projectRoot, ".lan-test"),
    database = join(folder, "store.sqlite"),
    configPath = join(folder, "config.json");
  for (const path of [
    folder,
    database,
    configPath,
    database + "-wal",
    database + "-shm",
    database + "-journal",
    join(folder, "recovery-backups"),
  ]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw new Error("Refusing linked LAN test paths");
  }
  if (
    !existsSync(database) ||
    !existsSync(configPath) ||
    !lstatSync(database).isFile() ||
    lstatSync(database).nlink !== 1
  )
    throw new Error(
      "An existing, unlinked LAN test database and config are required; no database was created"
    );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    config.version !== 1 ||
    config.purpose !== "shop-lan-test" ||
    typeof config.secret !== "string" ||
    config.secret.length < 32 ||
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error("Invalid LAN test marker; no account was changed");
  return { folder, database, port: config.port as number };
}

export function recoverLanTestAccount(
  projectRoot: string,
  username: string,
  password: string
) {
  const paths = lanTestRecoveryPaths(projectRoot);
  if (!username.trim()) throw new Error("Username is required");
  const db = new DatabaseSync(paths.database);
  try {
    const users = db
      .prepare(
        "SELECT id, role, active FROM app_users WHERE LOWER(username) = LOWER(?)"
      )
      .all(username.trim()) as {
      id: number;
      role: AppUserRole;
      active: number;
    }[];
    if (users.length !== 1)
      throw new Error("Expected exactly one matching test account");
    const user = users[0];
    if (user.active !== 1)
      throw new Error(
        "Disabled accounts cannot be recovered by this test tool"
      );
    if (password.length > 256)
      throw new Error("Password must not exceed 256 characters");
    const issues = validatePasswordStrength(password, user.role);
    if (issues.length) throw new Error(issues.join(" · "));
    const passwordHash = hashPassword(password);
    const backupDir = join(paths.folder, "recovery-backups", randomUUID());
    const backup = backupSqliteDatabase({
      sourcePath: paths.database,
      backupDir,
    });
    chmodSync(backupDir, 0o700);
    chmodSync(join(backupDir, backup.file), 0o600);
    chmodSync(join(backupDir, backup.file + ".json"), 0o600);
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "UPDATE app_users SET password_hash=?, failed_attempts=0, locked_until=NULL, must_change_password=0 WHERE id=? AND active=1 AND role=?"
        )
        .run(passwordHash, user.id, user.role);
      if (Number(result.changes) !== 1)
        throw new Error("Account changed during recovery; nothing committed");
      db.prepare("DELETE FROM app_sessions WHERE user_id=?").run(user.id);
      db.prepare(
        "INSERT INTO audit_logs (action,actor,actor_role,detail,tone,created_at) VALUES (?,?,?,?,?,?)"
      ).run(
        "กู้บัญชีทดสอบ",
        "Local LAN test recovery",
        "ผู้ดูแลเครื่องทดสอบ",
        "ตั้งรหัสผ่านใหม่ ปลดล็อก และออกจากระบบทุกอุปกรณ์ เฉพาะบัญชีทดสอบที่เลือก",
        "amber",
        formatDateTime()
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { backupPath: join(backupDir, backup.file) };
  } finally {
    db.close();
  }
}
