import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteStore,
  registerMember,
  createBlankCards,
  walletTx,
  returnMemberCard,
  closeMemberAccount,
  type SqliteDb,
} from "./sqliteStore";
import {
  registrationSlip,
  walletRequestSlip,
  returnedCardSlip,
} from "./memberSlipDocuments";
import { issueDocumentPrint } from "./documentPrinting";
const databases: SqliteDb[] = [];
const fresh = () => {
  const db = createSqliteStore();
  databases.push(db);
  return db;
};
afterEach(() => databases.splice(0).forEach(db => db.close()));
describe("documents from existing successful member operations", () => {
  it("returns a saved opening-money reference and time without a second deposit", () => {
    const db = fresh();
    createBlankCards(db, ["SECRET-CARD-1"]);
    const result = registerMember(db, {
      firstName: "สมาชิก",
      lastName: "เริ่มต้น",
      cardNumber: "SECRET-CARD-1",
      initialDeposit: 25,
      actor: "เจ้าหน้าที่",
    });
    const slip = registrationSlip(db, result.member.memberNumber);
    const row = db
      .prepare(
        "SELECT id,created_at AS createdAt FROM member_transactions WHERE member_number=? AND type='activation'"
      )
      .get(result.member.memberNumber)!;
    expect(slip).toMatchObject({
      kind: "registration",
      reference: `TX-${row.id}`,
      createdAt: row.createdAt,
      amount: 25,
      balanceBefore: 0,
      balanceAfter: 25,
      cashier: "เจ้าหน้าที่",
    });
    expect(JSON.stringify(slip)).not.toContain("SECRET-CARD-1");
    const before = db.prepare("SELECT * FROM member_transactions").all();
    issueDocumentPrint(
      db,
      slip.documentRef,
      "registration-print-1",
      "เจ้าหน้าที่"
    );
    issueDocumentPrint(
      db,
      slip.documentRef,
      "registration-print-2",
      "เจ้าหน้าที่"
    );
    expect(db.prepare("SELECT * FROM member_transactions").all()).toEqual(
      before
    );
  });
  it("confirms zero-fund registration without manufacturing a money transaction", () => {
    const db = fresh(),
      result = registerMember(db, {
        firstName: "สมาชิก",
        lastName: "ยอดศูนย์",
        actor: "เจ้าหน้าที่",
      });
    const slip = registrationSlip(db, result.member.memberNumber);
    expect(slip).toMatchObject({
      kind: "registration",
      amount: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      documentRef: { kind: "registration", key: result.member.memberNumber },
    });
    issueDocumentPrint(
      db,
      slip.documentRef,
      "zero-registration-print",
      "เจ้าหน้าที่"
    );
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM member_transactions").get()?.n
    ).toBe(0);
  });
  it("uses the original wallet row when a successful request is replayed", () => {
    const db = fresh();
    createBlankCards(db, ["SECRET-CARD-2"]);
    const member = registerMember(db, {
      firstName: "สมาชิก",
      lastName: "เติมเงิน",
      cardNumber: "SECRET-CARD-2",
    }).member;
    const input = {
      memberNumber: member.memberNumber,
      type: "deposit" as const,
      amount: 50,
      actor: "เจ้าหน้าที่",
      clientRequestId: "same-money-request",
    };
    walletTx(db, input);
    const firstDocument = walletRequestSlip(db, input.clientRequestId);
    walletTx(db, { ...input, amount: 10, clientRequestId: "later-request" });
    const replay = walletTx(db, input);
    expect(walletRequestSlip(db, input.clientRequestId)).toMatchObject({
      kind: "deposit",
      amount: 50,
      balanceBefore: 0,
      balanceAfter: 50,
    });
    expect(walletRequestSlip(db, input.clientRequestId)).toEqual(firstDocument);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM member_transactions").get()?.n
    ).toBe(2);
    expect(
      JSON.stringify(walletRequestSlip(db, input.clientRequestId))
    ).not.toContain("SECRET-CARD-2");
  });
  it("does not pay a prior account-closure refund again when the physical card is returned", () => {
    const db = fresh();
    createBlankCards(db, ["CLOSED-CARD"]);
    const member = registerMember(db, {
      firstName: "คืนเงินแล้ว",
      lastName: "ยังไม่คืนบัตร",
      cardNumber: "CLOSED-CARD",
      initialDeposit: 100,
    }).member;
    const session = db
      .prepare(
        "SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL"
      )
      .get(member.memberNumber)!;
    const identity = {
      memberNumber: member.memberNumber,
      cardNumber: "CLOSED-CARD",
      expectedSessionId: Number(session.id),
    };
    closeMemberAccount(db, {
      ...identity,
      actor: "ผู้คืนเงินก่อนหน้า",
      clientRequestId: "account-close",
    });
    const before = db.prepare("SELECT * FROM member_transactions").all();
    returnMemberCard(db, {
      ...identity,
      mode: "refund",
      actor: "ผู้รับบัตรคืน",
      clientRequestId: "physical-return",
    });
    const slip = returnedCardSlip(db, Number(session.id), "physical-return");
    expect(slip).toMatchObject({
      kind: "refund",
      amount: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      cashier: "ผู้รับบัตรคืน",
      documentRef: { kind: "card_return_zero", key: String(session.id) },
    });
    issueDocumentPrint(
      db,
      slip.documentRef,
      "closed-return-print",
      "ผู้รับบัตรคืน"
    );
    expect(db.prepare("SELECT * FROM member_transactions").all()).toEqual(
      before
    );
  });
  it.each([0, 100])(
    "confirms a card return of %s without adding an extra refund when printing",
    amount => {
      const db = fresh();
      createBlankCards(db, ["SECRET-CARD-3"]);
      const member = registerMember(db, {
        firstName: "สมาชิก",
        lastName: "คืนบัตร",
        cardNumber: "SECRET-CARD-3",
        ...(amount ? { initialDeposit: amount } : {}),
      }).member;
      const session = db
        .prepare(
          "SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL"
        )
        .get(member.memberNumber)!;
      const result = returnMemberCard(db, {
        memberNumber: member.memberNumber,
        cardNumber: "SECRET-CARD-3",
        expectedSessionId: Number(session.id),
        mode: "refund",
        actor: "เจ้าหน้าที่",
        clientRequestId: "return-money-request",
      })!;
      const slip = returnedCardSlip(
        db,
        Number(session.id),
        "return-money-request"
      );
      expect(slip).toMatchObject({
        kind: "refund",
        amount,
        balanceBefore: amount,
        balanceAfter: 0,
        memberNumber: member.memberNumber,
      });
      expect(JSON.stringify(slip)).not.toContain("SECRET-CARD-3");
      const before = db.prepare("SELECT * FROM member_transactions").all();
      issueDocumentPrint(db, slip.documentRef, "return-print-1", "เจ้าหน้าที่");
      issueDocumentPrint(db, slip.documentRef, "return-print-2", "เจ้าหน้าที่");
      expect(db.prepare("SELECT * FROM member_transactions").all()).toEqual(
        before
      );
    }
  );
});
