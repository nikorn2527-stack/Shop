import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDocumentPrinting,
  issueDocumentPrint,
} from "./documentPrinting";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const opened: InstanceType<typeof DatabaseSync>[] = [];
function fixture() {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  db.exec(`CREATE TABLE store_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE sales(id INTEGER PRIMARY KEY,order_number TEXT,total REAL);
 CREATE TABLE member_transactions(id INTEGER PRIMARY KEY,client_request_id TEXT,type TEXT,balance_after REAL,card_usage_session_id INTEGER,amount REAL);
 CREATE TABLE card_usage_sessions(id INTEGER PRIMARY KEY,ended_at TEXT,end_reason TEXT);
 INSERT INTO sales VALUES(1,'OLD',50);
 INSERT INTO member_transactions VALUES(1,'old','deposit',50,NULL,50);
 INSERT INTO card_usage_sessions VALUES(1,'2026-01-01','return');`);
  initializeDocumentPrinting(db, "2026-11-09 10:00:00");
  db.exec(`INSERT INTO sales VALUES(2,'NEW',100);
 INSERT INTO member_transactions VALUES(2,'request-wallet','deposit',100,NULL,50),(3,'request-refund','refund',0,2,-100);
 INSERT INTO card_usage_sessions VALUES(2,'2026-11-09 11:00:00','return'),(3,'2026-11-09 11:00:00','return'),(4,NULL,NULL);`);
  return db;
}
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});
describe("document print dispatch metadata", () => {
  it("survives reopening and shares a counter between independent connections", () => {
    const source = fixture();
    const dir = mkdtempSync(join(tmpdir(), "shop-print-"));
    const file = join(dir, "store.sqlite");
    source.prepare("VACUUM INTO ?").run(file);
    let first = new DatabaseSync(file);
    const second = new DatabaseSync(file);
    try {
      expect(
        issueDocumentPrint(first, { kind: "sale", key: "NEW" }, "disk-a", "A")
          .ordinal
      ).toBe(1);
      first.close();
      first = new DatabaseSync(file);
      expect(
        issueDocumentPrint(second, { kind: "sale", key: "NEW" }, "disk-b", "B")
          .ordinal
      ).toBe(2);
      expect(
        issueDocumentPrint(first, { kind: "sale", key: "NEW" }, "disk-c", "A")
          .ordinal
      ).toBe(3);
    } finally {
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts per document durably, retries idempotently, and leaves financial rows untouched", () => {
    const db = fixture();
    const before = db.prepare("SELECT * FROM member_transactions").all();
    const issue = (requestId: string) =>
      issueDocumentPrint(db, { kind: "sale", key: "NEW" }, requestId, "staff");
    expect(issue("a")).toMatchObject({ ordinal: 1, variant: "original" });
    expect(issue("a")).toMatchObject({ ordinal: 1, variant: "original" });
    initializeDocumentPrinting(db, "2099-01-01");
    expect(issue("b")).toMatchObject({ ordinal: 2, variant: "copy" });
    expect(
      issueDocumentPrint(db, { kind: "sale", key: "OLD" }, "c", "staff").variant
    ).toBe("copy");
    expect(db.prepare("SELECT * FROM member_transactions").all()).toEqual(
      before
    );
    expect(db.prepare("SELECT * FROM sales").all()).toEqual([
      { id: 1, order_number: "OLD", total: 50 },
      { id: 2, order_number: "NEW", total: 100 },
    ]);
  });
  it("shares history across wallet request, report transaction, and refund return session aliases", () => {
    const db = fixture();
    expect(
      issueDocumentPrint(
        db,
        { kind: "wallet_request", key: "request-wallet" },
        "a",
        "staff"
      ).ordinal
    ).toBe(1);
    expect(
      issueDocumentPrint(db, { kind: "wallet", key: "2" }, "b", "staff").ordinal
    ).toBe(2);
    expect(
      issueDocumentPrint(db, { kind: "card_return", key: "2" }, "c", "staff")
        .ordinal
    ).toBe(1);
    expect(
      issueDocumentPrint(db, { kind: "wallet", key: "3" }, "d", "staff").variant
    ).toBe("copy");
    expect(
      issueDocumentPrint(db, { kind: "card_return", key: "3" }, "e", "staff")
        .ordinal
    ).toBe(1);
    expect(
      issueDocumentPrint(db, { kind: "card_return", key: "1" }, "f", "staff")
        .variant
    ).toBe("copy");
  });
  it("rejects unknown/open documents and request reuse for a different document without advancing counts", () => {
    const db = fixture();
    for (const ref of [
      { kind: "sale", key: "missing" },
      { kind: "wallet", key: "99" },
      { kind: "card_return", key: "4" },
    ] as const)
      expect(() => issueDocumentPrint(db, ref, "bad", "staff")).toThrow();
    issueDocumentPrint(db, { kind: "sale", key: "NEW" }, "same", "staff");
    expect(() =>
      issueDocumentPrint(db, { kind: "sale", key: "OLD" }, "same", "staff")
    ).toThrow();
    expect(
      issueDocumentPrint(db, { kind: "sale", key: "NEW" }, "next", "staff")
        .ordinal
    ).toBe(2);
  });
  it("normalizes numeric session references", () => {
    const db = fixture();
    expect(
      issueDocumentPrint(
        db,
        { kind: "card_return", key: "3" },
        "normalize-a",
        "staff"
      ).ordinal
    ).toBe(1);
    expect(
      issueDocumentPrint(
        db,
        { kind: "card_return", key: "03" },
        "normalize-b",
        "staff"
      ).ordinal
    ).toBe(2);
  });
});
