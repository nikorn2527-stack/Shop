import { MEMBER_CARD_WIDTH_MM, MEMBER_CARD_HEIGHT_MM } from "./memberCardSize";
/**
 * P0-UX-02 part 2 — A4 sheet print profile system for member cards.
 *
 * รองรับการพิมพ์บัตรสมาชิกหลายใบลงแผ่น A4 สำหรับกระดาษนามบัตร/สติกเกอร์สำเร็จรูป
 * แต่ละ profile กำหนด: จำนวนคอลัมน์/แถว + ระยะขอบ + ช่องว่าง + offset X/Y (calibration)
 * สำหรับปรับแนวให้ตรงกับวัสดุจริง (เครื่องพิมพ์แต่ละรุ่นเหลื่อมต่างกัน)
 *
 * owner rule: "ห้ามใช้ template A4 แบบเดาเอง" — ต้องเลือก template ตามจำนวนดวงและ
 * ตำแหน่งจริงบน A4 + มี "พิมพ์แผ่นทดสอบ" + X/Y calibration
 *
 * บัตรขนาด ID-1 85.60 × 53.98 มม.
 */

export type CardSheetProfile = {
  id: string;
  name: string;
  /** จำนวนคอลัมน์ (แนวนอน) */
  cols: number;
  /** จำนวนแถว (แนวตั้ง) */
  rows: number;
  /** ความกว้างบัตร มม. (85.60 มาตรฐานบัตรเครดิต) */
  cardWmm: number;
  /** ความสูงบัตร มม. (53.98 มาตรฐานบัตรเครดิต) */
  cardHmm: number;
  /** ระยะขอบบน มม. */
  marginTopMm: number;
  /** ระยะขอบซ้าย มม. */
  marginLeftMm: number;
  /** ช่องว่างระหว่างบัตรแนวนอน มม. */
  gapXMm: number;
  /** ช่องว่างระหว่างบัตรแนวตั้ง มม. */
  gapYMm: number;
  /** calibration offset X มม. (บวก=ขยับขวา, ลบ=ขยับซ้าย) */
  offsetXMm: number;
  /** calibration offset Y มม. (บวก=ขยับลง, ลบ=ขยับขึ้น) */
  offsetYMm: number;
};

/**
 * Built-in presets สำหรับ A4 (210×297มม. portrait)
 * คำนวณระยะขอบให้ grid อยู่กลางหน้า:
 *  - ใช้บัตร ID-1 จัดกึ่งกลางแนวนอน ขอบซ้าย 19.4 มม.
 *  - เก็บระยะขอบ ช่องว่าง และ offset ที่เคยปรับไว้เมื่อย้ายจากโปรไฟล์เดิม
 */
export const BUILT_IN_PROFILES: CardSheetProfile[] = [
  { id: "a4-8", name: "A4 · 8 ใบ/แผ่น (2 × 4)", cols: 2, rows: 4, cardWmm: MEMBER_CARD_WIDTH_MM, cardHmm: MEMBER_CARD_HEIGHT_MM, marginTopMm: 8, marginLeftMm: 19.4, gapXMm: 0, gapYMm: 4, offsetXMm: 0, offsetYMm: 0 },
  { id: "a4-10", name: "A4 · 10 ใบ/แผ่น (2 × 5)", cols: 2, rows: 5, cardWmm: MEMBER_CARD_WIDTH_MM, cardHmm: MEMBER_CARD_HEIGHT_MM, marginTopMm: 5, marginLeftMm: 19.4, gapXMm: 0, gapYMm: 3, offsetXMm: 0, offsetYMm: 0 },
  { id: "custom", name: "กำหนดเอง — แก้ cols/rows/ขอบ/gap/offset", cols: 2, rows: 4, cardWmm: MEMBER_CARD_WIDTH_MM, cardHmm: MEMBER_CARD_HEIGHT_MM, marginTopMm: 8, marginLeftMm: 19.4, gapXMm: 0, gapYMm: 4, offsetXMm: 0, offsetYMm: 0 },
];

const STORAGE_KEY = "card-sheet-profile-v2";
const LEGACY_STORAGE_KEY = "card-sheet-profile-v1";

/** โหลด profile ที่เลือก + calibration จาก localStorage (เก็บเฉพาะเครื่องเพราะ calibration ขึ้นเครื่องพิมพ์) */
export function loadCardSheetProfile(): CardSheetProfile {
  try {
    const raw = typeof localStorage !== "undefined" ? (localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CardSheetProfile>;
      const base = BUILT_IN_PROFILES.find((p) => p.id === parsed.id) ?? BUILT_IN_PROFILES[0];
      return { ...base, ...parsed, cardWmm: MEMBER_CARD_WIDTH_MM, cardHmm: MEMBER_CARD_HEIGHT_MM } as CardSheetProfile;
    }
  } catch { /* ignore */ }
  return { ...BUILT_IN_PROFILES[0] };
}

/** บันทึก profile + calibration ลง localStorage */
export function saveCardSheetProfile(profile: CardSheetProfile): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch { /* ignore */ }
}

/** คำนวณตำแหน่ง (left, top มม.) ของแต่ละ slot ใน grid สำหรับ render absolute */
export function slotPositions(profile: CardSheetProfile): Array<{ left: number; top: number }> {
  const { cols, cardWmm, cardHmm, marginTopMm, marginLeftMm, gapXMm, gapYMm, offsetXMm, offsetYMm } = profile;
  const positions: Array<{ left: number; top: number }> = [];
  for (let row = 0; row < profile.rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      positions.push({
        left: marginLeftMm + offsetXMm + col * (cardWmm + gapXMm),
        top: marginTopMm + offsetYMm + row * (cardHmm + gapYMm),
      });
    }
  }
  return positions;
}

/** จำนวนบัตรที่ใส่ได้ต่อแผ่น */
export function slotsPerSheet(profile: CardSheetProfile): number {
  return profile.cols * profile.rows;
}
