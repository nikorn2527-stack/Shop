import { describe, expect, it } from "vitest";
import {
  cardUsageHistory,
  checkout,
  closeMemberAccount,
  createBlankCards,
  createProduct,
  createSqliteStore,
  getMemberDetail,
  receiveStockBatch,
  registerMember,
  registerPosTerminal,
  releasePosTerminal,
  walletTx,
  type SqliteDb,
} from "./sqliteStore";

const deviceId = "12345678-1234-4234-8234-123456789012";
function fixture() {
  const db = createSqliteStore();
  createBlankCards(db, ["ATOMIC-CARD"]);
  const member = registerMember(db, {
    firstName: "Atomic",
    lastName: "Member",
    cardNumber: "ATOMIC-CARD",
    initialDeposit: 100,
  }).member;
  const product = createProduct(db, { name: "Atomic product", price: 10 });
  receiveStockBatch(
    db,
    [{ productId: product.id, purchaseQty: 10, paidAmount: 40 }],
    "Receiver",
  );
  const terminal = registerPosTerminal(db, deviceId, 1, "Admin");
  return { db, member, product, terminal };
}

function snapshot(db: SqliteDb) {
  const tables = [
    "products",
    "stock_lots",
    "stock_movements",
    "sales",
    "sale_items",
    "sale_lot_allocations",
    "members",
    "member_transactions",
    "physical_cards",
    "card_assignments",
    "card_usage_sessions",
    "audit_logs",
    "sqlite_sequence",
  ];
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

const checkoutFailures = [
  {
    stage: "sale item after the bill was created",
    table: "sale_items",
    event: "INSERT",
    when: "1",
  },
  {
    stage: "movement after stock was deducted",
    table: "stock_movements",
    event: "INSERT",
    when: "NEW.type = 'SALE'",
  },
  {
    stage: "allocation after a lot was deducted",
    table: "sale_lot_allocations",
    event: "INSERT",
    when: "1",
  },
  {
    stage: "item cost after lot allocation",
    table: "sale_items",
    event: "UPDATE OF cost_total_satang",
    when: "1",
  },
  {
    stage: "purchase ledger after the balance was deducted",
    table: "member_transactions",
    event: "INSERT",
    when: "NEW.type = 'purchase'",
  },
  {
    stage: "audit after the bill, stock and balance were written",
    table: "audit_logs",
    event: "INSERT",
    when: "NEW.action = 'ขายสินค้า'",
  },
];

describe("checkout service atomicity", () => {
  it.each(checkoutFailures)(
    "rolls back the complete sale when $stage fails",
    ({ table, event, when }) => {
      const { db, member, product } = fixture();
      try {
        const before = snapshot(db);
        const input = {
          terminalDeviceId: deviceId,
          memberNumber: member.memberNumber,
          paymentMethod: "หักบัญชีสมาชิก" as const,
          items: [{ productId: product.id, qty: 2 }],
          clientRequestId: "atomic-sale",
          cashier: "Cashier",
        };
        db.exec(
          `CREATE TRIGGER fail_sale BEFORE ${event} ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT, 'injected sale failure'); END`,
        );
        expect(() => checkout(db, input)).toThrow("injected sale failure");
        expect(snapshot(db)).toEqual(before);
        db.exec("DROP TRIGGER fail_sale");
        const receipt = checkout(db, input);
        expect(receipt).toMatchObject({
          total: 20,
          balanceAfter: 80,
          terminalNumber: 1,
        });
        expect(
          db.prepare("SELECT stock FROM products WHERE id = ?").get(product.id),
        ).toMatchObject({ stock: 8 });
        expect(
          db
            .prepare(
              "SELECT SUM(cost_satang) AS cost FROM sale_lot_allocations",
            )
            .get(),
        ).toMatchObject({ cost: 800 });
        const committed = snapshot(db);
        expect(checkout(db, input)).toEqual(receipt);
        expect(snapshot(db)).toEqual(committed);
      } finally {
        db.close();
      }
    },
  );

  it("replays the original wallet receipt after the terminal is unbound without another debit", () => {
    const { db, member, product, terminal } = fixture();
    try {
      const input = {
        terminalDeviceId: deviceId,
        memberNumber: member.memberNumber,
        paymentMethod: "หักบัญชีสมาชิก" as const,
        items: [{ productId: product.id, qty: 2 }],
        clientRequestId: "unbound-retry",
      };
      const receipt = checkout(db, input);
      releasePosTerminal(db, terminal.id, "Admin");
      const beforeRetry = snapshot(db);
      expect(checkout(db, input)).toEqual(receipt);
      expect(snapshot(db)).toEqual(beforeRetry);
    } finally {
      db.close();
    }
  });
});

const refundFailures = [
  {
    stage: "ledger after refunding the balance",
    table: "member_transactions",
    event: "INSERT",
    when: "NEW.type = 'refund'",
  },
  {
    stage: "physical card after writing the refund ledger",
    table: "physical_cards",
    event: "UPDATE",
    when: "NEW.status = 'returned_vacant'",
  },
  {
    stage: "card assignment after releasing the card",
    table: "card_assignments",
    event: "INSERT",
    when: "NEW.action = 'release'",
  },
  {
    stage: "release audit after closing the usage session",
    table: "audit_logs",
    event: "INSERT",
    when: "NEW.action = 'คืนบัตรหมุนเวียน'",
  },
  {
    stage: "refund audit after all card changes",
    table: "audit_logs",
    event: "INSERT",
    when: "NEW.action = 'คืนบัตรเงินสด'",
  },
];

describe("wallet service atomicity", () => {
  it.each(refundFailures)(
    "rolls back the full refund when $stage fails",
    ({ table, event, when }) => {
      const { db, member } = fixture();
      try {
        const before = snapshot(db);
        const input = {
          memberNumber: member.memberNumber,
          type: "refund" as const,
          amount: 100,
          actor: "Receiver",
          clientRequestId: "atomic-refund",
        };
        db.exec(
          `CREATE TRIGGER fail_refund BEFORE ${event} ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT, 'injected refund failure'); END`,
        );
        expect(() => walletTx(db, input)).toThrow("injected refund failure");
        expect(snapshot(db)).toEqual(before);
        db.exec("DROP TRIGGER fail_refund");
        const receipt = walletTx(db, input);
        expect(receipt).toMatchObject({
          amount: 100,
          balanceBefore: 100,
          balanceAfter: 0,
        });
        expect(getMemberDetail(db, member.memberNumber)?.member).toMatchObject({
          balance: 0,
          cardNumber: null,
        });
        expect(
          cardUsageHistory(db, "ATOMIC-CARD").sessions[0].endedAt,
        ).not.toBeNull();
        const committed = snapshot(db);
        expect(walletTx(db, input)).toEqual(receipt);
        expect(snapshot(db)).toEqual(committed);
      } finally {
        db.close();
      }
    },
  );

  it.each(["deposit", "withdrawal"] as const)(
    "rolls back a %s when the final audit fails, then replays a successful retry",
    (type) => {
      const { db, member } = fixture();
      try {
        const before = snapshot(db);
        const action = type === "deposit" ? "เติมเงินสมาชิก" : "ถอนเงินสมาชิก";
        db.exec(
          `CREATE TRIGGER fail_wallet BEFORE INSERT ON audit_logs WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'injected wallet failure'); END`,
        );
        const input = {
          memberNumber: member.memberNumber,
          type,
          amount: 10,
          clientRequestId: "atomic-wallet",
        };
        expect(() => walletTx(db, input)).toThrow("injected wallet failure");
        expect(snapshot(db)).toEqual(before);
        db.exec("DROP TRIGGER fail_wallet");
        const receipt = walletTx(db, input);
        expect(receipt.balanceAfter).toBe(type === "deposit" ? 110 : 90);
        const committed = snapshot(db);
        expect(walletTx(db, input)).toEqual(receipt);
        expect(snapshot(db)).toEqual(committed);
      } finally {
        db.close();
      }
    },
  );

  it("leaves the enclosing account closure in control of commit and rollback", () => {
    const { db, member } = fixture();
    try {
      const before = snapshot(db);
      const session = cardUsageHistory(db, "ATOMIC-CARD").sessions[0];
      const input = {
        memberNumber: member.memberNumber,
        cardNumber: "ATOMIC-CARD",
        expectedSessionId: session.id,
        clientRequestId: "close-atomic",
      };
      db.exec(
        "CREATE TRIGGER fail_close BEFORE INSERT ON audit_logs WHEN NEW.action = 'ปิดรอบบัญชีสมาชิก' BEGIN SELECT RAISE(ABORT, 'injected closure failure'); END",
      );
      expect(() => closeMemberAccount(db, input)).toThrow(
        "injected closure failure",
      );
      expect(snapshot(db)).toEqual(before);
      db.exec("DROP TRIGGER fail_close");
      closeMemberAccount(db, input);
      expect(getMemberDetail(db, member.memberNumber)?.member).toMatchObject({
        balance: 0,
        cardNumber: "ATOMIC-CARD",
        accountClosed: 1,
      });
      const committed = snapshot(db);
      closeMemberAccount(db, input);
      expect(snapshot(db)).toEqual(committed);
    } finally {
      db.close();
    }
  });
});
