import { describe, expect, it } from "vitest";
import { openWelfareStore, getSettings, setSettings, listAuditLogs } from "./sqliteStore";

describe("login background settings", () => {
  it("keeps login and workspace images independent and omits image payloads from audit logs", () => {
    const db = openWelfareStore(":memory:");
    try {
      expect(getSettings(db).loginBackground).toBe("");
      const photo = "data:image/png;base64,YWJj";
      setSettings(db, { appBackground: photo });
      setSettings(db, { loginBackground: photo });
      expect(getSettings(db).loginBackground).toBe(photo);
      setSettings(db, { loginBackground: "" });
      expect(getSettings(db).loginBackground).toBe("");
      expect(getSettings(db).appBackground).toBe(photo);
      const logs = listAuditLogs(db).filter(log => log.action === "บันทึกการตั้งค่า");
      expect(logs).toHaveLength(3);
      expect(logs.some(log => log.detail.includes("นำภาพออก"))).toBe(true);
      expect(logs.some(log => log.detail.includes("มีภาพ"))).toBe(true);
      expect(logs.every(log => !log.detail.includes("base64"))).toBe(true);
    } finally { db.close(); }
  });
});
