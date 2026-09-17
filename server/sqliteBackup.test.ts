import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backupSqliteDatabase, pruneSqliteBackups, readBackupManifest, restoreSqliteBackup, verifySqliteBackup } from "./sqliteBackup";
import { createSqliteStore, seedSqliteDemoData } from "./sqliteStore";

let workDir = "";

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = "";
});

describe("SQLite backups", () => {
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
});
