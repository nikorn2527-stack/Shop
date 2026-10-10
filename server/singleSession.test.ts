import { describe, expect, it } from "vitest";
import { authenticateAppSession, createAppSession, createAppUser, createSqliteStore, listAppSessions } from "./sqliteStore";
describe("one active session per account", () => {
  it("revokes the old session when a new one is created without affecting other accounts", () => {
    const db = createSqliteStore();
    try {
      const user = createAppUser(db, { username: "sessionone", displayName: "Session One", password: "Password123!", role: "staff" });
      const other = createAppUser(db, { username: "sessiontwo", displayName: "Session Two", password: "Password123!", role: "staff" });
      const old = createAppSession(db, user.id);
      const otherSession = createAppSession(db, other.id);
      const current = createAppSession(db, user.id);
      expect(authenticateAppSession(db, old.sessionId)).toBeUndefined();
      expect(authenticateAppSession(db, current.sessionId)?.id).toBe(user.id);
      expect(authenticateAppSession(db, otherSession.sessionId)?.id).toBe(other.id);
      expect(listAppSessions(db).filter(s => s.username === user.username)).toHaveLength(1);
    } finally { db.close(); }
  });
  it("does not expire after five minutes of inactivity and records last contact", () => {
    const db = createSqliteStore();
    try {
      const user = createAppUser(db, { username: "sessionday", displayName: "Session Day", password: "Password123!", role: "staff" });
      const session = createAppSession(db, user.id);
      db.prepare("UPDATE app_sessions SET last_seen_at='2000-01-01 00:00:00' WHERE id=?").run(session.sessionId);
      expect(authenticateAppSession(db, session.sessionId)?.id).toBe(user.id);
      expect(listAppSessions(db)[0].lastSeenAt).not.toBe("2000-01-01 00:00:00");
    } finally { db.close(); }
  });
});