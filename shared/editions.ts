/**
 * ROUND 61 (user) — ระบบเวอร์ชันแอป 3 แบบ: ทั่วไป / โปร / โปรพลัส
 * -----------------------------------------------------------------
 * ตารางสิทธิ์ชุดเดียวใช้ทั้งฝั่งเซิร์ฟเวอร์ (gate ใน tRPC procedures) และ
 * ฝั่งหน้าจอ (ซ่อน/ล็อกปุ่ม) — แก้สิทธิ์ของแต่ละเวอร์ชันที่นี่ที่เดียว
 *
 * หลักการ: "ลงใหม่ = ไม่มีข้อมูล + ทดลองใช้โปรพลัส 30 วัน" — หมดอายุทดลอง
 * (หรือไม่เคยเริ่ม) ระบบกลับเป็นเวอร์ชันทั่วไปจนกว่าจะใส่รหัสลิขสิทธิ์
 * (ออกรหัสได้ที่ ตั้งค่า → โซนผู้พัฒนา → เครื่องมือติดตั้ง สำหรับเจ้าของระบบ)
 */

export type Edition = "standard" | "pro" | "proplus";

/** ลำดับระดับเวอร์ชัน (ใช้เทียบ "อย่างน้อยเท่ากับ") */
export const EDITION_LEVEL: Record<Edition, number> = { standard: 1, pro: 2, proplus: 3 };

/** จำนวนวันทดลองใช้โปรพลัสของระบบใหม่ */
export const EDITION_TRIAL_DAYS = 30;

/** ผู้ใช้ทั่วไปจำกัดจำนวนบัญชี · โปร/โปรพลัสไม่จำกัด */
export const STANDARD_MAX_USERS = 3;

export const EDITIONS: Record<Edition, { id: Edition; label: string; shortLabel: string; caption: string; tone: string }> = {
  standard: {
    id: "standard",
    label: "เวอร์ชันทั่วไป",
    shortLabel: "ทั่วไป",
    caption: "POS ขายหน้าร้าน · สมาชิกและบัญชี · สต็อกพื้นฐาน · รายงานยอดขาย",
    tone: "slate",
  },
  pro: {
    id: "pro",
    label: "เวอร์ชันโปร",
    shortLabel: "โปร",
    caption: "ฟังก์ชันเวอร์ชันทั่วไป พร้อมนำเข้า–ส่งออก Excel รายงานขั้นสูง และสำรองข้อมูล",
    tone: "blue",
  },
  proplus: {
    id: "proplus",
    label: "เวอร์ชันโปรพลัส",
    shortLabel: "โปรพลัส",
    caption: "ฟังก์ชันเวอร์ชันโปร พร้อมนับสต็อก สแกนด้วยกล้อง และรายการพิเศษ",
    tone: "amber",
  },
};

export type EditionFeatureKey =
  | "pos"
  | "members"
  | "stockBasic"
  | "reportsBasic"
  | "dayClose"
  | "branding"
  | "usersLimited"
  | "importExport"
  | "reportsAdvanced"
  | "backupRestore"
  | "usersUnlimited"
  | "stockCount"
  | "cameraScan"
  | "specialOrders"
  | "devZone";

export const EDITION_FEATURES: Record<Edition, EditionFeatureKey[]> = {
  standard: ["pos", "members", "stockBasic", "reportsBasic", "dayClose", "branding", "usersLimited"],
  pro: ["pos", "members", "stockBasic", "reportsBasic", "dayClose", "branding", "usersUnlimited", "importExport", "reportsAdvanced", "backupRestore"],
  proplus: [
    "pos",
    "members",
    "stockBasic",
    "reportsBasic",
    "dayClose",
    "branding",
    "usersUnlimited",
    "importExport",
    "reportsAdvanced",
    "backupRestore",
    "stockCount",
    "cameraScan",
    "specialOrders",
    "devZone",
  ],
};

/** คำอธิบายฟีเจอร์แต่ละตัว — ใช้ทั้งตารางเทียบเวอร์ชันและข้อความล็อก */
export const EDITION_FEATURE_INFO: Record<EditionFeatureKey, { label: string; detail: string }> = {
  pos: { label: "หน้าร้าน POS", detail: "ขายสินค้า รับชำระ 3 วิธี พิมพ์ใบเสร็จ พักบิล ค้นหาสินค้า" },
  members: { label: "สมาชิกและบัญชี", detail: "ลงทะเบียนสมาชิก เติม–ถอนเงิน บัตรสมาชิก ประวัติธุรกรรม วงเงินรายวัน" },
  stockBasic: { label: "สต็อกพื้นฐาน", detail: "รับเข้าเป็นล็อต ปรับยอด ติดตามวันหมดอายุ แจ้งเตือนสต็อกต่ำ" },
  reportsBasic: { label: "รายงานพื้นฐาน", detail: "ยอดขายรายวัน · ตามหมวดสินค้า · ประวัติบิล · ตัดยอดรายวัน" },
  dayClose: { label: "ตัดยอดประจำวัน", detail: "สรุปยอดตามรอบเวลา ปิดรอบขาย พิมพ์ใบตัดยอด" },
  branding: { label: "ปรับแบรนด์และธีม", detail: "ชื่อร้าน โลโก้ สีธีม สไตล์แอป ขนาดตัวอักษร" },
  usersLimited: { label: `บัญชีผู้ใช้ (สูงสุด ${STANDARD_MAX_USERS} บัญชี)`, detail: "แยกบัญชีตามจุดขาย กำหนดสิทธิ์ เจ้าหน้าที่/ผู้บริหาร" },
  usersUnlimited: { label: "บัญชีผู้ใช้ไม่จำกัด", detail: "เพิ่มผู้ใช้ได้ตามจุดขายจริง ไม่จำกัดจำนวนบัญชี" },
  importExport: { label: "นำเข้า–ส่งออกข้อมูล", detail: "เทมเพลต Excel สำหรับขึ้นระบบ นำเข้าสินค้า/สมาชิก ส่งออก CSV/Excel/PDF" },
  reportsAdvanced: { label: "รายงานขั้นสูง", detail: "ยอดขายตามสินค้า · ตามพนักงานขาย · รายการในบิล · ธุรกรรมสมาชิก" },
  backupRestore: { label: "สำรองและกู้คืนข้อมูล", detail: "สำรองตามรอบเวลา ดาวน์โหลดไฟล์ และกู้คืนจากไฟล์สำรอง" },
  stockCount: { label: "งานนับสต็อก", detail: "พิมพ์ใบนับ A4 บันทึกผลนับรวม/แยกล็อต และปรับยอดสต็อก" },
  cameraScan: { label: "กล้องสแกนบาร์โค้ด", detail: "ใช้กล้องมือถือ/แท็บเล็ตสแกนสินค้าและบัตรสมาชิก" },
  specialOrders: { label: "รายการพิเศษ / ของสั่ง", detail: "ขายของสั่ง ค่าบริการ สินค้าชั่งน้ำหนัก นอกแคตตาล็อก" },
  devZone: { label: "โซนผู้พัฒนา", detail: "เครื่องมือติดตั้งระบบ ตรวจรับข้อมูล รายการตรวจสอบก่อนใช้งาน ออกรหัสลิขสิทธิ์" },
};

/** แถวที่แสดงในตารางเทียบเวอร์ชัน (เรียงตามกลุ่ม) */
export const EDITION_COMPARE_ROWS: EditionFeatureKey[] = [
  "pos",
  "members",
  "stockBasic",
  "reportsBasic",
  "dayClose",
  "branding",
  "usersLimited",
  "usersUnlimited",
  "importExport",
  "reportsAdvanced",
  "backupRestore",
  "stockCount",
  "cameraScan",
  "specialOrders",
  "devZone",
];

export function editionHas(edition: Edition, feature: EditionFeatureKey): boolean {
  return EDITION_FEATURES[edition]?.includes(feature) ?? false;
}

export function editionAtLeast(edition: Edition, minimum: Edition): boolean {
  return (EDITION_LEVEL[edition] ?? 0) >= EDITION_LEVEL[minimum];
}

/** ป้ายสถานย่อ เช่น "ทดลองใช้ · เหลือ 12 วัน" */
export function editionStatusLabel(status: {
  edition: Edition;
  source: "license" | "trial" | "free";
  trialDaysLeft?: number | null;
}): string {
  if (status.source === "trial") {
    const left = status.trialDaysLeft ?? 0;
    return `ทดลองใช้โปรพลัส · เหลือ ${left} วัน`;
  }
  if (status.source === "license") return `ลิขสิทธิ์ ${EDITIONS[status.edition]?.shortLabel ?? ""}`.trim();
  return EDITIONS[status.edition]?.label ?? "เวอร์ชันทั่วไป";
}
