import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { backupSqliteDatabase, listSqliteBackups, pruneSqliteBackups, pruneSqliteBackupsByCount, readBackupManifest, restoreSqliteBackup, verifySqliteBackup } from "./sqliteBackup";
import { createSqliteStore, seedSqliteDemoData } from "./sqliteStore";
import { appRouter } from "./routers";
import { closeWelfareDb, getWelfareDb } from "./welfareStore";
import type { TrpcContext } from "./_core/context";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

let workDir = "";

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = "";
});

describe("SQLite backups", () => {
  it("includes committed WAL rows when a reader prevents checkpointing and restores the complete snapshot", () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-backup-wal-"));
    const sourcePath = join(workDir, "store.sqlite");
    const backupDir = join(workDir, "backups");
    const writer = createSqliteStore(sourcePath);
    seedSqliteDemoData(writer);
    writer.exec("PRAGMA journal_mode=WAL");
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const reader = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      reader.exec("BEGIN");
      expect(reader.prepare("SELECT COUNT(*) AS n FROM members").get()).toMatchObject({ n: 2 });
      writer.prepare("INSERT INTO members (member_number, first_name, last_name, balance, status) VALUES (?, ?, ?, ?, ?)")
        .run("WAL-COMMITTED", "Committed", "After reader", 123.45, "active");
      expect(writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()).toMatchObject({ busy: 1 });

      const manifest = backupSqliteDatabase({ sourcePath, backupDir });
      const backupPath = join(backupDir, manifest.file);
      expect(manifest.integrity).toBe("ok");
      const restoredPath = join(workDir, "restored.sqlite");
      restoreSqliteBackup({ backupPath, targetPath: restoredPath });
      const restored = new DatabaseSync(restoredPath, { readOnly: true });
      try {
        expect(restored.prepare("SELECT COUNT(*) AS n FROM members").get()).toMatchObject({ n: 3 });
        expect(restored.prepare("SELECT balance FROM members WHERE member_number = ?").get("WAL-COMMITTED")).toMatchObject({ balance: 123.45 });
        expect(restored.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
        expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { restored.close(); }
      // The backup must not alter the live reader's snapshot or source rows.
      expect(reader.prepare("SELECT COUNT(*) AS n FROM members").get()).toMatchObject({ n: 2 });
      expect(writer.prepare("SELECT COUNT(*) AS n FROM members").get()).toMatchObject({ n: 3 });
    } finally {
      reader.exec("ROLLBACK");
      reader.close();
      writer.close();
    }
  });

  it("creates a verified backup with a manifest and restores it", () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-backup-"));
    const sourcePath = join(workDir, "store.sqlite");
    const backupDir = join(workDir, "backups");
    const db = createSqliteStore(sourcePath);
    seedSqliteDemoData(db);
    db.close();

    const manifest = backupSqliteDatabase({ sourcePath, backupDir, now: new Date("2026-09-17T20:00:00.000Z") });
    const backupPath = join(backupDir, manifest.file);
    expect(manifest.integrity).toBe("ok");
    expect(verifySqliteBackup(backupPath).sha256).toBe(manifest.sha256);
    expect(readBackupManifest(backupPath)?.file).toBe(manifest.file);

    const restoredPath = join(workDir, "restored.sqlite");
    expect(restoreSqliteBackup({ backupPath, targetPath: restoredPath }).sizeBytes).toBeGreaterThan(0);
    expect(existsSync(restoredPath)).toBe(true);
  });

  it("prunes only timestamped backup files older than the retention window", () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-retention-"));
    const oldPath = join(workDir, "welfare-store-20260101T020000Z.sqlite");
    const keepPath = join(workDir, "welfare-store-20260917T020000Z.sqlite");
    const unrelatedPath = join(workDir, "notes.txt");
    const db = createSqliteStore(oldPath);
    db.close();
    const keepDb = createSqliteStore(keepPath);
    keepDb.close();
    writeFileSync(unrelatedPath, "keep");
    const oldDate = new Date("2026-01-01T02:00:00.000Z");
    utimesSync(oldPath, oldDate, oldDate);

    const removed = pruneSqliteBackups(workDir, 30, new Date("2026-09-17T02:00:00.000Z"));
    expect(removed).toEqual(["welfare-store-20260101T020000Z.sqlite"]);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(keepPath)).toBe(true);
    expect(existsSync(unrelatedPath)).toBe(true);
  });

  // ROUND 38 (ข้อ 39) — listSqliteBackups: เรียงใหม่สุดก่อน พร้อมข้อมูลจาก manifest
  it("lists backups newest-first with manifest data (missing dir → empty)", () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-list-"));
    const sourcePath = join(workDir, "store.sqlite");
    const backupDir = join(workDir, "backups");
    const db = createSqliteStore(sourcePath);
    seedSqliteDemoData(db);
    db.close();

    expect(listSqliteBackups(join(workDir, "missing-dir"))).toEqual([]);

    const older = backupSqliteDatabase({ sourcePath, backupDir, now: new Date("2026-09-10T02:00:00.000Z") });
    const newer = backupSqliteDatabase({ sourcePath, backupDir, now: new Date("2026-09-12T02:00:00.000Z") });
    writeFileSync(join(backupDir, "unrelated.txt"), "ignore me");

    const backups = listSqliteBackups(backupDir);
    expect(backups.map((entry) => entry.file)).toEqual([newer.file, older.file]);
    expect(backups[0].createdAt).toBe("2026-09-12T02:00:00.000Z");
    expect(backups[0].sha256).toBe(newer.sha256);
    expect(backups[0].sizeBytes).toBeGreaterThan(0);
    expect(backups[0].integrity).toBe("ok");

    // ไฟล์สำรองที่ manifest หาย → ใช้ mtime + integrity "unknown" + sha256 null
    rmSync(join(backupDir, `${older.file}.json`));
    const fallback = listSqliteBackups(backupDir);
    expect(fallback).toHaveLength(2);
    const fallbackOld = fallback.find((entry) => entry.file === older.file);
    expect(fallbackOld?.integrity).toBe("unknown");
    expect(fallbackOld?.sha256).toBeNull();
    expect(fallbackOld?.createdAt).toBe(statSync(join(backupDir, older.file)).mtime.toISOString());
  });

  // ROUND 38 (ข้อ 39) — pruneSqliteBackupsByCount: เก็บใหม่สุด N ไฟล์ ลบเก่าพร้อม manifest
  it("pruneSqliteBackupsByCount keeps the newest N backups and removes older files + manifests", () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-keepcount-"));
    const sourcePath = join(workDir, "store.sqlite");
    const backupDir = join(workDir, "backups");
    const db = createSqliteStore(sourcePath);
    db.close();

    const files = ["11", "12", "13", "14"].map((day) =>
      backupSqliteDatabase({ sourcePath, backupDir, now: new Date(`2026-09-${day}T02:00:00.000Z`) }).file,
    );

    const removed = pruneSqliteBackupsByCount(backupDir, 2);
    // เรียงตามลำดับใน list (ใหม่สุดก่อน) — ตัวที่โดนลบคือ 2 ไฟล์เก่าสุด (09-12 ก่อน 09-11)
    expect(removed).toEqual([files[1], files[0]]);
    expect(listSqliteBackups(backupDir).map((entry) => entry.file)).toEqual([files[3], files[2]]);
    expect(existsSync(join(backupDir, files[0]))).toBe(false);
    expect(existsSync(join(backupDir, `${files[0]}.json`))).toBe(false);
    expect(existsSync(join(backupDir, files[2]))).toBe(true);

    // keepCount < 1 ถือเป็น 1 — เหลือไฟล์ใหม่สุดไฟล์เดียว
    expect(pruneSqliteBackupsByCount(backupDir, 0)).toEqual([files[2]]);
    expect(listSqliteBackups(backupDir).map((entry) => entry.file)).toEqual([files[3]]);
  });

  // ROUND 38 (ข้อ 39) — วงจรกู้คืนเต็มรูปแบบ: สำรอง → แก้ข้อมูล → กู้คืนทับ → เปิดใหม่ได้ข้อมูลเดิม
  it("restore cycle: backup, mutate, restore over the live file, reopen — old data is back", () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-restore-cycle-"));
    const sourcePath = join(workDir, "store.sqlite");
    const backupDir = join(workDir, "backups");
    const db = createSqliteStore(sourcePath);
    seedSqliteDemoData(db);
    db.close();

    const manifest = backupSqliteDatabase({ sourcePath, backupDir, now: new Date("2026-09-18T02:00:00.000Z") });

    // กลางวัน: เพิ่มสมาชิกใหม่เข้าไป (ข้อมูลเปลี่ยน)
    const mutate = createSqliteStore(sourcePath);
    mutate
      .prepare(`INSERT INTO members (member_number, first_name, last_name, balance, status) VALUES (?, ?, ?, ?, ?)`)
      .run("M-999999", "ทดสอบ", "กู้คืน", 555, "active");
    expect(memberCount(mutate)).toBe(3);
    mutate.close();

    // กู้คืนไฟล์สำรองทับตัวจริง (เหมือน backup.restore ใน router)
    restoreSqliteBackup({ backupPath: join(backupDir, manifest.file), targetPath: sourcePath, overwrite: true });

    const reopened = createSqliteStore(sourcePath);
    expect(memberCount(reopened)).toBe(2);
    expect(
      (reopened.prepare(`SELECT COUNT(*) AS count FROM members WHERE member_number = ?`).get("M-999999") as { count: number }).count,
    ).toBe(0);
    reopened.close();
  });

  function memberCount(database: ReturnType<typeof createSqliteStore>) {
    return (database.prepare(`SELECT COUNT(*) AS count FROM members`).get() as { count: number }).count;
  }
});

/** Admin session context for calling backup.* through the real tRPC router. */
function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "backup-tester",
      email: "backup@example.com",
      name: "ผู้ทดสอบสำรองข้อมูล",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

// ROUND 38 (ข้อ 39) — ทดสอบ router จริงผ่าน tRPC caller: ชี้ SQLITE_DB_PATH /
// SQLITE_BACKUP_DIR ไปที่ temp เพื่อไม่แตะฐานข้อมูลร้านจริง แล้ววิ่งเต็มวงจร
// create → list → download → restore (safety backup + audit สีแดง + เปิดใหม่ lazy)
describe("backup router (admin, end-to-end on temp files)", () => {
  it("create, list, download and restore through the tRPC caller", async () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-router-backup-"));
    const backupDir = join(workDir, "router-backups");
    const prevDbPath = process.env.SQLITE_DB_PATH;
    const prevBackupDir = process.env.SQLITE_BACKUP_DIR;
    process.env.SQLITE_DB_PATH = join(workDir, "router-store.sqlite");
    process.env.SQLITE_BACKUP_DIR = backupDir;
    try {
      const caller = appRouter.createCaller(createAdminContext());
      // ROUND 61 — สำรอง–กู้คืนเป็นฟีเจอร์เวอร์ชันโปรขึ้นไป: เริ่มทดลองใช้ผ่าน router จริงก่อนทดสอบ
      await caller.edition.startTrial();

      // สำรองด้วยตนเอง — เปิด db เปล่า (seed) สำรอง แล้วได้ manifest + keepCount กลับมา
      const created = await caller.backup.create();
      expect(created.integrity).toBe("ok");
      expect(created.keepCount).toBe(14);
      expect(created.sizeBytes).toBeGreaterThan(0);
      expect(existsSync(join(backupDir, created.file))).toBe(true);
      const firstBackupFile = created.file;

      // หลังสำรอง: มีข้อมูลเปลี่ยน (เพิ่มสมาชิกใหม่ผ่าน handle เดียวกับ router)
      const db = getWelfareDb();
      db.prepare(`INSERT INTO members (member_number, first_name, last_name, balance, status) VALUES (?, ?, ?, ?, ?)`)
        .run("M-777777", "ตัว", "ทดสอบ", 99, "active");

      // รายการ: ไฟล์ใหม่สุดขึ้นก่อน + ค่าตั้งจาก settings (default)
      const list = await caller.backup.list(undefined);
      expect(list.backups[0]?.file).toBe(firstBackupFile);
      expect(list.backups[0]?.integrity).toBe("ok");
      expect(list.keepCount).toBe(14);
      expect(list.autoEnabled).toBe(true);
      expect(list.intervalHours).toBe(24);

      // ดาวน์โหลด: ได้ base64 ขนาดตรงกับไฟล์จริง
      const download = await caller.backup.download({ file: firstBackupFile });
      expect(download.file).toBe(firstBackupFile);
      expect(download.sizeBytes).toBe(created.sizeBytes);
      expect(download.base64.length).toBeGreaterThan(0);

      // กู้คืน: สำรองไฟล์ป้องกันไว้ก่อน → ข้อมูลย้อนกลับ → audit สีแดง
      const restored = await caller.backup.restore({ file: firstBackupFile });
      expect(restored.ok).toBe(true);
      expect(restored.safetyBackupFile).not.toBe(firstBackupFile);
      expect(existsSync(join(backupDir, restored.safetyBackupFile))).toBe(true);
      const after = getWelfareDb();
      expect(
        (after.prepare(`SELECT COUNT(*) AS count FROM members WHERE member_number = ?`).get("M-777777") as { count: number }).count,
      ).toBe(0);
      const restoreLog = after.prepare(`SELECT action, tone, detail FROM audit_logs WHERE action = 'กู้คืนข้อมูล' ORDER BY id DESC LIMIT 1`).get() as { action: string; tone: string; detail: string };
      expect(restoreLog.tone).toBe("red");
      expect(restoreLog.detail).toContain(firstBackupFile);
      // ไฟล์สำรองที่กู้คืนยังอยู่ + safety backup เป็นไฟล์ล่าสุดในรายการ
      expect(listSqliteBackups(backupDir)[0]?.file).toBe(restored.safetyBackupFile);
    } finally {
      closeWelfareDb();
      if (prevDbPath === undefined) delete process.env.SQLITE_DB_PATH;
      else process.env.SQLITE_DB_PATH = prevDbPath;
      if (prevBackupDir === undefined) delete process.env.SQLITE_BACKUP_DIR;
      else process.env.SQLITE_BACKUP_DIR = prevBackupDir;
    }
  });

  it("rejects non-admin callers and malformed backup filenames", async () => {
    workDir = mkdtempSync(join(tmpdir(), "png-shop-router-guard-"));
    process.env.SQLITE_DB_PATH = join(workDir, "guard-store.sqlite");
    process.env.SQLITE_BACKUP_DIR = join(workDir, "guard-backups");
    try {
      const anonymous = appRouter.createCaller({
        user: null,
        req: { protocol: "https", headers: {} } as TrpcContext["req"],
        res: { clearCookie: () => {} } as TrpcContext["res"],
      });
      await expect(anonymous.backup.create()).rejects.toThrow("การสำรองข้อมูลต้องใช้สิทธิ์ผู้บริหาร");

      const caller = appRouter.createCaller(createAdminContext());
      // ROUND 61 — เปิดสิทธิ์สำรองข้อมูลด้วยการเริ่มทดลองใช้ (ผ่าน router จริง)
      await caller.edition.startTrial();
      // ชื่อไฟล์นอกรูปแบบ welfare-store-YYYYMMDDTHHMMSSZ.sqlite โดน zod ปฏิเสธ (กัน path traversal)
      await expect(caller.backup.download({ file: "../welfare-store.sqlite" })).rejects.toThrow();
      await expect(caller.backup.download({ file: "welfare-store-19990101T000000Z.sqlite" })).rejects.toThrow("ไม่พบไฟล์สำรอง");
    } finally {
      closeWelfareDb();
      delete process.env.SQLITE_DB_PATH;
      delete process.env.SQLITE_BACKUP_DIR;
    }
  });
});
