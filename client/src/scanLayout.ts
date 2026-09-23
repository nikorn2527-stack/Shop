/**
 * ROUND 80 (user) — ยิงบาร์โค้ดตอนวินโดว์ยังเป็นภาษาไทย
 *
 * อาการจริงที่หน้าร้าน: ปืนสแกน "พิมพ์" ตามคีย์บอร์ดที่ Windows เลือกไว้ —
 * ถ้าเครื่องอยู่โหมดไทย (Kedmanee) บาร์โค้ด 8851000000018 จะกลายเป็น
 * "คค๑..ภ..จ..ขช" หาสินค้าไม่เจอ พนักงานต้องสลับ EN ก่อนทุกครั้ง
 *
 * ระบบแก้ให้เองสองชั้น (ไม่แตะการค้นหาชื่อสินค้าภาษาไทยปกติ):
 *
 * ชั้นที่ 1 "ตัวเลขล้วน" — ข้อความที่ทุกตัวอักษรอยู่ในแถวตัวเลขของคีย์บอร์ด
 *   ไทยเท่านั้น (ๅ / _ ภ ถ ุ ึ ค ต จ ข ช ๑-๙ ฿ …) และยาว ≥ 4 ตัว = คนพิมพ์เลข
 *   ตอนไทยอยู่แน่นอน (ชื่อไทยจริงต้องมีพยัญชนะ/สระแถวอื่นเสมอ) → แปลงกลับทันที
 *
 * ชั้นที่ 2 "สแกนเร็ว" — hook จับ event.code (ปุ่มกายภาพ ไม่สนภาษา) + ช่วงเวลา
 *   กดของแต่ละปุ่ม: ปืนสแกนยิงชุดละ 10-40 มิลลิวินาทีต่อตัว มนุษย์พิมพ์ไม่ทัน —
 *   ถ้าชุดล่าสุดเร็วระดับปืนสแกน และข้อความมีภาษาไทย ให้สร้างข้อความใหม่จาก
 *   รหัสปุ่มจริง (KeyH→"h", Digit8→"8") เป๊ะ ๆ — รองรับบาร์โค้ดมีตัวอักษร
 *   ผสมเลข เช่น HH-001 (พิมพ์ไทยจะได้ ้้ขจจๅ)
 */
import { useCallback, useRef } from "react";

/**
 * Kedmanee แถวเลข (ปุ่ม 1..0, -, =) — ไม่กด Shift ให้อักขระไทยตัวไหน
 * และกด Shift ให้เลขไทย/สัญลักษณ์ใด (ใช้ตัวอักษรจริงกันพลาด codepoint)
 */
const THAI_DIGIT_ROW: Record<string, string> = {
  // ไม่กด Shift (key 1 → ๅ U+0E45, key 2 → /, key 3 → _, …)
  "\u0E45": "1", // ๅ
  "/": "2",
  "_": "3",
  "\u0E20": "4", // ภ
  "\u0E16": "5", // ถ
  "\u0E38": "6", // ุ
  "\u0E36": "7", // ึ
  "\u0E04": "8", // ค
  "\u0E15": "9", // ต
  "\u0E08": "0", // จ
  "\u0E02": "-", // ข
  "\u0E0A": "=", // ช
  // กด Shift (เลขไทย + สัญลักษณ์ของแถวเดียวกัน)
  "+": "1",
  "\u0E51": "2", // ๑
  "\u0E52": "3", // ๒
  "\u0E53": "4", // ๓
  "\u0E54": "5", // ๔
  "\u0E39": "6", // ู
  "\u0E3F": "7", // ฿
  "\u0E55": "8", // ๕
  "\u0E56": "9", // ๖
  "\u0E57": "0", // ๗
  "\u0E58": "-", // ๘
  "\u0E59": "=", // ๙
};

/** ตัวอักขระกลาง ๆ ที่คบคู่กับรหัสได้ทั้งสองภาษา — ผ่านไปเลยไม่ต้องแปลง */
const NEUTRAL_CHARS: Record<string, boolean> = { " ": true, "-": true, ".": true };

/** มีอักขระภาษาไทย (ช่วง U+0E01–U+0E5B) หรือเปล่า */
export function hasThai(text: string): boolean {
  return /[\u0E01-\u0E5B]/.test(text);
}

/** ชั้นที่ 1 — ทุกตัวอยู่ในแผนที่แถวเลขไทย (+ ตัวกลาง) และยาวพอ → แปลงกลับเป็นเลข */
export function convertThaiDigitRow(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 4) return null;
  let mappedCount = 0;
  let out = "";
  for (const ch of trimmed) {
    if (NEUTRAL_CHARS[ch]) { out += ch; continue; }
    const mapped = THAI_DIGIT_ROW[ch];
    if (mapped === undefined) return null; // เจอตัวนอกแถวเลข = ไม่ใช่การพิมพ์เลขตอนไทย
    out += mapped;
    mappedCount += 1;
  }
  return mappedCount >= 4 ? out : null;
}

/** event.code (ปุ่มกายภาพ) → ตัวอักษรที่ปุ่มนั้น "ควร" ให้เมื่อภาษาอังกฤษ */
function codeToChar(code: string, shift: boolean): string | null {
  if (code.startsWith("Digit")) return code.slice(5); // บาร์โค้ดไม่มี shift+เลข — คืนเลขตรง ๆ
  if (code.startsWith("Numpad")) {
    const key = code.slice(6);
    return /^[0-9]$/.test(key) ? key : null; // NumpadEnter/NumpadAdd ฯลฯ ไม่ใช่ตัวอักษร
  }
  if (code.startsWith("Key")) {
    const letter = code.slice(3).toLowerCase();
    return shift ? letter.toUpperCase() : letter;
  }
  const symbols: Record<string, string> = {
    Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/",
    Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Backquote: "`",
  };
  return symbols[code] ?? null;
}

type BurstState = { chars: string[]; times: number[]; enterAt: number };

/** ช่องไฟระหว่างปุ่มที่ถือว่า "ยังเป็นชุดเดียวกัน" (มิลลิวินาที) */
const BURST_GAP_MS = 90;
/** ชุดที่เร็วกว่านี้ทั้งชุด = ปืนสแกน (มนุษย์พิมพ์เร็วสุด ~80-100 มิลลิวินาที/ตัว) */
const BURST_TOTAL_MS = 900;

export type ScanLayoutFix = { value: string; convertedFrom?: string };

/**
 * แปะที่ช่องรับสแกน (onKeyDownCapture) — เก็บรหัสปุ่มกับจังหวะเวลาไว้
 * แล้วเรียก normalize() ตอน Enter/commit เพื่อเอาข้อความที่ถูกต้องกลับไป
 */
export function useScanLayout() {
  const burstRef = useRef<BurstState>({ chars: [], times: [], enterAt: 0 });

  const onKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const state = burstRef.current;
    const now = event.timeStamp || performance.now();
    if (event.key === "Enter") { state.enterAt = now; return; }
    if (event.key === "Backspace") { state.chars = []; state.times = []; return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const ch = codeToChar(event.code, event.shiftKey);
    if (ch === null) return;
    const last = state.times[state.times.length - 1];
    if (last === undefined || now - last > BURST_GAP_MS) {
      state.chars = [];
      state.times = [];
    }
    state.chars.push(ch);
    state.times.push(now);
  }, []);

  const normalize = useCallback((text: string): ScanLayoutFix => {
    const value = text.trim();
    if (value === "" || !hasThai(value)) return { value };

    // ชั้นที่ 2 — สแกนด้วยปืน (ชุดเร็ว + จบด้วย Enter ติด ๆ): สร้างใหม่จากปุ่มจริง
    const { chars, times, enterAt } = burstRef.current;
    if (enterAt > 0 && times.length >= 3) {
      const totalSpan = times[times.length - 1] - times[0];
      let maxGap = 0;
      for (let index = 1; index < times.length; index += 1) {
        maxGap = Math.max(maxGap, times[index] - times[index - 1]);
      }
      const enterGap = enterAt - times[times.length - 1];
      if (totalSpan <= BURST_TOTAL_MS && maxGap <= BURST_GAP_MS && enterGap <= 160) {
        const rebuilt = chars.join("").trim();
        if (rebuilt !== "" && rebuilt !== value) return { value: rebuilt, convertedFrom: value };
      }
    }

    // ชั้นที่ 1 — พิมพ์เลขตอนภาษาไทย (ไม่สนความเร็ว)
    const converted = convertThaiDigitRow(value);
    if (converted !== null && converted !== value) return { value: converted, convertedFrom: value };

    return { value };
  }, []);

  return { onKeyDownCapture, normalize };
}

/** แจ้งเตือนมาตรฐานเมื่อมีการแปลง — ให้พนักงานรู้ว่าไม่ต้องสลับภาษาเอง */
export const SCAN_LAYOUT_TOAST = {
  message: "แปลงคีย์บอร์ดไทย → อังกฤษให้อัตโนมัติ",
  description: (from: string, to: string) => `"${from}" → "${to}" — ยิงบาร์โค้ดได้เลยไม่ต้องสลับภาษา`,
};
