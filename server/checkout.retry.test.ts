import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkout, createBlankCards, createProduct, createSqliteStore, getMemberDetail, registerMember, registerPosTerminal, releasePosTerminal, salesByCategory, salesByProduct, salesLineItems, salesList, voidSale, type SqliteDb } from "./sqliteStore";
import type { CheckoutInput } from "../shared/storeTypes/sales";
let db: SqliteDb;
let dir: string;
let productId: number;
let memberNumber: string;
const device = "12345678-1234-4234-8234-123456789012";
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T12:00:00"));
  dir = mkdtempSync(join(tmpdir(), "shop-retry-")); db = createSqliteStore(join(dir, "fixture.sqlite"));
  createBlankCards(db, ["RETRY-CARD"]);
  memberNumber = registerMember(db, { firstName: "Original", lastName: "Member", cardNumber: "RETRY-CARD", initialDeposit: 100 }).member.memberNumber;
  productId = createProduct(db, { name: "Original product", price: 10, stock: 10 }).id;
  registerPosTerminal(db, device, 1, "Admin");
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });
function input(): CheckoutInput { return { terminalDeviceId: device, items: [{ productId, qty: 1 }], paymentMethod: "หักบัญชีสมาชิก", memberNumber, cashier: "Cashier", clientRequestId: "retry-original" }; }
function state() {
  return { stock: db.prepare("SELECT stock FROM products WHERE id=?").get(productId), balance: getMemberDetail(db, memberNumber)!.member.balance, sales: db.prepare("SELECT * FROM sales").all(), ledger: db.prepare("SELECT * FROM member_transactions").all(), movements: db.prepare("SELECT * FROM stock_movements").all() };
}
describe("durable checkout retries", () => {
  it.each([
    ["quantity", (v: CheckoutInput) => ({ ...v, items: [{ productId, qty: 2 }] })],
    ["method", (v: CheckoutInput) => ({ ...v, paymentMethod: "เงินสด" as const, receivedCash: 10 })],
    ["member", (v: CheckoutInput) => ({ ...v, memberNumber: "OTHER" })],
    ["discount", (v: CheckoutInput) => ({ ...v, discount: 1 })],
    ["terminal", (v: CheckoutInput) => ({ ...v, terminalDeviceId: "87654321-4321-4321-8321-210987654321" })],
    ["cashier identity", (v: CheckoutInput) => ({ ...v, cashierUserId: 2 })],
    ["cashier", (v: CheckoutInput) => ({ ...v, cashier: "Other cashier" })],
    ["price", (v: CheckoutInput) => ({ ...v, items: [{ productId, qty: 1, price: 0.01 }] })],
  ] as const)("rejects reused request ID with changed %s before any other writes", (_name, change) => {
    checkout(db, input()); const before = state();
    expect(() => checkout(db, change(input()))).toThrow(/ข้อมูลเปลี่ยน/);
    expect(state()).toEqual(before);
  });
  it("replays a frozen receipt after restart, member/catalog changes and terminal release", () => {
    const receipt = checkout(db, input());
    db.prepare("UPDATE members SET first_name='Renamed', balance=7 WHERE member_number=?").run(memberNumber);
    db.prepare("UPDATE products SET name='Renamed product', price=99 WHERE id=?").run(productId);
    releasePosTerminal(db, receipt.terminalId!, "Admin");
    db.close(); db = createSqliteStore(join(dir, "fixture.sqlite"));
    const before = state();
    expect(checkout(db, input())).toEqual(receipt);
    expect(state()).toEqual(before);
  });
  it("never replays a cancelled bill as a successful payment", () => {
    checkout(db, input()); const sale = db.prepare("SELECT id FROM sales").get() as { id: number };
    voidSale(db, { saleId: sale.id, reason: "Cancelled" }); const before = state();
    expect(() => checkout(db, input())).toThrow(/ถูกยกเลิกแล้ว/);
    expect(state()).toEqual(before);
  });
  it("blocks unverified legacy request IDs without charging again", () => {
    checkout(db, input()); db.prepare("UPDATE sales SET request_fingerprint=NULL, receipt_snapshot=NULL").run();
    const before = state(); expect(() => checkout(db, input())).toThrow(/ยืนยันข้อมูลคำขอเก่าไม่ได้/); expect(state()).toEqual(before);
  });
  it("rolls back payment and stock if saving the receipt snapshot fails", () => {
    db.exec("CREATE TRIGGER fail_snapshot BEFORE UPDATE OF receipt_snapshot ON sales BEGIN SELECT RAISE(ABORT, 'snapshot failure'); END");
    const before = state(); expect(() => checkout(db, input())).toThrow(/snapshot failure/); expect(state()).toEqual(before);
    db.exec("DROP TRIGGER fail_snapshot"); expect(checkout(db, input()).total).toBe(10);
  });
  it("preserves exact tier totals in replay, history, category/product and line reports", () => {
    db.prepare("UPDATE products SET sell_mode='money', price_tiers=? WHERE id=?").run(JSON.stringify([{ label: "Portion", price: 10, qty: 300 }]), productId);
    db.prepare("UPDATE products SET stock=600 WHERE id=?").run(productId);
    const request = { ...input(), items: [{ productId, label: "Portion", price: 0.0333, qty: 300 }] };
    const receipt = checkout(db, request);
    expect(receipt.items[0].amount).toBe(10);
    expect(checkout(db, request)).toEqual(receipt);
    expect(salesList(db)[0].items[0].amount).toBe(10);
    expect(salesByCategory(db)[0].revenue).toBe(10);
    expect(salesByProduct(db)[0].revenue).toBe(10);
    expect(salesLineItems(db)[0].amount).toBe(10);
  });
  it("adds nullable migration columns to an older file without deleting its business rows", () => {
    checkout(db, input());
    const balance = getMemberDetail(db, memberNumber)!.member.balance;
    for (const [table, column] of [["sales", "request_fingerprint"], ["sales", "receipt_snapshot"], ["sale_items", "amount"], ["day_closures", "last_sale_id"], ["day_closures", "last_member_tx_id"]]) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    db.close(); db = createSqliteStore(join(dir, "fixture.sqlite"));
    expect(getMemberDetail(db, memberNumber)!.member.balance).toBe(balance);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toMatchObject({ n: 1 });
    expect(salesList(db)[0].items[0].amount).toBe(10);
    expect(() => checkout(db, input())).toThrow(/ยืนยันข้อมูลคำขอเก่าไม่ได้/);
  });
  it("uses the legacy line calculation when authoritative amount is absent", () => {
    checkout(db, input()); db.prepare("UPDATE sale_items SET amount=NULL").run();
    expect(salesList(db)[0].items[0].amount).toBe(10);
    expect(salesByProduct(db)[0].revenue).toBe(10);
  });
});
