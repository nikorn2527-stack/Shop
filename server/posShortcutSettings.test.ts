import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSqliteStore,
  getSettings,
  setSettings,
  type SqliteDb,
} from "./sqliteStore";
import { findPosShortcutConflicts } from "../shared/posShortcuts";
let db: SqliteDb;
beforeEach(() => {
  db = createSqliteStore();
});
afterEach(() => db.close());
describe("POS shortcut conflict protection", () => {
  it("rejects F2 for return card when deposit uses its unsaved default, without persisting other changes", () => {
    const before = getSettings(db);
    expect(() =>
      setSettings(db, {
        posShortcutKeys: '{"card":"F2"}',
        storeName: "Should not save",
        memberNumberMode: "manual",
      })
    ).toThrow(/F2.*เติมเงิน.*คืนบัตร/);
    expect(getSettings(db)).toEqual(before);
  });
  it("detects effective defaults, custom keys and case/whitespace equivalence", () => {
    expect(findPosShortcutConflicts('{"card":" f2 "}', "[]")[0]).toMatchObject({
      key: "F2",
      actions: ["deposit", "card"],
    });
    expect(
      findPosShortcutConflicts('{"card":"a","hold":" A "}', "[]")[0]
    ).toMatchObject({ key: "A", actions: ["card", "hold"] });
    expect(
      findPosShortcutConflicts('{"card":"F5","hold":"f2"}', "[]")[0]
    ).toMatchObject({ key: "F2", actions: ["deposit", "hold"] });
  });
  it("allows reuse when the other action is hidden, then blocks re-enabling it", () => {
    setSettings(db, {
      posShortcutKeys: '{"card":"F2"}',
      posRailHidden: '["deposit"]',
    });
    expect(() => setSettings(db, { posRailHidden: "[]" })).toThrow(/F2/);
    expect(getSettings(db).posRailHidden).toBe('["deposit"]');
    setSettings(db, { posShortcutKeys: '{"card":"F11"}', posRailHidden: "[]" });
    expect(getSettings(db).posShortcutKeys).toBe('{"card":"F11"}');
  });
  it("compares partial key updates against the stored visible actions", () => {
    setSettings(db, { posShortcutKeys: '{"deposit":"F11","card":"F2"}' });
    expect(() => setSettings(db, { posShortcutKeys: '{"card":"F2"}' })).toThrow(
      /F2/
    );
    expect(getSettings(db).posShortcutKeys).toBe(
      '{"deposit":"F11","card":"F2"}'
    );
  });
  it("does not count removed legacy actions or unassigned return card as conflicts", () => {
    expect(findPosShortcutConflicts('{"limit":"F2"}', "[]")).toEqual([]);
    expect(findPosShortcutConflicts("{}", "[]")).toEqual([]);
    expect(findPosShortcutConflicts('{"deposit":" "}', "[]")).toEqual([]);
    expect(findPosShortcutConflicts("not json", "{}")).toEqual([]);
  });
  it("allows unrelated settings edits on an old conflicting configuration and permits explicit repair", () => {
    const legacy = { ...getSettings(db), posShortcutKeys: '{"card":"F2"}' };
    db.prepare(
      "INSERT INTO store_settings (key,value) VALUES ('app_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).run(JSON.stringify(legacy));
    expect(
      findPosShortcutConflicts(getSettings(db).posShortcutKeys, "[]")
    ).toHaveLength(1);
    setSettings(db, { storeName: "Other setting" });
    setSettings(db, { posShortcutKeys: '{"card":"F11"}' });
    expect(
      findPosShortcutConflicts(getSettings(db).posShortcutKeys, "[]")
    ).toEqual([]);
  });
});
