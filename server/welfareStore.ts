import { openWelfareStore, type SqliteDb } from "./sqliteStore";

let welfareDb: SqliteDb | undefined;

/**
 * Lazily opens the welfare store SQLite database (SQLITE_DB_PATH, defaults to
 * data/welfare-store.sqlite), applies migrations and idempotent demo seeding.
 * Lazy on purpose: tests importing the router must not touch the real file.
 */
export function getWelfareDb(): SqliteDb {
  welfareDb ??= openWelfareStore();
  return welfareDb;
}
