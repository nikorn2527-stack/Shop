import { createHash, scryptSync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

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
  /** P3 — true when the on-disk backup is AES-256-GCM encrypted (.sqlite.enc). */
  encrypted?: boolean;
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

// P3 — Optional AES-256-GCM backup encryption. Activated only when
// BACKUP_ENCRYPTION_KEY (>= 32 chars) is set in the environment. Encrypted
// backups use the .sqlite.enc extension; restore auto-detects via extension
// so the same code path works for encrypted and plain backups. Without the
// env var the entire pipeline behaves exactly as before (backward compatible).
const ENCRYPTION_SALT = "png-shop-backup-salt";
const ENC_IV_BYTES = 12;   // 96-bit GCM IV
const ENC_TAG_BYTES = 16;  // 128-bit GCM auth tag

/** Returns a 32-byte AES-256 key derived from BACKUP_ENCRYPTION_KEY, or null when unset/short. */
function getEncryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) return null;
  return scryptSync(raw, ENCRYPTION_SALT, 32);
}

function isEncryptedFile(filePath: string): boolean {
  return filePath.endsWith(".enc");
}

/**
 * Encrypts a plain SQLite backup with AES-256-GCM. Writes `<plainPath>.enc`
 * (format: [12-byte IV][16-byte auth tag][ciphertext]), deletes the plain
 * file so only the encrypted form remains on disk, and returns the .enc path.
 */
function encryptBackup(plainPath: string): string {
  const key = getEncryptionKey();
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY is not set — cannot encrypt backup");
  const iv = randomBytes(ENC_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = readFileSync(plainPath);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encPath = `${plainPath}.enc`;
  writeFileSync(encPath, Buffer.concat([iv, tag, ciphertext]));
  unlinkSync(plainPath);
  return encPath;
}

/**
 * Decrypts a .enc backup to a temp .sqlite file and returns the temp path.
 * Caller is responsible for cleaning up the temp file (rmSync with force).
 */
function decryptBackup(encPath: string): string {
  const key = getEncryptionKey();
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY is not set — cannot decrypt encrypted backup");
  const data = readFileSync(encPath);
  if (data.byteLength < ENC_IV_BYTES + ENC_TAG_BYTES) {
    throw new Error("Encrypted backup file is corrupted (too small to contain IV + auth tag)");
  }
  const iv = data.subarray(0, ENC_IV_BYTES);
  const tag = data.subarray(ENC_IV_BYTES, ENC_IV_BYTES + ENC_TAG_BYTES);
  const ciphertext = data.subarray(ENC_IV_BYTES + ENC_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new Error(`Failed to decrypt backup (wrong key or corrupted file): ${error instanceof Error ? error.message : String(error)}`);
  }
  const tempPath = join(tmpdir(), `.backup-decrypt-${Date.now()}-${randomBytes(4).toString("hex")}.sqlite`);
  writeFileSync(tempPath, plain);
  return tempPath;
}

export function verifySqliteBackup(filePath: string) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) throw new Error(`SQLite file not found: ${resolved}`);
  // Encrypted backups must be decrypted to a temp file before SQLite can
  // integrity-check them. The returned sha256/sizeBytes still describe the
  // on-disk backup file (.enc) so the manifest's hash stays meaningful for
  // verifying the bytes that are actually stored on disk.
  if (isEncryptedFile(resolved)) {
    const tempPath = decryptBackup(resolved);
    try {
      assertSqliteIntegrity(tempPath);
    } finally {
      rmSync(tempPath, { force: true });
    }
    return { ok: true as const, sha256: sha256(resolved), sizeBytes: statSync(resolved).size };
  }
  assertSqliteIntegrity(resolved);
  return { ok: true as const, sha256: sha256(resolved), sizeBytes: statSync(resolved).size };
}

export function pruneSqliteBackups(backupDir: string, retentionDays: number, now = new Date()) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  if (!existsSync(backupDir)) return removed;
  for (const file of readdirSync(backupDir)) {
    if (!BACKUP_FILE_PATTERN.test(file)) continue;
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
  // Verify the plain SQLite copy (still unencrypted at this point).
  verifySqliteBackup(destination);

  // P3 — if an encryption key is configured, replace the plain .sqlite with
  // an encrypted .sqlite.enc on disk and record the flag in the manifest.
  let finalPath = destination;
  let finalFile = file;
  let encrypted = false;
  if (getEncryptionKey()) {
    finalPath = encryptBackup(destination);
    finalFile = `${file}.enc`;
    encrypted = true;
  }

  const manifest: BackupManifest = {
    file: finalFile,
    source,
    createdAt: now.toISOString(),
    sizeBytes: statSync(finalPath).size,
    sha256: sha256(finalPath),
    integrity: "ok",
    encrypted,
  };
  writeFileSync(`${finalPath}.json`, JSON.stringify(manifest, null, 2) + "\n", "utf8");
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
  // P3 — also avoid colliding with an encrypted .sqlite.enc from the same second.
  for (let bump = 1; bump <= 60 && (existsSync(join(destinationDir, candidate)) || existsSync(join(destinationDir, `${candidate}.enc`))); bump += 1) {
    candidate = `welfare-store-${timestamp(new Date(now.getTime() + bump * 1000))}.sqlite`;
  }
  return candidate;
}

export function restoreSqliteBackup({ backupPath, targetPath, overwrite = false }: { backupPath: string; targetPath: string; overwrite?: boolean }) {
  const source = resolve(backupPath);
  const target = resolve(targetPath);
  if (!existsSync(source)) throw new Error(`SQLite file not found: ${source}`);
  if (existsSync(target) && !overwrite) throw new Error(`Restore target already exists: ${target}. Pass overwrite=true to replace it.`);
  mkdirSync(dirname(target), { recursive: true });

  // P3 — encrypted backups: decrypt to a temp file, verify the temp, then copy
  // temp → target. Plain backups keep the original copy-then-verify flow.
  let tempPath: string | null = null;
  let copySource: string;
  try {
    if (isEncryptedFile(source)) {
      tempPath = decryptBackup(source);
      assertSqliteIntegrity(tempPath);
      copySource = tempPath;
    } else {
      assertSqliteIntegrity(source);
      copySource = source;
    }
    copyFileSync(copySource, target);
  } finally {
    if (tempPath) rmSync(tempPath, { force: true });
  }
  assertSqliteIntegrity(target);
  return { target, sha256: sha256(target), sizeBytes: statSync(target).size };
}

/**
 * P3 — Restore drill: opens a backup read-only (decrypting first if needed),
 * runs PRAGMA integrity_check, lists the tables, and counts rows in the key
 * business tables (products, members, sales, sale_items). The temp decrypted
 * file (if any) is cleaned up. Nothing is written to the live database.
 */
export function testRestore(backupPath: string): { ok: true; tables: string[]; rowCount: number } {
  const source = resolve(backupPath);
  if (!existsSync(source)) throw new Error(`Backup file not found: ${source}`);

  let tempPath: string | null = null;
  let dbPath: string;
  try {
    if (isEncryptedFile(source)) {
      tempPath = decryptBackup(source);
      dbPath = tempPath;
    } else {
      dbPath = source;
    }

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const integrityRow = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (integrityRow.integrity_check !== "ok") {
        throw new Error(`SQLite integrity check failed: ${integrityRow.integrity_check}`);
      }
      const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
      const tables = tableRows.map((row) => row.name);

      let rowCount = 0;
      for (const table of ["products", "members", "sales", "sale_items"]) {
        if (!tables.includes(table)) continue;
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
        rowCount += Number(row.n);
      }
      return { ok: true as const, tables, rowCount };
    } finally {
      db.close();
    }
  } finally {
    if (tempPath) rmSync(tempPath, { force: true });
  }
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

// P3 — pattern now also matches encrypted .sqlite.enc backups alongside plain .sqlite.
const BACKUP_FILE_PATTERN = /^welfare-store-\d{8}T\d{6}Z\.sqlite(\.enc)?$/;

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
