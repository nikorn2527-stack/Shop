import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type SqliteDb = InstanceType<typeof DatabaseSync>;

export type SqliteMember = {
  id: number;
  memberNumber: string;
  firstName: string;
  lastName: string;
  idCard: string | null;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
};

export type SqliteTransaction = {
  id: number;
  memberNumber: string;
  type: "purchase" | "deposit" | "withdrawal";
  detail: string;
  amount: number;
  paymentMethod: string | null;
  createdAt: string;
};

/**
 * Lightweight SQLite adapter for local feature testing.
 * Uses Node 22's built-in node:sqlite, so a cloned project needs no native binary build.
 * Production auth/runtime remains on the template's configured database.
 */
export function createSqliteStore(filename = ":memory:"): SqliteDb {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_number TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      id_card TEXT,
      balance REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS member_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_number TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('purchase', 'deposit', 'withdrawal')),
      detail TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_number) REFERENCES members(member_number)
    );
    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function seedSqliteDemoData(db: SqliteDb) {
  const insertMember = db.prepare(`INSERT OR IGNORE INTO members (member_number, first_name, last_name, id_card, balance, status) VALUES (?, ?, ?, ?, ?, ?)`);
  insertMember.run("M-000218", "อรทัย", "ส.", null, 1240, "active");
  insertMember.run("M-000092", "พิมพ์ชนก", "ร.", null, 0, "suspended");
  const insertTransaction = db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  insertTransaction.run("M-000218", "purchase", "บิล #INV-260917-038 · น้ำดื่ม 2 ขวด, ข้าวกล่อง 1 กล่อง", -59, "member_balance", "2026-09-17 14:38:00");
  insertTransaction.run("M-000218", "deposit", "ผู้ฝาก: น.ส.กัญญาณัฐ พ.", 500, "cash", "2026-09-17 14:32:00");
  insertTransaction.run("M-000218", "withdrawal", "ถอนเพื่อถอนฟัน", -200, "cash", "2026-09-12 10:16:00");
  insertTransaction.run("M-000092", "withdrawal", "ถอนเพื่อถอนฟัน · แนบหลักฐานแล้ว", -200, "cash", "2026-09-16 09:12:00");
}

export function getMemberDetail(db: SqliteDb, memberNumber: string) {
  const member = db.prepare(`SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, balance, status, created_at as createdAt FROM members WHERE member_number = ?`).get(memberNumber) as SqliteMember | undefined;
  if (!member) return undefined;
  const transactions = db.prepare(`SELECT id, member_number as memberNumber, type, detail, amount, payment_method as paymentMethod, created_at as createdAt FROM member_transactions WHERE member_number = ? ORDER BY created_at DESC, id DESC`).all(memberNumber) as unknown as SqliteTransaction[];
  return { member, transactions };
}

export function setMemberNumberMode(db: SqliteDb, mode: "running" | "year" | "manual") {
  db.prepare(`INSERT INTO store_settings (key, value) VALUES ('member_number_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(mode);
}

export function getMemberNumberMode(db: SqliteDb) {
  const row = db.prepare(`SELECT value FROM store_settings WHERE key = 'member_number_mode'`).get() as { value: "running" | "year" | "manual" } | undefined;
  return row?.value ?? "running";
}

export function suspendMember(db: SqliteDb, memberNumber: string) {
  const result = db.prepare(`UPDATE members SET status = 'suspended' WHERE member_number = ?`).run(memberNumber);
  return result.changes > 0;
}
