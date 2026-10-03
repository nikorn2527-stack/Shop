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
 * บัตร 90×55มม. (มาตรฐานนามบัตรไทย) — 8-up และ 10-up ใส่ A4 portrait พอดี
 * 12-up ไม่พอดี (3×90=270 > 210) จึงให้ผู้ใช้กำหนดเองผ่าน custom profile
 */

export type CardSheetProfile = {
  id: string;
  name: string;
  /** จำนวนคอลัมน์ (แนวนอน) */
  cols: number;
  /** จำนวนแถว (แนวตั้ง) */
  rows: number;
  /** ความกว้างบัตร มม. (default 90 มาตรฐานนามบัตรไทย) */
  cardWmm: number;
  /** ความสูงบัตร มม. (default 55) */
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
 *  - 8-up (2×4): 2×90=180 → ขอบซ้ายขวา 15มม. | 4×55=220 + 3×gap4=12 → 232 → ขอบบน 8 ขอบล่าง 57
 *  - 10-up (2×5): 5×55=275 + 4×gap3=12 → 287 → ขอบบน 5 ขอบล่าง 5 (แน่นแต่พอ)
 *  - custom: ผู้ใช้กำหนดเอง (รองรับ 12-up บน landscape หรือกระดาษพิเศษ)
 */
export const BUILT_IN_PROFILES: CardSheetProfile[] = [
  { id: "a4-8", name: "A4 · 8 ใบ/แผ่น (2 × 4)", cols: 2, rows: 4, cardWmm: 90, cardHmm: 55, marginTopMm: 8, marginLeftMm: 15, gapXMm: 0, gapYMm: 4, offsetXMm: 0, offsetYMm: 0 },
  { id: "a4-10", name: "A4 · 10 ใบ/แผ่น (2 × 5)", cols: 2, rows: 5, cardWmm: 90, cardHmm: 55, marginTopMm: 5, marginLeftMm: 15, gapXMm: 0, gapYMm: 3, offsetXMm: 0, offsetYMm: 0 },
  { id: "custom", name: "กำหนดเอง — แก้ cols/rows/ขอบ/gap/offset", cols: 2, rows: 4, cardWmm: 90, cardHmm: 55, marginTopMm: 8, marginLeftMm: 15, gapXMm: 0, gapYMm: 4, offsetXMm: 0, offsetYMm: 0 },
];

const STORAGE_KEY = "card-sheet-profile-v1";

/** โหลด profile ที่เลือก + calibration จาก localStorage (เก็บเฉพาะเครื่องเพราะ calibration ขึ้นเครื่องพิมพ์) */
export function loadCardSheetProfile(): CardSheetProfile {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CardSheetProfile>;
      const base = BUILT_IN_PROFILES.find((p) => p.id === parsed.id) ?? BUILT_IN_PROFILES[0];
      return { ...base, ...parsed } as CardSheetProfile;
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
