import { resolve } from "node:path";
import { requireSqliteProvider } from "./database/provider";
import { openWelfareStore, type SqliteDb } from "./sqliteStore";

let welfareDb: SqliteDb | undefined;

/**
 * Path of the welfare store SQLite file (SQLITE_DB_PATH, defaults to
 * data/welfare-store.sqlite). ROUND 38 (ข้อ 39) — extracted so the backup
 * router and auto-backup scheduler can point at the same file the lazy
 * singleton uses.
 */
export function getWelfareDbPath(): string {
  return process.env.SQLITE_DB_PATH ?? "data/welfare-store.sqlite";
}

export function getResolvedWelfareDbPath(): string {
  return resolve(getWelfareDbPath());
}

/** ROUND 38 (ข้อ 39) — โฟลเดอร์เก็บไฟล์สำรอง (SQLITE_BACKUP_DIR, defaults to data/backups). */
export function getBackupDir(): string {
  return process.env.SQLITE_BACKUP_DIR ?? "data/backups";
}

/**
 * Lazily opens the welfare store SQLite database (SQLITE_DB_PATH, defaults to
 * data/welfare-store.sqlite), applies migrations and idempotent demo seeding.
 * Lazy on purpose: tests importing the router must not touch the real file.
 */
export function getWelfareDb(): SqliteDb {
  requireSqliteProvider();
  welfareDb ??= openWelfareStore(getWelfareDbPath());
  return welfareDb;
}

/** Fail fast during startup and print enough metadata to verify Railway's volume and release. */
export function verifyWelfareDbStartup(): { path: string; transactionColumns: string[]; quickCheck: string } {
  const db = getWelfareDb();
  const transactionColumns = (db.prepare("PRAGMA table_info(member_transactions)").all() as unknown as { name: string }[])
    .map(column => column.name);
  if (!transactionColumns.includes("created_at")) {
    throw new Error("Database migration incomplete: member_transactions.created_at is missing");
  }
  const quickCheckRow = db.prepare("PRAGMA quick_check").get() as Record<string, string> | undefined;
  const quickCheck = quickCheckRow ? String(Object.values(quickCheckRow)[0]) : "unknown";
  if (quickCheck !== "ok") throw new Error(`SQLite quick_check failed: ${quickCheck}`);
  return { path: getResolvedWelfareDbPath(), transactionColumns, quickCheck };
}

/**
 * ROUND 38 (ข้อ 39) — ปิด handle ฐานข้อมูลปัจจุบัน (ใช้ก่อนกู้คืนไฟล์สำรองทับ
 * ตัวจริง) การเรียก getWelfareDb() ครั้งถัดไปจะเปิดใหม่แบบ lazy
 */
export function closeWelfareDb(): void {
  welfareDb?.close();
  welfareDb = undefined;
}
