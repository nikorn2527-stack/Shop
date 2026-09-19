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
  welfareDb ??= openWelfareStore(getWelfareDbPath());
  return welfareDb;
}

/**
 * ROUND 38 (ข้อ 39) — ปิด handle ฐานข้อมูลปัจจุบัน (ใช้ก่อนกู้คืนไฟล์สำรองทับ
 * ตัวจริง) การเรียก getWelfareDb() ครั้งถัดไปจะเปิดใหม่แบบ lazy
 */
export function closeWelfareDb(): void {
  welfareDb?.close();
  welfareDb = undefined;
}
