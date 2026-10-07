import { describe, expect, it } from "vitest";
import { createSqliteStore, createBlankCards, registerMember, releasePhysicalCard, listPhysicalCards, markPhysicalCard, getMemberDetail, setSettings, setMemberNumberMode, bindExistingMembersToDemoCards } from "./sqliteStore";

describe("reusable physical cards", () => {
  it("moves existing members to demo cards without changing balances or ledger and is idempotent", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["OLD-01", "DEMO-CARD-00001"]);
      const member = registerMember(db, { firstName: "Existing", lastName: "Member", cardNumber: "OLD-01", initialDeposit: 125 });
      const ledger = db.prepare("SELECT * FROM member_transactions").all();
      expect(bindExistingMembersToDemoCards(db, "Demo preparation")).toEqual([{ memberNumber: member.member.memberNumber, cardNumber: "DEMO-CARD-00001", previousCard: "OLD-01" }]);
      expect(getMemberDetail(db, member.member.memberNumber)?.member).toMatchObject({ balance: 125, cardNumber: "DEMO-CARD-00001" });
      expect(db.prepare("SELECT * FROM member_transactions").all()).toEqual(ledger);
      expect(listPhysicalCards(db).find(card => card.cardNumber === "OLD-01")?.status).toBe("returned_vacant");
      expect(bindExistingMembersToDemoCards(db, "Demo preparation")).toEqual([]);
    } finally { db.close(); }
  });
  it("rolls back all assignments if an existing binding is inconsistent", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["OLD-01", "OLD-02"]);
      registerMember(db, { firstName: "One", lastName: "Member", cardNumber: "OLD-01" });
      registerMember(db, { firstName: "Two", lastName: "Member", cardNumber: "OLD-02" });
      db.prepare("UPDATE physical_cards SET status = 'lost', assigned_member_number = NULL WHERE card_number = 'OLD-02'").run();
      const before = db.prepare("SELECT * FROM members").all();
      expect(() => bindExistingMembersToDemoCards(db, "Demo preparation")).toThrow();
      expect(db.prepare("SELECT * FROM members").all()).toEqual(before);
      expect(listPhysicalCards(db).some(card => card.cardNumber.startsWith("DEMO-CARD-"))).toBe(false);
    } finally { db.close(); }
  });
  it("uses configured member numbering independently of reusable card codes", () => {
    const db = createSqliteStore();
    try {
      setMemberNumberMode(db, "running");
      setSettings(db, { memberNumberPrefix: "TEST", memberNumberYearMode: "none", memberNumberSequenceDigits: 5, memberNumberSeparator: "-" });
      createBlankCards(db, ["DEMO-CARD-00001"]);
      const first = registerMember(db, { firstName: "First", lastName: "Member", cardNumber: "DEMO-CARD-00001" });
      expect(first.member.memberNumber).toBe("TEST-00001");
      releasePhysicalCard(db, "DEMO-CARD-00001");
      const second = registerMember(db, { firstName: "Second", lastName: "Member", cardNumber: "DEMO-CARD-00001" });
      expect(second.member.memberNumber).toBe("TEST-00002");
    } finally { db.close(); }
  });
  it("assigns once, rolls back duplicate registration and reuses without transferring money", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["CARD-001"], "Admin");
      const first = registerMember(db, { firstName: "First", lastName: "Member", cardNumber: "CARD-001", initialDeposit: 100 });
      expect(listPhysicalCards(db)[0]).toMatchObject({ status: "assigned", assignedMemberNumber: first.member.memberNumber });
      expect(() => registerMember(db, { firstName: "Duplicate", lastName: "Member", cardNumber: "CARD-001" })).toThrow();
      expect(db.prepare("SELECT COUNT(*) AS count FROM members").get()).toMatchObject({ count: 1 });
      releasePhysicalCard(db, "CARD-001", "Staff");
      expect(getMemberDetail(db, first.member.memberNumber)?.member).toMatchObject({ balance: 100, cardNumber: null });
      const second = registerMember(db, { firstName: "Second", lastName: "Member", cardNumber: "CARD-001" });
      expect(second.member.memberNumber).not.toBe(first.member.memberNumber);
      expect(second.member.balance).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM card_assignments").get()).toMatchObject({ count: 3 });
    } finally { db.close(); }
  });
  it("rejects unknown, lost and damaged cards without creating a member", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["LOST", "DAMAGED"]);
      markPhysicalCard(db, "LOST", "lost");
      markPhysicalCard(db, "DAMAGED", "damaged");
      for (const cardNumber of ["UNKNOWN", "LOST", "DAMAGED"]) {
        expect(() => registerMember(db, { firstName: "Blocked", lastName: "Member", cardNumber })).toThrow();
      }
      expect(db.prepare("SELECT COUNT(*) AS count FROM members").get()).toMatchObject({ count: 0 });
    } finally { db.close(); }
  });
});