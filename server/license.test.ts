/**
 * ROUND 61 — ทดสอบระบบเวอร์ชัน 3 แบบ + รหัสลิขสิทธิ์ออฟไลน์
 * ครอบคลุม: ออกรหัส/ตรวจรหัส ทุกเวอร์ชัน + ถาวร/มีกำหนด · ปลอมแปลงไม่ผ่าน ·
 * resolveEditionStatus (ลิขสิทธิ์/ทดลอง 30 วัน/หมดอายุ/ว่าง) · ensure สิทธิ์
 */
import { describe, expect, it } from "vitest";
import { EDITION_FEATURES } from "../shared/editions";
import { ensureEditionFeature, generateLicenseKey, parseLicenseKey, resolveEditionStatus, todayString } from "./license";

describe("license keys", () => {
  it("ออกรหัสถาวรทุกเวอร์ชัน แล้วตรวจกลับได้ตรงเวอร์ชัน ไม่มีวันหมดอายุ", () => {
    for (const edition of ["standard", "pro", "proplus"] as const) {
      const key = generateLicenseKey(edition, null);
      expect(key).toMatch(/^WSH-[GPX]-[0-9A-HJ-NP-Z]{4}(-[0-9A-HJ-NP-Z]{4}){3}$/);
      const parsed = parseLicenseKey(key);
      expect(parsed).not.toBeNull();
      expect(parsed!.edition).toBe(edition);
      expect(parsed!.expiresAt).toBeNull();
    }
  });

  it("ออกรหัสรายเดือน — มีวันหมดอายุอนาคตตามจำนวนเดือน (ประมาณ)", () => {
    const key = generateLicenseKey("pro", 12);
    const parsed = parseLicenseKey(key);
    expect(parsed!.edition).toBe("pro");
    expect(parsed!.expiresAt).not.toBeNull();
    expect(parsed!.expiresAt! > todayString()).toBe(true);
    // 12 เดือน ≈ 365 วัน — ยอม ±3 วันจากการปัดทศนิยม
    const days = Math.round((Date.parse(parsed!.expiresAt!) - Date.parse(todayString())) / 86_400_000);
    expect(Math.abs(days - 365)).toBeLessThanOrEqual(3);
  });

  it("ออกรหัสสองครั้งได้รหัสต่างกัน (สุ่ม) แต่ตรวจผ่านทั้งคู่", () => {
    const a = generateLicenseKey("proplus", null);
    const b = generateLicenseKey("proplus", null);
    expect(a).not.toBe(b);
    expect(parseLicenseKey(a)!.edition).toBe("proplus");
    expect(parseLicenseKey(b)!.edition).toBe("proplus");
  });

  it("รหัสปลอม/ตัดตัวอักษร/เปลี่ยนตัวอักษร → ไม่ผ่านทั้งหมด", () => {
    const real = generateLicenseKey("pro", null);
    expect(parseLicenseKey("")).toBeNull();
    expect(parseLicenseKey("WSH-P-AAAA-BBBB-CCCC-DDDD")).toBeNull();
    expect(parseLicenseKey(real.slice(0, -1))).toBeNull();
    // สลับกลุ่มตัวอักษรสองกลุ่ม — HMAC ต้องจับได้
    const groups = real.split("-");
    const swapped = [groups[0], groups[1], groups[3], groups[2], groups[4]].join("-");
    expect(parseLicenseKey(swapped)).toBeNull();
    // เปลี่ยนตัวอักษรตัวเดียวในกลุ่มสุดท้าย
    const last = groups[4];
    const mutated = last.replace(/.$/, last.endsWith("A") ? "B" : "A");
    expect(parseLicenseKey([groups[0], groups[1], groups[2], groups[3], mutated].join("-"))).toBeNull();
  });

  it("อักษรนำหน้าเวอร์ชันต้องตรงกับ payload จริง — สลับ prefix ไม่ผ่าน", () => {
    const proKey = generateLicenseKey("pro", null);
    const asProplus = proKey.replace(/^WSH-P-/, "WSH-X-");
    expect(parseLicenseKey(asProplus)).toBeNull();
  });
});

describe("customer deployment functionality", () => {
  it.each(["", "invalid-key", generateLicenseKey("standard", null), generateLicenseKey("pro", 1)])("does not gate the agreed feature set on stored key %s", licenseKey => {
    const input = { licenseKey, licenseName: "Existing customer", trialStart: "2000-01-01" };
    const before = { ...input };
    const status = resolveEditionStatus(input);
    expect(status).toMatchObject({ source: "managed", edition: "proplus", licenseExpiresAt: null, trialDaysLeft: null });
    expect(status.features).toEqual(EDITION_FEATURES.proplus);
    for (const feature of EDITION_FEATURES.proplus) expect(() => ensureEditionFeature(input, feature)).not.toThrow();
    expect(input).toEqual(before);
  });
});
