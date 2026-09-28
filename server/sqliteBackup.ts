import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type BackupOptions = {
  sourcePath: string;
  backupDir: string;
  retentionDays?: number;
  now?: Date;
};

export type BackupManifest = {
  file: string;
  source: string;
  createdAt: string;
  sizeBytes: number;
  sha256: string;
  integrity: "ok";
};

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function timestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function assertSqliteIntegrity(filePath: string) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (row.integrity_check !== "ok") throw new Error(`SQLite integrity check failed: ${row.integrity_check}`);
  } finally {
    db.close();
  }
}

export function verifySqliteBackup(filePath: string) {
  if (!existsSync(filePath)) throw new Error(`SQLite file not found: ${filePath}`);
  assertSqliteIntegrity(filePath);
  return { ok: true as const, sha256: sha256(filePath), sizeBytes: statSync(filePath).size };
}

export function pruneSqliteBackups(backupDir: string, retentionDays: number, now = new Date()) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  if (!existsSync(backupDir)) return removed;
  for (const file of readdirSync(backupDir)) {
    if (!/^welfare-store-\d{8}T\d{6}Z\.sqlite$/.test(file)) continue;
    const filePath = join(backupDir, file);
    if (statSync(filePath).mtimeMs < cutoff) {
      unlinkSync(filePath);
      const manifestPath = `${filePath}.json`;
      if (existsSync(manifestPath)) unlinkSync(manifestPath);
      removed.push(file);
    }
  }
  return removed;
}

export function backupSqliteDatabase({ sourcePath, backupDir, retentionDays = 30, now = new Date() }: BackupOptions): BackupManifest {
  const source = resolve(sourcePath);
  const destinationDir = resolve(backupDir);
  if (!existsSync(source)) throw new Error(`SQLite source database not found: ${source}`);
  mkdirSync(destinationDir, { recursive: true });

  // Checkpoint WAL content before copying the database file.
  const sourceDb = new DatabaseSync(source);
  try { sourceDb.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { sourceDb.close(); }

  const file = nextBackupFileName(destinationDir, now);
  const destination = join(destinationDir, file);
  copyFileSync(source, destination);
  const verified = verifySqliteBackup(destination);
  const manifest: BackupManifest = {
    file,
    source,
    createdAt: now.toISOString(),
    sizeBytes: verified.sizeBytes,
    sha256: verified.sha256,
    integrity: "ok",
  };
  writeFileSync(`${destination}.json`, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  pruneSqliteBackups(destinationDir, retentionDays, now);
  return manifest;
}

/**
 * ROUND 38 (ข้อ 39) — ชื่อไฟล์สำรองได้จากวินาที ดังนั้นการสำรองสองครั้งในวินาทีเดียวกัน
 * (กดเอง + ตัวอัตโนมัติ หรือ safety backup ตอนกู้คืนที่ชนกับไฟล์ที่กำลังจะกู้คืน) ต้องไม่
 * ทับ snapshot เดิม — เลื่อนชื่อไปวินาทีถัดไปจนได้ชื่อที่ยังว่าง (สูงสุด 60 วินาที)
 */
function nextBackupFileName(destinationDir: string, now: Date) {
  let candidate = `welfare-store-${timestamp(now)}.sqlite`;
  for (let bump = 1; bump <= 60 && existsSync(join(destinationDir, candidate)); bump += 1) {
    candidate = `welfare-store-${timestamp(new Date(now.getTime() + bump * 1000))}.sqlite`;
  }
  return candidate;
}

export function restoreSqliteBackup({ backupPath, targetPath, overwrite = false }: { backupPath: string; targetPath: string; overwrite?: boolean }) {
  const source = resolve(backupPath);
  const target = resolve(targetPath);
  verifySqliteBackup(source);
  if (existsSync(target) && !overwrite) throw new Error(`Restore target already exists: ${target}. Pass overwrite=true to replace it.`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  assertSqliteIntegrity(target);
  return { target, sha256: sha256(target), sizeBytes: statSync(target).size };
}

export function readBackupManifest(backupPath: string): BackupManifest | undefined {
  const manifestPath = `${resolve(backupPath)}.json`;
  return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest : undefined;
}

// ROUND 38 (ข้อ 39) — รายการไฟล์สำรองสำหรับหน้า UI (ผู้บริหารดู/ดาวน์โหลด/กู้คืน)
export type SqliteBackupEntry = {
  file: string;
  createdAt: string;
  sizeBytes: number;
  sha256: string | null;
  integrity: "ok" | "unknown";
};

const BACKUP_FILE_PATTERN = /^welfare-store-\d{8}T\d{6}Z\.sqlite$/;

/**
 * Lists timestamped backup files in backupDir, newest first (createdAt, then
 * name). Falls back to the file mtime / unknown integrity when a .json
 * sidecar manifest is missing. A missing directory is an empty list.
 */
export function listSqliteBackups(backupDir: string): SqliteBackupEntry[] {
  const dir = resolve(backupDir);
  if (!existsSync(dir)) return [];
  const entries: SqliteBackupEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!BACKUP_FILE_PATTERN.test(file)) continue;
    const filePath = join(dir, file);
    const manifest = readBackupManifest(filePath);
    const stats = statSync(filePath);
    entries.push({
      file,
      createdAt: manifest?.createdAt ?? stats.mtime.toISOString(),
      sizeBytes: stats.size,
      sha256: manifest?.sha256 ?? null,
      integrity: manifest ? "ok" : "unknown",
    });
  }
  entries.sort((a, b) => (a.createdAt === b.createdAt ? b.file.localeCompare(a.file) : b.createdAt.localeCompare(a.createdAt)));
  return entries;
}

/**
 * ROUND 38 (ข้อ 39) — เก็บไฟล์สำรองใหม่สุด keepCount ไฟล์ ลบที่เหลือพร้อม
 * manifest (.json) ข้าง ๆ · คืนรายชื่อไฟล์ที่ลบ (keepCount < 1 ถือเป็น 1)
 */
export function pruneSqliteBackupsByCount(backupDir: string, keepCount: number): string[] {
  const keep = Math.max(1, Math.floor(keepCount));
  const dir = resolve(backupDir);
  const removed: string[] = [];
  for (const entry of listSqliteBackups(dir).slice(keep)) {
    unlinkSync(join(dir, entry.file));
    const manifestPath = join(dir, `${entry.file}.json`);
    if (existsSync(manifestPath)) unlinkSync(manifestPath);
    removed.push(entry.file);
  }
  return removed;
}
