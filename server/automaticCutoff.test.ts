import { afterEach, describe, expect, it, vi } from "vitest";
import { closeBusinessDay, closeElapsedBusinessPeriods, createSqliteStore, listDayClosures, setSettings, type SqliteDb } from "./sqliteStore";

let db: SqliteDb;
afterEach(() => { db?.close(); vi.useRealTimers(); });
function fixture() {
  db = createSqliteStore();
  setSettings(db, { dailyCutOffMode: "auto", dailyCutOffTime: "08:00" });
  db.prepare(`INSERT INTO members (member_number, first_name, last_name) VALUES ('AUTO-1', 'Auto', 'Test')`).run();
}
function deposit(time: string, amount: number) {
  db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, created_at) VALUES ('AUTO-1', 'deposit', 'audit', ?, ?)`).run(amount, time);
}
describe("scheduled automatic cutoff", () => {
  it("waits for the boundary, excludes boundary transactions, and never duplicates on retry", () => {
    fixture();
    deposit("2026-10-04 10:00:00", 100);
    deposit("2026-10-05 07:59:59", 20);
    deposit("2026-10-05 08:00:00", 50);
    expect(closeElapsedBusinessPeriods(db, new Date("2026-10-05T07:59:59"))).toEqual([]);
    const rows = closeElapsedBusinessPeriods(db, new Date("2026-10-05T08:00:01"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ periodStart: "2026-10-04 08:00:00", closedAt: "2026-10-05 08:00:00", depositAmount: 120, depositCount: 2, closedBy: "ระบบอัตโนมัติ" });
    expect(closeElapsedBusinessPeriods(db, new Date("2026-10-05T08:00:20"))).toEqual([]);
    deposit("2026-10-05 09:00:00", 30);
    expect(listDayClosures(db)[0].depositAmount).toBe(120);
    const next = closeElapsedBusinessPeriods(db, new Date("2026-10-06T08:00:00"));
    expect(next[0].depositAmount).toBe(80);
    expect(listDayClosures(db)).toHaveLength(2);
  });
  it("catches up missed days without combining or double counting them", () => {
    fixture();
    deposit("2026-10-02 12:00:00", 10);
    deposit("2026-10-03 12:00:00", 20);
    deposit("2026-10-04 12:00:00", 30);
    const rows = closeElapsedBusinessPeriods(db, new Date("2026-10-05T08:01:00"));
    expect(rows.map(row => row.depositAmount)).toEqual([10, 20, 30]);
    expect(closeElapsedBusinessPeriods(db, new Date("2026-10-05T08:02:00"))).toEqual([]);
  });
  it("closes only the remainder after a manual close inside the scheduled period", () => {
    fixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:00"));
    deposit("2026-10-04 10:00:00", 100);
    closeBusinessDay(db, { actor: "test" });
    deposit("2026-10-04 13:00:00", 25);
    const rows = closeElapsedBusinessPeriods(db, new Date("2026-10-05T08:00:00"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ periodStart: "2026-10-04 12:00:00", depositAmount: 25, depositCount: 1 });
    expect(listDayClosures(db).map(row => row.depositAmount)).toEqual([25, 100]);
  });
  it("bounds sales and quantities at the same cutoff as wallet movements", () => {
    fixture();
    for (const [order, time, total] of [["BEFORE", "2026-10-05 07:59:59", 40], ["AT", "2026-10-05 08:00:00", 60]] as const) {
      const sale = db.prepare(`INSERT INTO sales (order_number, payment_method, subtotal, total, created_at) VALUES (?, 'เงินสด', ?, ?, ?)`).run(order, total, total, time);
      db.prepare(`INSERT INTO sale_items (sale_id, name, qty, price) VALUES (?, 'audit', 2, ?)`).run(sale.lastInsertRowid, total / 2);
    }
    const rows = closeElapsedBusinessPeriods(db, new Date("2026-10-05T08:00:10"));
    expect(rows[0]).toMatchObject({ bills: 1, pieces: 2, revenue: 40, cashTotal: 40 });
  });
  it("does not create old empty periods on a new database or run in manual mode", () => {
    fixture();
    expect(closeElapsedBusinessPeriods(db, new Date("2026-10-05T08:01:00"))).toEqual([]);
    expect(listDayClosures(db)).toEqual([]);
    setSettings(db, { dailyCutOffMode: "manual" });
    deposit("2026-10-04 12:00:00", 40);
    expect(closeElapsedBusinessPeriods(db, new Date("2026-10-06T08:01:00"))).toEqual([]);
  });
});