export type ThermalPaperWidthId = "58" | "72" | "80";

export type ThermalPrintProfile = {
  printerName: string;
  paperWidthMm: 58 | 72 | 80;
  printableWidthMm: number;
  horizontalOffsetMm: number;
  bottomFeedMm: number;
};

type StoredThermalProfiles = Record<string, Partial<Record<ThermalPaperWidthId, Partial<ThermalPrintProfile>>>>;

const STORAGE_KEY = "thermal-print-profiles-v1";

export const THERMAL_PROFILE_PRESETS: Record<ThermalPaperWidthId, ThermalPrintProfile> = {
  "58": { printerName: "", paperWidthMm: 58, printableWidthMm: 54, horizontalOffsetMm: 0, bottomFeedMm: 4 },
  "72": { printerName: "", paperWidthMm: 72, printableWidthMm: 68, horizontalOffsetMm: 0, bottomFeedMm: 4 },
  "80": { printerName: "", paperWidthMm: 80, printableWidthMm: 76, horizontalOffsetMm: 0, bottomFeedMm: 4 },
};

export function resolveThermalPaperWidth(value: string | number | null | undefined): ThermalPaperWidthId {
  return value === "58" || value === 58 ? "58" : value === "80" || value === 80 ? "80" : "72";
}

function finiteInRange(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(min, number)) * 10) / 10;
}

export function resolveThermalPrintProfile(
  value: Partial<ThermalPrintProfile> | null | undefined,
  paperWidth: string | number | null | undefined = value?.paperWidthMm,
): ThermalPrintProfile {
  const id = resolveThermalPaperWidth(paperWidth);
  const preset = THERMAL_PROFILE_PRESETS[id];
  return {
    printerName: typeof value?.printerName === "string" ? value.printerName.trim() : "",
    paperWidthMm: preset.paperWidthMm,
    printableWidthMm: finiteInRange(value?.printableWidthMm, preset.printableWidthMm, 40, preset.paperWidthMm),
    horizontalOffsetMm: finiteInRange(value?.horizontalOffsetMm, 0, -5, 5),
    bottomFeedMm: finiteInRange(value?.bottomFeedMm, preset.bottomFeedMm, 0, 20),
  };
}

function readStoredProfiles(): StoredThermalProfiles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // migrate รุ่นแรกที่เก็บ profile ไว้ตรงตามขนาดกระดาษ
    if ("58" in parsed || "72" in parsed || "80" in parsed) return { __workstation__: parsed } as StoredThermalProfiles;
    return parsed as StoredThermalProfiles;
  } catch {
    return {};
  }
}

function currentReceiptPrinterName(): string {
  try {
    const parsed = JSON.parse(localStorage.getItem("local-printer-settings") ?? "{}");
    return typeof parsed?.receipt === "string" ? parsed.receipt.trim() : "";
  } catch {
    return "";
  }
}

function profileScope(printerName?: string | null): string {
  return printerName?.trim() || "__workstation__";
}

export function getThermalPrintProfile(paperWidth?: string | number | null, printerName = currentReceiptPrinterName()): ThermalPrintProfile {
  const id = resolveThermalPaperWidth(paperWidth ?? (typeof document !== "undefined" ? document.documentElement.dataset.paperWidth : undefined));
  const profiles = readStoredProfiles();
  const stored = profiles[profileScope(printerName)]?.[id] ?? profiles.__workstation__?.[id];
  return { ...resolveThermalPrintProfile(stored, id), printerName: printerName.trim() };
}

export function saveThermalPrintProfile(profile: ThermalPrintProfile): ThermalPrintProfile {
  const resolved = resolveThermalPrintProfile(profile, profile.paperWidthMm);
  try {
    const profiles = readStoredProfiles();
    const scope = profileScope(resolved.printerName);
    profiles[scope] ??= {};
    profiles[scope][String(resolved.paperWidthMm) as ThermalPaperWidthId] = resolved;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch { /* localStorage อาจถูกปิด — ยังใช้ค่าที่ validate แล้วในหน่วยความจำได้ */ }
  applyThermalPrintProfile(resolved);
  return resolved;
}

export function resetThermalPrintProfile(paperWidth?: string | number | null, printerName = currentReceiptPrinterName()): ThermalPrintProfile {
  const id = resolveThermalPaperWidth(paperWidth);
  try {
    const profiles = readStoredProfiles();
    delete profiles[profileScope(printerName)]?.[id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch { /* ignore */ }
  return applyThermalPrintProfile({ ...THERMAL_PROFILE_PRESETS[id], printerName });
}

export function applyThermalPrintProfile(profileOrWidth?: ThermalPrintProfile | string | number | null): ThermalPrintProfile {
  const profile = typeof profileOrWidth === "object" && profileOrWidth !== null
    ? resolveThermalPrintProfile(profileOrWidth, profileOrWidth.paperWidthMm)
    : getThermalPrintProfile(profileOrWidth);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.paperWidth = String(profile.paperWidthMm);
    root.style.setProperty("--thermal-paper-width", `${profile.paperWidthMm}mm`);
    root.style.setProperty("--thermal-printable-width", `${profile.printableWidthMm}mm`);
    root.style.setProperty("--thermal-horizontal-offset", `${profile.horizontalOffsetMm}mm`);
    root.style.setProperty("--thermal-bottom-feed", `${profile.bottomFeedMm}mm`);
  }
  return profile;
}

export function thermalContentLeftMm(profile: ThermalPrintProfile): number {
  const available = Math.max(0, profile.paperWidthMm - profile.printableWidthMm);
  return Math.min(available, Math.max(0, available / 2 + profile.horizontalOffsetMm));
}

export function buildThermalPageCss(profile: ThermalPrintProfile, heightMm: number, targetId: string): string {
  const left = thermalContentLeftMm(profile);
  return `@page{size:${profile.paperWidthMm}mm ${heightMm}mm;margin:0}html,body{margin:0;padding:0;background:white;width:${profile.paperWidthMm}mm}#${targetId}{position:static!important;transform:none!important;box-shadow:none!important;box-sizing:border-box!important;width:${profile.printableWidthMm}mm!important;margin:0 0 0 ${left}mm!important;height:auto!important;max-height:none!important;overflow:visible!important}`;
}