/**
 * ROUND 25 — ปรับแต่งแอป (แบรนด์ + ธีมสี)
 * สีธีมทั้งแอปควบคุมด้วย CSS variables (--teal กลุ่ม) — ไฟล์นี้เปลี่ยนค่า
 * ตอน runtime ตามที่ผู้บริหารเลือกใน ตั้งค่า → แบรนด์และธีม
 * (preset สำเร็จรูป หรือสี custom) พร้อมแคชชื่อ/โลโก้/สีไว้ใน localStorage
 * เพื่อให้หน้า login ก็ได้ธีมเดียวกันทันทีในการเข้าใช้ครั้งถัดไป
 *
 * ROUND 38 (ข้อ 38) — สไตล์การแสดงผล (UI Style): นอกจากสีแบรนด์ ยังเลือก
 * “บุคลิก” ทั้งระบบได้ — ร้านค้า (มาตรฐาน) / Apple / Microsoft / Android
 * เขียน data-style ลง <html> แล้ว CSS ใน index.css ปรับฟอนต์-ความมน-พื้นหลัง
 * ตามสไตล์นั้น ๆ · เลือกสไตล์ = ได้สีเน้นประจำแพลตฟอร์มมาด้วย
 * (เปลี่ยนสีเน้นแยกทีหลังได้ตามปกติผ่านพาเลตต์สี)
 */

export type BrandSettings = { appName: string; appLogo: string; appTheme: string; appStyle?: string; appBackground?: string };

/** Preset สีหลัก — คุมโทนทั้งแอป (ปุ่ม / แถบเมนู / จุดเน้น) */
export const THEME_PRESETS: { id: string; label: string; base: string }[] = [
  { id: "pastel", label: "ชมพู · ฟ้า · มิ้นต์", base: "#ad3973" },
  { id: "indigo", label: "ครามไอริส", base: "#4f46b8" },
  { id: "blue", label: "น้ำเงินสด", base: "#1976d2" },
  { id: "rose", label: "แดงชาด", base: "#be4a5f" },
  { id: "violet", label: "ม่วงคราม", base: "#7c5cbf" },
];

export const DEFAULT_THEME = "pastel";
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((part) => clamp(Math.round(part), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return [channel(hn + 1 / 3) * 255, channel(hn) * 255, channel(hn - 1 / 3) * 255];
}

/** Retire green and copper decoration, including previously saved custom accents. */
export function normalizeTheme(theme: string | undefined | null): string {
  if (!theme || ["indigo", "emerald", "forest", "matcha", "teal", "coffee", "amber"].includes(theme) || theme.toLowerCase() === "#4f46b8") return DEFAULT_THEME;
  const rgb = /^#[0-9a-f]{6}$/i.test(theme) ? hexToRgb(theme) : null;
  if (rgb) {
    const [h, s] = rgbToHsl(...rgb);
    if (h >= 65 && h <= 180 && s > 0.1) return DEFAULT_THEME;
    if (h >= 15 && h < 65 && s > 0.1) return DEFAULT_THEME;
  }
  return theme;
}

/** preset id หรือ hex → สีหลัก hex (fallback indigo) */
export function resolveThemeColor(theme: string | undefined | null): string {
  theme = normalizeTheme(theme);
  if (!theme) return THEME_PRESETS[0].base;
  const preset = THEME_PRESETS.find((item) => item.id === theme);
  if (preset) return preset.base;
  if (/^#[0-9a-fA-F]{6}$/.test(theme)) return theme.toLowerCase();
  return THEME_PRESETS[0].base;
}

/** เขียน CSS variables ทั้งกลุ่มจากสีหลักสีเดียว */
export function applyThemeColor(theme: string | undefined | null): string {
  // One application palette; legacy saved colors remain readable but no longer
  // override the shared design after removing the theme selector.
  const base = "#c94f08";
  const rgb = hexToRgb(base);
  if (!rgb) return base;
  const [r, g, b] = rgb;
  const [h, s, l] = rgbToHsl(r, g, b);
  const sat = Math.max(s, 0.18); // กันสีเทาเกินไปสำหรับสีอ่อนจาง
  const build = (lightness: number, saturation = sat) => {
    const [rr, gg, bb] = hslToRgb(h, saturation, lightness);
    return rgbToHex(rr, gg, bb);
  };
  const root = document.documentElement;
  root.dataset.palette = "slate-orange";
  const vars: Record<string, string> = {
    "--teal": base,
    "--teal-dark": build(clamp(l - 0.07, 0.12, 0.82)),
    "--teal-soft": "#fdba74",
    "--teal-mist": "#fff7ed",
    "--app-secondary": "#1d4ed8",
    "--app-secondary-soft": "#dbeafe",
    // เฉดเข้มของสีธีม — ยังใช้โดะ member-balance-card (การ์ดยอดเงินคงเหลือ)
    "--rail-a": build(0.2, sat * 0.92),
    // ROUND 48 — ราง POS ไม่ตามสีธีมแล้ว: ใช้สีเดียวกับแอปตามที่ผู้ใช้ขอ (ปุ่มเท่านั้นที่มีสีของใครของมัน)
    // ตัวแปร --rail-b / --rail-solid / --rail-edge จึงปลดลง (index.css ROUND 48)
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
 * ทำสองอย่าง:
 * ① เขียน data-paper-width ลง <html> — ให้ CSS ปรับความกว้างใบเสร็จ/
 *   สลิปเติม-ถอน/สลิปทดสอบ ตอนพิมพ์ตามขนาดที่เลือก
 * ② ฉีด <style> ท้าย <head> ที่กำหนด @page margin ให้เหมาะกับแต่ละขนาด
 *   (58 มม. → ขอบ 2 มม. · 72 มม. → ขอบ 8 มม. เหมือนเดิม · 80 มม. → ขอบ 2 มม.)
 *   สไตล์ที่ฉีดช้ากว่าไฟล์หลักจึงชนะกฎเดิมเสมอ ไม่ต้องแตะ @page ในไฟล์ CSS
 */
export type PaperWidthId = "58" | "72" | "80";
export const PAPER_WIDTHS: { id: PaperWidthId; label: string; detail: string }[] = [
  { id: "58", label: "58 มม.", detail: "สลิปเล็ก — เครื่องพิมพ์มินิทั่วไป" },
  { id: "72", label: "72 มม.", detail: "มาตรฐานของระบบ (ค่าเริ่มต้น)" },
  { id: "80", label: "80 มม.", detail: "สลิปใหญ่ — ตัวอักษรใหญ่ขึ้น อ่านง่าย" },
];
const PAPER_PAGE_MARGIN: Record<PaperWidthId, string> = { "58": "2mm", "72": "8mm", "80": "2mm" };

/** ค่าที่รับรองจาก settings (กันค่าเพี้ยน) — อะไรที่ไม่รู้จัก = 72 มาตรฐาน */
export function resolvePaperWidth(width: string | undefined | null): PaperWidthId {
  return width === "58" || width === "80" ? width : "72";
}

/** ใช้ขนาดกระดาษจริงตอนพิมพ์ — เรียกทุกครั้งที่ settings โหลด/เปลี่ยน */
export function applyPaperWidth(width: string | undefined | null): PaperWidthId {
  const resolved = resolvePaperWidth(width);
  document.documentElement.dataset.paperWidth = resolved;
  let styleEl = document.getElementById("paper-width-page") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "paper-width-page";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@media print { @page { margin: ${PAPER_PAGE_MARGIN[resolved]}; } }`;
  return resolved;
}
