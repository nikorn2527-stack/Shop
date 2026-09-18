/**
 * Font scale — per-device display preference ("ตั้งค่า → การแสดงผล").
 * Applied as `zoom` on the root element so every px-based size in the app
 * (including fixed-position modals) scales uniformly, like browser zoom.
 * Persisted in localStorage because it is a device-display concern, not a
 * store-policy setting shared across staff.
 */
export const FONT_SCALE_KEY = "png-font-scale";

export type FontScaleId = "base" | "large" | "xlarge";

export const FONT_SCALES: { id: FontScaleId; label: string; detail: string; zoom: number }[] = [
  { id: "base", label: "ปกติ", detail: "100% · สำหรับจอใหญ่", zoom: 1 },
  { id: "large", label: "ใหญ่", detail: "112% · อ่านง่ายขึ้น", zoom: 1.12 },
  { id: "xlarge", label: "ใหญ่พิเศษ", detail: "125% · เหมาะกับจอเล็ก", zoom: 1.25 },
];

export function isValidFontScaleId(value: string | null): value is FontScaleId {
  return value === "base" || value === "large" || value === "xlarge";
}

export function readFontScale(): FontScaleId {
  try {
    const raw = localStorage.getItem(FONT_SCALE_KEY);
    return isValidFontScaleId(raw) ? raw : "base";
  } catch {
    return "base";
  }
}

export function applyFontScale(id: FontScaleId) {
  const scale = FONT_SCALES.find((item) => item.id === id) ?? FONT_SCALES[0];
  try {
    localStorage.setItem(FONT_SCALE_KEY, id);
  } catch {
    // storage unavailable — keep the in-memory effect only
  }
  // --fs-zoom mirrors the applied zoom so fixed-height layouts (POS terminal)
  // can divide viewport units back to the real on-screen height.
  document.documentElement.style.setProperty("--fs-zoom", String(scale.zoom));
  document.documentElement.style.zoom = String(scale.zoom);
}
