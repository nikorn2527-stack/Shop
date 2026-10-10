import { describe, expect, it } from "vitest";
import { createSqliteStore, findExistingMembers, registerMember } from "./sqliteStore";

describe("returning member identification", () => {
  it("checks optional identity and phone when supplied, without matching empty values", () => {
    const db = createSqliteStore();
    try {
      const member = registerMember(db, { firstName: "One", lastName: "Person", citizenId: "1234567890123", phone: "0812345678" }).member;
      expect(findExistingMembers(db, { firstName: "Other", lastName: "Name", citizenId: "1-2345-67890-12-3" })[0]).toMatchObject({ memberNumber: member.memberNumber, reason: "citizenId" });
      expect(findExistingMembers(db, { firstName: "Other", lastName: "Name", phone: "081-234-5678" })[0].reason).toBe("phone");
      expect(findExistingMembers(db, { firstName: "Other", lastName: "Name" })).toEqual([]);
      expect(() => registerMember(db, { firstName: "Other", lastName: "Name", citizenId: "1234567890123" })).toThrow(member.memberNumber);
    } finally { db.close(); }
  });
  it("finds former members using names only", () => {
    const db = createSqliteStore();
    try {
      const member = registerMember(db, { firstName: "Somchai", lastName: "Test" }).member;
      db.prepare("UPDATE members SET status='suspended' WHERE member_number=?").run(member.memberNumber);
      expect(findExistingMembers(db, { firstName: " Som chai ", lastName: "Test" })[0]).toMatchObject({ memberNumber: member.memberNumber, reason: "name", status: "suspended" });
      expect(findExistingMembers(db, { firstName: "Other", lastName: "Person" })).toEqual([]);
    } finally { db.close(); }
  });
  it("does not treat shared names as proof of the same identity", () => {
    const db = createSqliteStore();
    try {
      registerMember(db, { firstName: "Same", lastName: "Name", citizenId: "1111111111111" });
      expect(() => registerMember(db, { firstName: "Same", lastName: "Name", citizenId: "2222222222222" })).not.toThrow();
      expect(findExistingMembers(db, { firstName: "Same", lastName: "Name" })).toHaveLength(2);
    } finally { db.close(); }
  });
});