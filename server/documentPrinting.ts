import type { SqliteDb } from "./sqliteStore";
import type {
  PrintDocumentRef,
  SlipVariant,
} from "../shared/storeTypes/documents";

const BOUNDARY = "document_print_tracking_v1";
type Boundary = { sale: number; wallet: number; startedAt: string };
type PrintIssue = {
  documentKey: string;
  ordinal: number;
  variant: SlipVariant;
  actor: string;
  requestedAt: string;
};
function read<T>(db: SqliteDb, key: string): T | undefined {
  const row = db
    .prepare("SELECT value FROM store_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}
function write(db: SqliteDb, key: string, value: unknown) {
  db.prepare(
    "INSERT INTO store_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, JSON.stringify(value));
}
/** Mark pre-existing documents once. Their physical printing history is unknown. */
export function initializeDocumentPrinting(db: SqliteDb, now: string) {
  if (read<Boundary>(db, BOUNDARY)) return;
  db.prepare(`INSERT OR IGNORE INTO store_settings(key,value) VALUES(?,?)`).run(
    BOUNDARY,
    JSON.stringify({
      sale: Number(
        db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM sales").get()?.id
      ),
      wallet: Number(
        db
          .prepare("SELECT COALESCE(MAX(id),0) AS id FROM member_transactions")
          .get()?.id
      ),
      startedAt: now,
    } satisfies Boundary)
  );
}
function resolveDocument(
  db: SqliteDb,
  ref: PrintDocumentRef,
  boundary: Boundary
): { key: string; legacy: boolean } {
  if (ref.kind === "sale") {
    const row = db
      .prepare("SELECT id FROM sales WHERE order_number=?")
      .get(ref.key);
    if (row)
      return { key: `sale:${row.id}`, legacy: Number(row.id) <= boundary.sale };
  } else if (ref.kind === "wallet" || ref.kind === "wallet_request") {
    const column = ref.kind === "wallet" ? "id" : "client_request_id";
    const row = db
      .prepare(
        `SELECT id FROM member_transactions WHERE ${column}=? AND type IN ('deposit','withdrawal','refund','activation')`
      )
      .get(ref.key);
    if (row)
      return {
        key: `wallet:${row.id}`,
        legacy: Number(row.id) <= boundary.wallet,
      };
  } else if (ref.kind === "registration") {
    const member = db
      .prepare(
        "SELECT member_number,created_at FROM members WHERE member_number=?"
      )
      .get(ref.key);
    if (member)
      return {
        key: `registration:${member.member_number}`,
        legacy: String(member.created_at) <= boundary.startedAt,
      };
  } else if (ref.kind === "card_return" || ref.kind === "card_return_zero") {
    const session = db
      .prepare(
        "SELECT id,ended_at,end_reason FROM card_usage_sessions WHERE id=?"
      )
      .get(ref.key);
    if (session?.ended_at) {
      const refund =
        ref.kind === "card_return_zero"
          ? undefined
          : db
              .prepare(
                "SELECT id FROM member_transactions WHERE card_usage_session_id=? AND type='refund' AND balance_after=0 ORDER BY id DESC LIMIT 1"
              )
              .get(ref.key);
      if (refund)
        return {
          key: `wallet:${refund.id}`,
          legacy: Number(refund.id) <= boundary.wallet,
        };
      return {
        key: `card-return:${session.id}`,
        legacy: String(session.ended_at) <= boundary.startedAt,
      };
    }
  }
  throw new Error("ไม่พบเอกสารที่บันทึกสำเร็จสำหรับพิมพ์");
}
/** Counts dispatch requests, NOT confirmed physical paper. UUID retries do not count twice. */
export function issueDocumentPrint(
  db: SqliteDb,
  ref: PrintDocumentRef,
  requestId: string,
  actor: string
): PrintIssue {
  db.exec("BEGIN IMMEDIATE");
  try {
    const boundary = read<Boundary>(db, BOUNDARY);
    if (!boundary) throw new Error("ยังไม่ได้เริ่มระบบประวัติพิมพ์");
    const doc = resolveDocument(db, ref, boundary);
    const requestKey = `document_print_request:${requestId}`;
    const previous = read<PrintIssue>(db, requestKey);
    if (previous) {
      if (previous.documentKey !== doc.key)
        throw new Error("รหัสคำขอพิมพ์ซ้ำไม่ตรงกับเอกสาร");
      db.exec("COMMIT");
      return previous;
    }
    const countKey = `document_print_count:${doc.key}`;
    const ordinal = (read<number>(db, countKey) ?? (doc.legacy ? 1 : 0)) + 1;
    const result: PrintIssue = {
      documentKey: doc.key,
      ordinal,
      variant: ordinal === 1 ? "original" : "copy",
      actor,
      requestedAt: new Date().toISOString(),
    };
    write(db, countKey, ordinal);
    write(db, requestKey, result);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
