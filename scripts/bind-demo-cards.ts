import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createSqliteStore, bindExistingMembersToDemoCards } from "../server/sqliteStore";

// Explicit one-off demo preparation only; never part of startup or migrations.
const target = path.resolve(process.env.SQLITE_DB_PATH ?? "data/welfare-store.sqlite");
if (!process.argv.includes("--apply")) throw new Error("Pass --apply to prepare the current database for demo cards");
if (!fs.existsSync(target)) throw new Error(`Database not found: ${target}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(path.dirname(target), "backups", `before-demo-cards-${stamp}.sqlite`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
const source = new DatabaseSync(target);
await backup(source, destination);
source.close();
const verified = new DatabaseSync(destination, { readOnly: true });
assert.equal(Object.values(verified.prepare("PRAGMA integrity_check").get()!)[0], "ok");
verified.close();
const db = createSqliteStore(target);
try {
  const members = () => db.prepare("SELECT member_number, balance FROM members ORDER BY member_number").all();
  const ledger = () => db.prepare("SELECT * FROM member_transactions ORDER BY id").all();
  const beforeMembers = members();
  const beforeLedger = ledger();
  const mappings = bindExistingMembersToDemoCards(db, "เตรียมชุดเดโมตามคำสั่งเจ้าของระบบ");
  assert.deepEqual(members(), beforeMembers);
  assert.deepEqual(ledger(), beforeLedger);
  assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get()!)[0], "ok");
  fs.writeFileSync(destination + ".mapping.json", JSON.stringify({ target, backup: destination, mappings }, null, 2));
  console.log(JSON.stringify({ backup: destination, reassigned: mappings.length, preservedMembersAndLedger: true }, null, 2));
} finally { db.close(); }