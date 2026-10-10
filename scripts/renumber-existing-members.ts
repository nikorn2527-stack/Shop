import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createSqliteStore, generateMemberNumber, getMemberNumberMode } from "../server/sqliteStore";

// Explicit maintenance operation; never run during application startup.
const target = path.resolve(process.env.SQLITE_DB_PATH ?? "data/welfare-store.sqlite");
if (!process.argv.includes("--apply")) throw new Error("Requires --apply and an offline application server");
if (!fs.existsSync(target)) throw new Error("Database does not exist");
const destination = path.join(path.dirname(target), "backups", `before-member-renumber-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
const source = new DatabaseSync(target);
await backup(source, destination);
source.close();
const db = createSqliteStore(target);
try {
  const mode = getMemberNumberMode(db);
  if (mode === "manual") throw new Error("Manual numbering requires an explicit member mapping; no changes applied");
  const before = db.prepare("SELECT * FROM members ORDER BY id").all();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const references = tables.flatMap(({ name }) => {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string }[];
    return columns.filter(c => c.name === "member_number" || c.name === "assigned_member_number")
      .map(c => ({ table: name, column: c.name }));
  });
  const snapshots = new Map(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all()]));
  const mappings: { id: number; previous: string; temporary: string; current: string }[] = [];
  db.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON;");
  try {
    const replace = (from: string, to: string) => {
      for (const ref of references) db.prepare(`UPDATE ${quote(ref.table)} SET ${quote(ref.column)} = ? WHERE ${quote(ref.column)} = ?`).run(to, from);
    };
    for (const row of before) {
      const temporary = `__renumber_${row.id}_${Date.now()}`;
      replace(String(row.member_number), temporary);
      mappings.push({ id: Number(row.id), previous: String(row.member_number), temporary, current: "" });
    }
    for (const mapping of mappings) {
      mapping.current = generateMemberNumber(db, mode);
      replace(mapping.temporary, mapping.current);
    }
    assert.equal(new Set(mappings.map(m => m.current)).size, before.length);
    // Every field in every table must be unchanged except structured member references.
    for (const { name } of tables) {
      const expected = snapshots.get(name)!.map(row => {
        const result = { ...row };
        for (const ref of references.filter(r => r.table === name)) {
          const mapping = mappings.find(m => m.previous === result[ref.column]);
          if (mapping) result[ref.column] = mapping.current;
        }
        return result;
      });
      assert.deepEqual(db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all().map(row => ({ ...row })), expected);
    }
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get()!)[0], "ok");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  fs.writeFileSync(destination + ".mapping.json", JSON.stringify({ target, backup: destination, mode, mappings: mappings.map(({ temporary, ...m }) => m) }, null, 2));
  console.log(JSON.stringify({ backup: destination, members: mappings.length, numbers: mappings.map(m => m.current), verifiedAllTables: true }, null, 2));
} finally { db.close(); }