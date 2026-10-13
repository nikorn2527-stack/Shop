import { applyThermalPrintProfile, resolveThermalPaperWidth, type ThermalPaperWidthId } from "./lib/thermalPrint";

/**
 * ROUND 25 — ปรับแต่งแอป (แบรนด์ + ธีมสี)
 * สีธีมทั้งแอปควบคุมด้วย CSS variables (--teal กลุ่ม) — ไฟล์นี้เปลี่ยนค่า
 * ตอน runtime พร้อมแคชชื่อ/โลโก้ไว้ใน localStorage โดยสีเดิมที่เคยบันทึก
 * จะถูกย้ายมาใช้ Government Blue เพื่อให้ทุกหน้ามีมาตรฐานเดียวกัน
 * เพื่อให้หน้า login ก็ได้ธีมเดียวกันทันทีในการเข้าใช้ครั้งถัดไป
 *
 * ROUND 38 (ข้อ 38) — สไตล์การแสดงผล (UI Style): นอกจากสีแบรนด์ ยังเลือก
 * “บุคลิก” ทั้งระบบได้ — ร้านค้า (มาตรฐาน) / Apple / Microsoft / Android
 * เขียน data-style ลง <html> แล้ว CSS ใน index.css ปรับฟอนต์-ความมน-พื้นหลัง
 * ตามสไตล์นั้น ๆ · เลือกสไตล์ = ได้สีเน้นประจำแพลตฟอร์มมาด้วย
 * (เปลี่ยนสีเน้นแยกทีหลังได้ตามปกติผ่านพาเลตต์สี)
 */

export type BrandSettings = { appName: string; appLogo: string; appTheme: string; appStyle?: string; appBackground?: string };

/**
 * สีหลักมาตรฐานของระบบภาครัฐ — ใช้ชุดเดียวทั้งแอปเพื่อให้ทุกหน้าสม่ำเสมอ
 * ค่าเดิมที่บันทึกไว้ยังอ่านได้ แต่จะถูกย้ายมาใช้ Government Blue อัตโนมัติ
 */
export const THEME_PRESETS: { id: string; label: string; base: string }[] = [
  { id: "government", label: "น้ำเงินกรมท่า · ภาครัฐ", base: "#1d4ed8" },
];

export const DEFAULT_THEME = "government";
const BRAND_CACHE_KEY = "png-brand-v1";

/** ROUND 38 (ข้อ 38) — สไตล์การแสดงผลทั้งระบบ (บุคลิกการออกแบบ)
 *  id ใช้เป็น data-style บน <html> · accent = สีเน้นประจำแพลตฟอร์มที่จะใช้ตอนเลือกสไตล์ */
export type UiStyleId = "shop" | "apple" | "microsoft" | "android";
export const UI_STYLE_PRESETS: { id: UiStyleId; label: string; detail: string; accent: string; fontFamily: string }[] = [
  { id: "shop", label: "ร้านค้า (มาตรฐาน)", detail: "แถบน้ำเงินสด เมนูขาว และเทอร์ควอยซ์ — สว่าง คมชัด สมดุล", accent: "#1976d2", fontFamily: "Sarabun" },
  { id: "apple", label: "Apple", detail: "ขาวสะอาด ปุ่มทรงแคปซูล ฟอนต์ระบบ Apple — เรียบแบบ iOS/macOS", accent: "#0071e3", fontFamily: "SF / Helvetica" },
  { id: "microsoft", label: "Microsoft", detail: "แบบ Fluent — ขอบคม เรียบตึง ฟอนต์ Segoe UI แบบ Windows 11", accent: "#0f6cbd", fontFamily: "Segoe UI" },
  { id: "android", label: "Android", detail: "แบบ Material You — การ์ดมนมาก โทนม่วงพาสเทล แบบแอปบนมือถือ", accent: "#6750a4", fontFamily: "Roboto / Google Sans" },
];

export const DEFAULT_UI_STYLE: UiStyleId = "shop";

/** สไตล์ id ที่รับรอง (กันค่าเพี้ยนจาก settings) */
export function resolveUiStyle(style: string | undefined | null): UiStyleId {
  // Legacy saved styles remain readable, but the app now has one standard design.
  return DEFAULT_UI_STYLE;
}

/** เขียน data-style ลง <html> — CSS ใน index.css จะปรับรูปลักษณ์ตามค่านี้ */
export function applyUiStyle(style: string | undefined | null): UiStyleId {
  const resolved = resolveUiStyle(style);
  const root = document.documentElement;
  if (resolved === DEFAULT_UI_STYLE) delete root.dataset.style;
  else root.dataset.style = resolved;
  return resolved;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** ย้ายสีที่เคยบันทึกทั้งหมดมาใช้ธีมมาตรฐานเดียวกัน */
export function normalizeTheme(theme: string | undefined | null): string {
  return DEFAULT_THEME;
}

/** preset id หรือ hex เดิม → สีน้ำเงินมาตรฐานของระบบ */
export function resolveThemeColor(theme: string | undefined | null): string {
  normalizeTheme(theme);
  return THEME_PRESETS[0].base;
}

/** เขียน CSS variables ทั้งกลุ่มจากสีหลักสีเดียว */
export function applyThemeColor(theme: string | undefined | null): string {
  // One government palette; legacy saved colors remain readable but no longer
  // override the shared design.
  normalizeTheme(theme);
  const base = "#1d4ed8";
  const rgb = hexToRgb(base);
  if (!rgb) return base;
  const [r, g, b] = rgb;
  const root = document.documentElement;
  root.dataset.palette = "government-blue";
  const vars: Record<string, string> = {
    "--teal": base,
    "--teal-dark": "#163b73",
    "--teal-soft": "#dbeafe",
    "--teal-mist": "#eff6ff",
    "--canvas-gradient": "linear-gradient(135deg, #e7f0ff 0%, #f8fbff 46%, #dce9fb 100%)",
    "--workspace-gradient": "linear-gradient(135deg, rgb(231 240 255 / 96%) 0%, rgb(248 251 255 / 92%) 48%, rgb(220 233 251 / 94%) 100%)",
    "--sidebar-gradient": "linear-gradient(180deg, #f8fbff 0%, #edf4ff 52%, #dbe8fa 100%)",
    "--topbar-gradient": "linear-gradient(110deg, rgb(255 255 255 / 94%) 0%, rgb(231 240 255 / 92%) 100%)",
    "--surface-gradient": "linear-gradient(145deg, #ffffff 0%, #f8fbff 58%, #edf4ff 100%)",
    "--accent-gradient": "linear-gradient(135deg, #2563eb 0%, #1d4ed8 48%, #163b73 100%)",
    "--app-secondary": "#0f766e",
    "--app-secondary-soft": "#ccfbf1",
    "--app-health": "#15803d",
    "--app-health-soft": "#dcfce7",
    "--rail-a": "#163b73",
    "--rail-b": "#0f2f5f",
    "--rail-solid": "#123665",
    "--rail-edge": "#0b2548",
    "--teal-glow": `rgba(${r}, ${g}, ${b}, .22)`,
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  return base;
}

export function applyBackground(value: string | undefined): string {
  const background = value && value.length <= 1_500_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : "";
  document.documentElement.style.setProperty("--workspace-image", background ? `url("${background}")` : "none");
  return background;
}

/** ใช้แบรนด์ (ชื่อ+สี+สไตล์) — ตั้ง title และจำลง cache ให้ครั้งถัดไปโหลดไว */
export function applyBrand(brand: Partial<BrandSettings> | null | undefined): BrandSettings | null {
  if (!brand) return null;
  const appName = (brand.appName ?? "").trim();
  const appLogo = brand.appLogo ?? "";
  const appTheme = normalizeTheme(brand.appTheme);
  const appStyle = brand.appStyle ?? DEFAULT_UI_STYLE;
  if (!appName && !appLogo && !brand.appTheme && !brand.appStyle) return null;
  applyThemeColor(appTheme);
  const appBackground = applyBackground(brand.appBackground);
  applyUiStyle(appStyle); // ROUND 38 — สไตล์บุคลิก (ฟอนต์/ความมน/พื้นหลัง) ตามไปกับแบรนด์ด้วย
  if (appName) document.title = appName;
  const cached = readBrandCache();
  const next: BrandSettings = {
    appName: appName || cached?.appName || "ร้านค้าสวัสดิการ",
    appLogo,
    appBackground,
    appTheme,
    appStyle: resolveUiStyle(appStyle),
  };
  try {
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* storage อาจถูกปิด — ไม่วิกฤต */
  }
  return next;
}

export function readBrandCache(): BrandSettings | null {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrandSettings>;
    if (!parsed.appName && !parsed.appLogo && !parsed.appTheme && !parsed.appStyle) return null;
    return {
      appName: parsed.appName || "ร้านค้าสวัสดิการ",
      appLogo: parsed.appLogo || "",
      appBackground: parsed.appBackground || "",
      appTheme: normalizeTheme(parsed.appTheme),
      appStyle: resolveUiStyle(parsed.appStyle),
    };
  } catch {
    return null;
  }
}

/** เรียกตอนบูตแอป — ใช้แบรนด์ที่จำไว้ทันที กันธีมกระพริบเป็นสีเดิม */
export function applyCachedBrand(): void {
  // Login must use the application palette even on a device with no brand cache.
  applyThemeColor(undefined);
  applyBrand(readBrandCache());
}

/** สร้างตัวอักษรย่อจากชื่อแอป (สำหรับ brand-mark เมื่อไม่มีโลโก้) */
export function brandInitial(appName: string | undefined | null): string {
  const name = (appName ?? "").trim();
  return name ? name.replace(/[()\[\]{}"']/g, "").charAt(0) || "ส" : "ส";
}

/**
 * ROUND 42 (ข้อ 32 ตอนที่ 3 — ข้อ 4 เครื่องพิมพ์สลิป) — ความกว้างกระดาษ
 * สลิปที่เลือกใน ตั้งค่า → ใบเสร็จและการขาย: "58" | "72" | "80"
 *
 * เขียน data attribute และ CSS variables ของ thermal profile ลง <html>
 * ส่วน @page size/พื้นที่พิมพ์จริง/offset/ระยะท้าย สร้างโดย printHelper กลาง
 */
export type PaperWidthId = ThermalPaperWidthId;
export const PAPER_WIDTHS: { id: PaperWidthId; label: string; detail: string }[] = [
  { id: "58", label: "58 มม.", detail: "สลิปเล็ก — เครื่องพิมพ์มินิทั่วไป" },
  { id: "72", label: "72 มม.", detail: "มาตรฐานของระบบ (ค่าเริ่มต้น)" },
  { id: "80", label: "80 มม.", detail: "สลิปใหญ่ — ตัวอักษรใหญ่ขึ้น อ่านง่าย" },
];
/** ค่าที่รับรองจาก settings (กันค่าเพี้ยน) — อะไรที่ไม่รู้จัก = 72 มาตรฐาน */
export function resolvePaperWidth(width: string | undefined | null): PaperWidthId {
  return resolveThermalPaperWidth(width);
}

/** ใช้ขนาดกระดาษจริงตอนพิมพ์ — เรียกทุกครั้งที่ settings โหลด/เปลี่ยน */
export function applyPaperWidth(width: string | undefined | null): PaperWidthId {
  const resolved = resolvePaperWidth(width);
  applyThermalPrintProfile(resolved);
  return resolved;
}
