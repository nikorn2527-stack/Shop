/**
 * ROUND 61 (user) — รหัสลิขสิทธิ์แบบออฟไลน์ สำหรับระบบเวอร์ชัน 3 แบบ
 * -------------------------------------------------------------------
 * รูปแบบรหัส: `WSH-<P|X|G>-XXXX-XXXX-XXXX-XXXX`
 *   - อักษรนำหน้าบอกเวอร์ชัน (P=โปร, X=โปรพลัส, G=ทั่วไป) เพื่ออ่านง่าย
 *   - ส่วนตัวเลข 16 อักษร = base32(Crockford) ของ 10 ไบต์:
 *       [0]      เวอร์ชัน (1=ทั่วไป, 2=โปร, 3=โปรพลัส)
 *       [1..2]   วันหมดอายุเป็นจำนวนวันนับจาก 2025-01-01 (uint16 BE, 0xFFFF = ถาวร)
 *       [3..5]   สุ่ม 3 ไบต์ (ให้แต่ละรหัสต่างกัน)
 *       [6..9]   HMAC-SHA256(secret, ไบต์ 0..5) 4 ไบต์ — ปลอมแปลงไม่ได้โดยไม่รู้ secret
 *
 * การใช้งาน: เจ้าของระบบออกรหัสให้ลูกค้าที่ ตั้งค่า → โซนผู้พัฒนา → เครื่องมือติดตั้ง
 * ลูกค้านำรหัสมาใส่ที่ ตั้งค่า → เวอร์ชันและลิขสิทธิ์ (ออนไลน์ไม่จำเป็น)
 *
 * หมายเหตุความปลอดภัย: ระบบนี้เป็นการกำหนดสิทธิ์ระดับ "จัดการเชิงพาณิชย์"
 * (ลูกค้าทั่วไปแกะไม่ได้) ไม่ใช่การป้องกันผู้เชี่ยวชาญ — ฐานข้อมูลทั้งหมด
 * อยู่ในเครื่องลูกค้าอยู่แล้วตามลักษณะระบบออฟไลน์
 */
import { createHmac, randomBytes } from "node:crypto";
import { EDITION_TRIAL_DAYS, EDITION_FEATURES, EDITION_FEATURE_INFO, EDITIONS, editionHas, type Edition, type EditionFeatureKey } from "@/lib/editions";
import { StoreError, type StoreSettings } from "./sqliteStore";

/**
 * กุญแจลับสำหรับเซ็นรหัสลิขสิทธิ์ — เจ้าของระบบถือไว้เพียงฝ่ายเดียว
 * (ออกรหัสได้เฉพาะเครื่องที่รู้ค่านี้ · เปลี่ยนได้ แต่รหัสเก่าจะใช้ไม่ได้ทั้งหมด)
 */
const LICENSE_SECRET = "PNG-WelfareShop-2568-edition-key";

const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford ตัด I L O U
const EPOCH_DAY_ZERO = Date.UTC(2025, 0, 1); // วันอ้างอิงนับวันหมดอายุ
const EDITION_IDS: Record<Edition, number> = { standard: 1, pro: 2, proplus: 3 };
const EDITION_BY_ID: Record<number, Edition> = { 1: "standard", 2: "pro", 3: "proplus" };
const EDITION_PREFIX: Record<Edition, string> = { standard: "G", pro: "P", proplus: "X" };
const PREFIX_TO_EDITION: Record<string, Edition> = { G: "standard", P: "pro", X: "proplus" };

function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let index = 0; index < bytes.length; index += 1) {
    value = (value << 8) | bytes[index]!;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function fromBase32(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function sign(payload: Buffer): Buffer {
  return createHmac("sha256", LICENSE_SECRET).update(payload).digest().subarray(0, 4);
}

/** วันที่ปัจจุบัน "YYYY-MM-DD" (ท้องถิ่น — อายุทดลองนับตามปฏิทินร้าน) */
export function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dayNumberFromDateString(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const days = Math.floor((utc - EPOCH_DAY_ZERO) / 86_400_000);
  return days >= 0 && days < 0xffff ? days : null;
}

function dateStringFromDayNumber(day: number): string {
  const utc = EPOCH_DAY_ZERO + day * 86_400_000;
  const date = new Date(utc);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${dayOfMonth}`;
}

export type LicenseKeyInfo = {
  edition: Edition;
  /** วันหมดอายุ "YYYY-MM-DD" · null = ถาวร */
  expiresAt: string | null;
};

/** ออกรหัสลิขสิทธิ์ · months = null → ถาวร · 1-48 → หมดอายุตามจำนวนเดือนจากวันนี้ */
export function generateLicenseKey(edition: Edition, months: number | null): string {
  const editionId = EDITION_IDS[edition];
  if (!editionId) throw new Error(`เวอร์ชันไม่ถูกต้อง: ${String(edition)}`);
  let expiryDay = 0xffff;
  if (months !== null) {
    const clean = Math.max(1, Math.min(48, Math.floor(months)));
    expiryDay = Math.min(0xfffe, dayNumberFromDateString(todayString())! + Math.round(clean * 30.44));
  }
  const payload = Buffer.alloc(6);
  payload.writeUInt8(editionId, 0);
  payload.writeUInt16BE(expiryDay, 1);
  payload.set(randomBytes(3), 3);
  const signed = Buffer.concat([payload, sign(payload)]);
  const groups = toBase32(signed).slice(0, 16).match(/.{1,4}/g) ?? [];
  return `WSH-${EDITION_PREFIX[edition]}-${groups.join("-")}`;
}

/** ตรวจรหัสลิขสิทธิ์ → ข้อมูลเวอร์ชัน/วันหมดอายุ · null = รหัสไม่ถูกต้อง */
export function parseLicenseKey(rawKey: string): LicenseKeyInfo | null {
  const cleaned = rawKey.trim().toUpperCase().replace(/\s+/g, "");
  const match = /^WSH-([GPX])-((?:[0-9A-HJ-NP-Z]{4}-?){4})$/.exec(cleaned);
  if (!match) return null;
  const prefixEdition = PREFIX_TO_EDITION[match[1]];
  const body = match[2].replace(/-/g, "");
  if (body.length !== 16) return null;
  let bytes: Buffer;
  try {
    bytes = fromBase32(body);
  } catch {
    return null;
  }
  if (bytes.length !== 10) return null;
  const payload = bytes.subarray(0, 6);
  const mac = bytes.subarray(6, 10);
  const expected = sign(payload);
  if (!mac.equals(expected)) return null;
  const editionId = payload.readUInt8(0);
  const edition = EDITION_BY_ID[editionId];
  if (!edition || edition !== prefixEdition) return null;
  const expiryDay = payload.readUInt16BE(1);
  return { edition, expiresAt: expiryDay >= 0xffff ? null : dateStringFromDayNumber(expiryDay) };
}

export type EditionStatus = {
  edition: Edition;
  source: "license" | "trial" | "free";
  /** ชื่อผู้ถือลิขสิทธิ์ (พิมพ์ตอนใช้รหัส) */
  licensedTo: string | null;
  /** วันหมดอายุลิขสิทธิ์ "YYYY-MM-DD" · null = ถาวร */
  licenseExpiresAt: string | null;
  /** สถานะลิขสิทธิ์ที่เก็บไว้ — "valid" | "expired" | "none" */
  licenseState: "valid" | "expired" | "none";
  /** วันที่เริ่มทดลองใช้ */
  trialStart: string | null;
  /** จำนวนวันทดลองที่เหลือ (นับจาก trialStart) · null = ไม่ได้อยู่ในช่วงทดลอง */
  trialDaysLeft: number | null;
  features: EditionFeatureKey[];
};

/**
 * สรุปเวอร์ชันที่ใช้งานจริงจาก settings:
 * ลิขสิทธิ์ที่ยังไม่หมดอายุ → ตามรหัส · ไม่มีรหัสแต่อยู่ในช่วงทดลอง 30 วัน → โปรพลัส (ทดลอง)
 * · นอกเหนือจากนี้ → ทั่วไป
 */
export function resolveEditionStatus(settings: Pick<StoreSettings, "licenseKey" | "licenseName" | "trialStart">): EditionStatus {
  const key = (settings.licenseKey ?? "").trim();
  const trialStart = (settings.trialStart ?? "").trim();
  let licenseState: EditionStatus["licenseState"] = "none";
  let licenseExpiresAt: string | null = null;
  let licensedEdition: Edition | null = null;
  if (key) {
    const parsed = parseLicenseKey(key);
    if (parsed) {
      licenseExpiresAt = parsed.expiresAt;
      if (parsed.expiresAt === null || parsed.expiresAt >= todayString()) {
        licensedEdition = parsed.edition;
        licenseState = "valid";
      } else {
        licenseState = "expired";
      }
    }
  }
  let trialDaysLeft: number | null = null;
  const todayDays = dayNumberFromDateString(todayString());
  if (!licensedEdition && trialStart && todayDays !== null) {
    const startDays = dayNumberFromDateString(trialStart);
    if (startDays !== null) {
      const elapsed = todayDays - startDays;
      if (elapsed >= 0 && elapsed < EDITION_TRIAL_DAYS) trialDaysLeft = EDITION_TRIAL_DAYS - elapsed;
    }
  }
  const edition: Edition = licensedEdition ?? (trialDaysLeft !== null ? "proplus" : "standard");
  return {
    edition,
    source: licensedEdition ? "license" : trialDaysLeft !== null ? "trial" : "free",
    licensedTo: licensedEdition ? (settings.licenseName ?? "").trim() || null : null,
    licenseExpiresAt: licensedEdition ? licenseExpiresAt : null,
    licenseState,
    trialStart: trialStart || null,
    trialDaysLeft,
    features: EDITION_FEATURES[edition] ?? EDITION_FEATURES.standard,
  };
}

/** ข้อความไทยสำหรับ feature ที่ถูกล็อก — ใช้ทั้งฝั่งเซิร์ฟเวอร์ (TRPCError) และ UI */
export function editionFeatureLockedMessage(status: EditionStatus, feature: EditionFeatureKey): string {
  const label = EDITION_FEATURE_INFO[feature]?.label ?? feature;
  return `ฟีเจอร์ “${label}” ไม่รวมอยู่ใน${EDITIONS[status.edition]?.label ?? "เวอร์ชันปัจจุบัน"}${
    status.source === "trial" ? " (ช่วงทดลองใช้)" : ""
  } — ดูรายละเอียดและเปิดใช้งานได้ที่ ตั้งค่า → เวอร์ชันและลิขสิทธิ์`;
}

/** ฟังก์ชันตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ — โยน StoreError (ข้อความไทย) เมื่อเวอร์ชันยังไม่รวมฟีเจอร์นี้ */
export function ensureEditionFeature(settings: Pick<StoreSettings, "licenseKey" | "licenseName" | "trialStart">, feature: EditionFeatureKey): EditionStatus {
  const status = resolveEditionStatus(settings);
  if (!editionHas(status.edition, feature)) {
    throw new StoreError(editionFeatureLockedMessage(status, feature));
  }
  return status;
}
