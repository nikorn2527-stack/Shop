import type { SqliteDb } from "../sqliteStore";

const MARKER = "migration_confirmed_opening_balance_v1";
const IMPORT_BATCH = "2026-11-02 07:10:52";
type Status = "not_applicable" | "applied" | "needs_review";

/** Only a non-sensitive maintenance state is exposed to health monitoring. */
export function openingBalanceCorrectionStatus(db: SqliteDb): Status {
  const row = db.prepare("SELECT value FROM store_settings WHERE key=?").get(MARKER) as { value: string } | undefined;
  if (!row) return "not_applicable";
  try { return JSON.parse(row.value).status === "applied" ? "applied" : "needs_review"; }
  catch { return "needs_review"; }
}

/** Owner confirmed the previously blank G100 opening balance as 500, not a new deposit. */
export function confirmImportedOpeningBalance(db: SqliteDb, options: { now: string; backup?: () => string }): { status: Status; delta: number } {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='opening_import_rows'").get()) return { status: "not_applicable", delta: 0 };
  if (db.prepare("SELECT 1 FROM store_settings WHERE key=?").get(MARKER)) return { status: openingBalanceCorrectionStatus(db), delta: 0 };
  const rows = db.prepare("SELECT entity_key,source_json FROM opening_import_rows WHERE entity_type='member' AND source_row=100 AND source_file=? AND imported_at=?").all("ทะเบียนเงินรับฝากผู้ป่วย.xlsx", IMPORT_BATCH) as { entity_key: string; source_json: string }[];
  if (rows.length !== 1) return { status: "not_applicable", delta: 0 };
  const row = rows[0];
  let source: Record<string, unknown>;
  try { source = JSON.parse(row.source_json); } catch { return { status: "not_applicable", delta: 0 }; }
  if (source.balance_provisional !== true || Number(source.balance) !== 0 || typeof source.card_number !== "string") return { status: "not_applicable", delta: 0 };
  const backupFile = options.backup?.() ?? null;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM store_settings WHERE key=?").get(MARKER)) {
      const status = openingBalanceCorrectionStatus(db);
      db.exec("COMMIT");
      return { status, delta: 0 };
    }
    // Re-read after backup and under the write lock; never overwrite activity during cutover.
    const member = db.prepare("SELECT balance,card_number,status,account_closed FROM members WHERE member_number=?").get(row.entity_key) as { balance: number; card_number: string; status: string; account_closed: number } | undefined;
    const sessions = db.prepare("SELECT id,opening_balance FROM card_usage_sessions WHERE member_number=? AND card_number=? AND ended_at IS NULL").all(row.entity_key, source.card_number) as { id: number; opening_balance: number }[];
    const activity = db.prepare("SELECT (SELECT COUNT(*) FROM member_transactions WHERE member_number=?) + (SELECT COUNT(*) FROM sales WHERE member_number=?) AS n").get(row.entity_key, row.entity_key) as { n: number };
    const card = db.prepare("SELECT 1 FROM physical_cards WHERE card_number=? AND assigned_member_number=? AND status='assigned' AND archived_at IS NULL").get(source.card_number, row.entity_key);
    const eligible = !!member && !!card && member.status === "active" && !member.account_closed && member.card_number === source.card_number && sessions.length === 1 && activity.n === 0;
    let status: Status = "needs_review", delta = 0;
    if (eligible && member.balance === 0 && sessions[0].opening_balance === 0) {
      db.prepare("UPDATE members SET balance=500 WHERE member_number=?").run(row.entity_key);
      db.prepare("UPDATE card_usage_sessions SET opening_balance=500 WHERE id=?").run(sessions[0].id);
      status = "applied"; delta = 500;
    } else if (eligible && member.balance === 500 && sessions[0].opening_balance === 500) status = "applied";
    if (status === "applied") {
      db.prepare("UPDATE opening_import_rows SET source_json=? WHERE entity_type='member' AND entity_key=?").run(JSON.stringify({ ...source, confirmed_opening_balance: "500", balance_provisional_resolved: true, confirmed_at: options.now }), row.entity_key);
      db.prepare("UPDATE physical_cards SET note=REPLACE(COALESCE(note,''),?,?) WHERE card_number=?").run("ยอดคงเหลือ G100 ใช้ 0 ชั่วคราว ตามผู้ยืนยัน", "ยืนยันยอดตั้งต้น G100 เป็น 500 บาทแล้ว", source.card_number);
    }
    db.prepare("INSERT INTO store_settings(key,value) VALUES (?,?)").run(MARKER, JSON.stringify({ status, delta, appliedAt: options.now, backupFile }));
    db.prepare("INSERT INTO audit_logs(action,actor,actor_role,detail,tone,created_at) VALUES (?,?,?,?,?,?)").run(
      status === "applied" ? "ยืนยันยอดตั้งต้นสมาชิก" : "ตรวจสอบยอดตั้งต้นสมาชิกเพิ่มเติม", "ระบบ", "ระบบ",
      status === "applied" ? `${row.entity_key} · G100 ยืนยันยอดตั้งต้น 500 บาท · ปรับ ${delta} บาท · ไม่ใช่รายการเติมเงินและไม่เปลี่ยนรายการย้อนหลัง` : `${row.entity_key} · ยังไม่ปรับ G100 อัตโนมัติ เนื่องจากสถานะบัตรหรือยอดมีการเปลี่ยนแปลง ต้องตรวจสอบก่อน`,
      status === "applied" ? "blue" : "amber", options.now
    );
    db.exec("COMMIT");
    return { status, delta };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
