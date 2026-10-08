import { describe, expect, it } from "vitest";
import { assignMemberCard } from "./sqliteStore";
import { generateBlankCards, previewGeneratedCards } from "./sqliteStore";
import { returnMemberCard } from "./sqliteStore";
import { createSqliteStore, createBlankCards, registerMember, releasePhysicalCard, listPhysicalCards, markPhysicalCard, getMemberDetail, setSettings, setMemberNumberMode, bindExistingMembersToDemoCards, cardUsageHistory, walletTx, setMemberStatus } from "./sqliteStore";

describe("reusable physical cards", () => {
  it("hides archived cards and blocks assignment without deleting history", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["ARCHIVED-001"]);
      const member = registerMember(db, { firstName: "Archive", lastName: "Test", cardNumber: "ARCHIVED-001" }).member;
      releasePhysicalCard(db, "ARCHIVED-001");
      const history = cardUsageHistory(db, "ARCHIVED-001");
      db.prepare("UPDATE physical_cards SET archived_at = CURRENT_TIMESTAMP WHERE card_number = ?").run("ARCHIVED-001");
      expect(listPhysicalCards(db, "all", "ARCHIVED-001")).toEqual([]);
      expect(cardUsageHistory(db, "ARCHIVED-001")).toEqual(history);
      expect(() => assignMemberCard(db, { memberNumber: member.memberNumber, cardNumber: "ARCHIVED-001" })).toThrow();
      expect(getMemberDetail(db, member.memberNumber)?.member.cardNumber).toBeNull();
    } finally { db.close(); }
  });
  it("generates consecutive numbers across batches, existing codes and statuses", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["GEN-00007", "GEN-other", "OTHER-99999"], "Creator");
      expect(previewGeneratedCards(db, "GEN-", 5, 2).first).toBe("GEN-00008");
      expect(listPhysicalCards(db)).toHaveLength(3);
      expect(generateBlankCards(db, "GEN-", 5, 2, "Generator").codes).toEqual(["GEN-00008", "GEN-00009"]);
      markPhysicalCard(db, "GEN-00009", "damaged");
      expect(generateBlankCards(db, "GEN-", 5, 1).first).toBe("GEN-00010");
      expect(listPhysicalCards(db).find(c => c.cardNumber === "GEN-00008")?.createdBy).toBe("Generator");
      const member = registerMember(db, { firstName: "Generated", lastName: "Card", cardNumber: "GEN-00008" }).member;
      expect(member.cardNumber).toBe("GEN-00008");
      expect(() => createBlankCards(db, ["GEN-00008"])).toThrow();
    } finally { db.close(); }
  });
  it("rejects exhausted ranges and invalid inputs without creating cards", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["X-998"]);
      expect(() => generateBlankCards(db, "X-", 3, 2)).toThrow();
      expect(() => generateBlankCards(db, "invalid/", 5, 2)).toThrow();
      expect(() => generateBlankCards(db, "X-", 3, 0)).toThrow();
      expect(listPhysicalCards(db)).toHaveLength(1);
      expect(generateBlankCards(db, "X-", 3, 1).first).toBe("X-999");
    } finally { db.close(); }
  });
  it("returns with explicit balance handling and rejects a previous holder", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["RETURN-CARD"]);
      const first = registerMember(db, { firstName: "First", lastName: "User", cardNumber: "RETURN-CARD", initialDeposit: 100 }).member;
      const session = cardUsageHistory(db, "RETURN-CARD").sessions[0];
      expect(() => returnMemberCard(db, { memberNumber: first.memberNumber, cardNumber: "RETURN-CARD", expectedSessionId: session.id, mode: "keep_balance" as "refund" })).toThrow();
      expect(getMemberDetail(db, first.memberNumber)?.member).toMatchObject({ balance: 100, cardNumber: "RETURN-CARD" });
      returnMemberCard(db, { memberNumber: first.memberNumber, cardNumber: "RETURN-CARD", expectedSessionId: session.id, mode: "refund" });
      expect(getMemberDetail(db, first.memberNumber)?.member).toMatchObject({ balance: 0, cardNumber: null });
      const second = registerMember(db, { firstName: "Second", lastName: "User", cardNumber: "RETURN-CARD", initialDeposit: 50 }).member;
      expect(() => returnMemberCard(db, { memberNumber: first.memberNumber, cardNumber: "RETURN-CARD", expectedSessionId: session.id, mode: "refund" })).toThrow("เปลี่ยนผู้ถือ");
      const next = cardUsageHistory(db, "RETURN-CARD").sessions[0];
      returnMemberCard(db, { memberNumber: second.memberNumber, cardNumber: "RETURN-CARD", expectedSessionId: next.id, mode: "refund", clientRequestId: "RETURN-TEST" });
      expect(getMemberDetail(db, second.memberNumber)?.member).toMatchObject({ balance: 0, cardNumber: null });
      expect(cardUsageHistory(db, "RETURN-CARD").sessions[0]).toMatchObject({ incoming: 50, outgoing: 50, closingBalance: 0 });
      expect(getMemberDetail(db, first.memberNumber)?.member.balance).toBe(0);
    } finally { db.close(); }
  });
  it("replaces cards atomically and rejects stale holding rounds", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["OLD", "NEW", "BUSY"]);
      const member = registerMember(db, { firstName: "First", lastName: "Holder", cardNumber: "OLD", initialDeposit: 100 }).member;
      registerMember(db, { firstName: "Other", lastName: "Holder", cardNumber: "BUSY" });
      const session = cardUsageHistory(db, "OLD").sessions[0];
      const input = { memberNumber: member.memberNumber, expectedCardNumber: "OLD", expectedSessionId: session.id, actor: "Staff" };
      expect(() => assignMemberCard(db, { ...input, cardNumber: "BUSY" })).toThrow();
      expect(getMemberDetail(db, member.memberNumber)?.member.cardNumber).toBe("OLD");
      expect(cardUsageHistory(db, "OLD").sessions[0].endedAt).toBeNull();
      expect(() => assignMemberCard(db, { ...input, cardNumber: "NEW", previousCardStatus: "lost" })).toThrow();
      expect(getMemberDetail(db, member.memberNumber)?.member).toMatchObject({ balance: 100, cardNumber: "OLD" });
      returnMemberCard(db, { memberNumber: member.memberNumber, cardNumber: "OLD", expectedSessionId: session.id, mode: "refund", actor: "Staff" });
      assignMemberCard(db, { memberNumber: member.memberNumber, expectedCardNumber: null, cardNumber: "NEW", actor: "Staff" });
      expect(getMemberDetail(db, member.memberNumber)?.member).toMatchObject({ balance: 0, cardNumber: "NEW" });
    } finally { db.close(); }
  });
  it("simulates suspension, withdrawal, full refund, retry and reuse without mixing rounds", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["SIM-CARD"], "Creator");
      const first = registerMember(db, { firstName: "First", lastName: "User", cardNumber: "SIM-CARD", initialDeposit: 100 });
      const number = first.member.memberNumber;
      setMemberStatus(db, number, true);
      expect(listPhysicalCards(db)[0].status).toBe("assigned");
      expect(() => walletTx(db, { memberNumber: number, type: "withdrawal", amount: 10 })).toThrow();
      setMemberStatus(db, number, false);
      walletTx(db, { memberNumber: number, type: "withdrawal", amount: 20 });
      expect(listPhysicalCards(db)[0].status).toBe("assigned");
      const refund = { memberNumber: number, type: "refund" as const, amount: 80, clientRequestId: "SIM-REFUND", actor: "Receiver" };
      walletTx(db, refund);
      walletTx(db, refund);
      expect(listPhysicalCards(db)[0].status).toBe("returned_vacant");
      expect(getMemberDetail(db, number)?.member).toMatchObject({ balance: 0, cardNumber: null });
      registerMember(db, { firstName: "Second", lastName: "User", cardNumber: "SIM-CARD", initialDeposit: 50 });
      const history = cardUsageHistory(db, "SIM-CARD");
      expect(history.sessions[1]).toMatchObject({ closingBalance: 0, incoming: 100, outgoing: 100, transactionCount: 3 });
      expect(history.sessions[0]).toMatchObject({ incoming: 50, outgoing: 0, transactionCount: 1 });
    } finally { db.close(); }
  });
  it("isolates activation and later transactions by card holding round", () => {
    const db = createSqliteStore();
    try {
      createBlankCards(db, ["ROUND-CARD"], "Creator");
      const first = registerMember(db, { firstName: "First", lastName: "Holder", cardNumber: "ROUND-CARD", initialDeposit: 100, actor: "Issuer A" });
      const firstRound = cardUsageHistory(db, "ROUND-CARD").sessions[0];
      expect(firstRound).toMatchObject({ memberName: "First Holder", openingBalance: 0, incoming: 100, transactionCount: 1, openedBy: "Issuer A" });
      walletTx(db, { memberNumber: first.member.memberNumber, type: "refund", amount: 100, actor: "Receiver" });
      const second = registerMember(db, { firstName: "Second", lastName: "Holder", cardNumber: "ROUND-CARD", initialDeposit: 20, actor: "Issuer B" });
      const history = cardUsageHistory(db, "ROUND-CARD");
      expect(history.sessions).toHaveLength(2);
      expect(history.sessions[0]).toMatchObject({ memberNumber: second.member.memberNumber, incoming: 20, openingBalance: 0, endedAt: null });
      expect(history.sessions[1]).toMatchObject({ id: firstRound.id, memberNumber: first.member.memberNumber, incoming: 100, closingBalance: 0, closedBy: "Receiver" });
      expect(history.transactions.filter(t => t.sessionId === firstRound.id)).toHaveLength(2);
      expect(history.transactions.filter(t => t.sessionId === history.sessions[0].id)).toHaveLength(1);
      expect(listPhysicalCards(db)[0].createdBy).toBe("Creator");
      expect(getMemberDetail(db, first.member.memberNumber)?.member.balance).toBe(0);
    } finally { db.close(); }
  });
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
      expect(() => releasePhysicalCard(db, "CARD-001", "Staff")).toThrow();
      walletTx(db, { memberNumber: first.member.memberNumber, type: "refund", amount: 100 });
      expect(getMemberDetail(db, first.member.memberNumber)?.member).toMatchObject({ balance: 0, cardNumber: null });
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