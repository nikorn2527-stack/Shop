/**
 * ROUND 25 — ปรับแต่งแอป (แบรนด์ + ธีมสี)
 * สีธีมทั้งแอปควบคุมด้วย CSS variables (--teal กลุ่ม) — ไฟล์นี้เปลี่ยนค่า
 * ตอน runtime ตามที่ผู้บริหารเลือกใน ตั้งค่า → แบรนด์และธีม
 * (preset สำเร็จรูป หรือสี custom) พร้อมแคชชื่อ/โลโก้/สีไว้ใน localStorage
 * เพื่อให้หน้า login ก็ได้ธีมเดียวกันทันทีในการเข้าใช้ครั้งถัดไป
 */

export type BrandSettings = { appName: string; appLogo: string; appTheme: string };

/** Preset สีหลัก — คุมโทนทั้งแอป (ปุ่ม / แถบเมนู / จุดเน้น) */
export const THEME_PRESETS: { id: string; label: string; base: string }[] = [
  { id: "emerald", label: "เขียวมรกต", base: "#007a55" },
  { id: "forest", label: "เขียวสน", base: "#2f6b3a" },
  { id: "matcha", label: "เขียวชา", base: "#6f7d2c" },
  { id: "teal", label: "เขียวน้ำทะเล", base: "#0f766e" },
  { id: "coffee", label: "น้ำตาลกาแฟ", base: "#8a5a34" },
  { id: "amber", label: "ส้มอำพัน", base: "#b45309" },
  { id: "rose", label: "แดงชาด", base: "#be4a5f" },
  { id: "violet", label: "ม่วงคราม", base: "#7c5cbf" },
];

export const DEFAULT_THEME = "emerald";
const BRAND_CACHE_KEY = "png-brand-v1";

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

/** preset id หรือ hex → สีหลัก hex (fallback emerald) */
export function resolveThemeColor(theme: string | undefined | null): string {
  if (!theme) return THEME_PRESETS[0].base;
  const preset = THEME_PRESETS.find((item) => item.id === theme);
  if (preset) return preset.base;
  if (/^#[0-9a-fA-F]{6}$/.test(theme)) return theme.toLowerCase();
  return THEME_PRESETS[0].base;
}

/** เขียน CSS variables ทั้งกลุ่มจากสีหลักสีเดียว */
export function applyThemeColor(theme: string | undefined | null): string {
  const base = resolveThemeColor(theme);
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
  const vars: Record<string, string> = {
    "--teal": base,
    "--teal-dark": build(clamp(l - 0.07, 0.12, 0.82)),
    "--teal-soft": build(0.9, sat * 0.62),
    "--teal-mist": build(0.945, sat * 0.38),
    "--rail-a": build(0.2, sat * 0.92),
    "--rail-b": build(0.12, sat * 0.95),
    "--teal-glow": `rgba(${r}, ${g}, ${b}, .22)`,
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  return base;
}

/** ใช้แบรนด์ (ชื่อ+สี) — ตั้ง title และจำลง cache ให้ครั้งถัดไปโหลดไว */
export function applyBrand(brand: Partial<BrandSettings> | null | undefined): BrandSettings | null {
  if (!brand) return null;
  const appName = (brand.appName ?? "").trim();
  const appLogo = brand.appLogo ?? "";
  const appTheme = brand.appTheme ?? DEFAULT_THEME;
  if (!appName && !appLogo && !brand.appTheme) return null;
  applyThemeColor(appTheme);
  if (appName) document.title = appName;
  const cached = readBrandCache();
  const next: BrandSettings = {
    appName: appName || cached?.appName || "ร้านค้าสวัสดิการ",
    appLogo,
    appTheme,
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
    if (!parsed.appName && !parsed.appLogo && !parsed.appTheme) return null;
    return {
      appName: parsed.appName || "ร้านค้าสวัสดิการ",
      appLogo: parsed.appLogo || "",
      appTheme: parsed.appTheme || DEFAULT_THEME,
    };
  } catch {
    return null;
  }
}

/** เรียกตอนบูตแอป — ใช้แบรนด์ที่จำไว้ทันที กันธีมกระพริบเป็นสีเดิม */
export function applyCachedBrand(): void {
  applyBrand(readBrandCache());
}

/** สร้างตัวอักษรย่อจากชื่อแอป (สำหรับ brand-mark เมื่อไม่มีโลโก้) */
export function brandInitial(appName: string | undefined | null): string {
  const name = (appName ?? "").trim();
  return name ? name.replace(/[()\[\]{}"']/g, "").charAt(0) || "ส" : "ส";
}
