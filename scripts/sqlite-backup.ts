import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createSqliteStore } from "../server/sqliteStore";
import { backupSqliteDatabase, restoreSqliteBackup, verifySqliteBackup } from "../server/sqliteBackup";

const sourcePath = resolve(process.env.SQLITE_DB_PATH ?? "data/welfare-store.sqlite");
const backupDir = resolve(process.env.SQLITE_BACKUP_DIR ?? "data/backups");
const retentionDays = Number(process.env.SQLITE_BACKUP_RETENTION_DAYS ?? 30);
const [command, firstArg, secondArg] = process.argv.slice(2);

if (command === "backup") {
  if (!existsSync(sourcePath)) {
    mkdirSync(dirname(sourcePath), { recursive: true });
    const db = createSqliteStore(sourcePath);
    db.close();
    console.log(`Initialized empty SQLite database at ${sourcePath}`);
  }
  const manifest = backupSqliteDatabase({ sourcePath, backupDir, retentionDays });
  console.log(JSON.stringify(manifest, null, 2));
} else if (command === "verify") {
  const result = verifySqliteBackup(resolve(firstArg ?? sourcePath));
  console.log(JSON.stringify(result, null, 2));
} else if (command === "restore") {
  if (!firstArg) throw new Error("Usage: restore <backup-file> [target-file]");
  const target = resolve(secondArg ?? sourcePath);
  const result = restoreSqliteBackup({ backupPath: resolve(firstArg), targetPath: target, overwrite: process.argv.includes("--overwrite") });
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Usage:\n  backup   Create and verify a timestamped backup\n  verify   Verify a SQLite backup file\n  restore  Restore a backup; add --overwrite to replace an existing target\n\nEnvironment:\n  SQLITE_DB_PATH=${sourcePath}\n  SQLITE_BACKUP_DIR=${backupDir}\n  SQLITE_BACKUP_RETENTION_DAYS=${retentionDays}`);
}
