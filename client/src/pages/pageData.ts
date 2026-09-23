import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BarChart3, LayoutDashboard, PackageSearch, ShoppingCart, UsersRound } from "lucide-react";

export type View = "dashboard" | "pos" | "stock" | "members" | "reports" | "settings" | "logs" | "users";
/** ROUND 36 (ข้อ 31) — เพิ่ม "dev": บัญชีผู้พัฒนา มีสิทธิ์ระดับผู้บริหารแต่แสดงตัวตนต่างกัน */
export type Role = "staff" | "admin" | "dev";
export type CartItem = { id: number; name: string; price: number; qty: number; unit: string; special?: boolean; variant?: string; step?: number };

/** Round 31-12 — money-mode product price tier (ขายเป็นเงิน เช่น น้ำแข็ง ฿1 = 200 ก.) */
export type PriceTier = { label: string; price: number; qty: number };

export type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  unit: string;
  color: string;
  emoji: string;
  /** Optional pack size, e.g. "500 ml" / "300 g" — shown under the product name. */
  size?: string | null;
  /** Real product photo (data URL). Falls back to emoji when absent. */
  imageUrl?: string | null;
  /** "money" = ขายเป็นราคาตามช่องราคา (น้ำแข็ง) · "unit" (default) = ขายตามหน่วยปกติ */
  sellMode?: string | null;
  /** JSON [{ label, price, qty }] — price tiers for sellMode "money" */
  priceTiers?: string | null;
  /** 1 = ขึ้นแผงลัดหน้าร้าน (POS shortcut rail) */
  quickPick?: number;
};

/** Real member essentials for the POS member dropdown (from trpc.member.list). */
export type MemberLite = {
  memberNumber: string;
  /** คำนำหน้าชื่อ (นาย/นาง/นางสาว/…) — null/undefined = ไม่มี */
  prename?: string | null;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  lastTransactionAt: string | null;
  /** ROUND 65 — รหัสบัตรเงินสด / รหัสผู้ป่วย (HN) · null/undefined = ยังไม่ผูก */
  cardNumber?: string | null;
  patientCode?: string | null;
  /** วันที่ลงทะเบียน (วันที่เปิดใช้บัตร) — มีเฉพาะข้อมูลจาก member.detail */
  createdAt?: string | null;
  photoUrl?: string | null;
  gender?: string | null;
  /** ROUND 34 (req 23.2) — วงเงินซื้อสินค้าต่อวัน · null/undefined = ไม่จำกัด
   *  present on member.list / member.detail rows from the server */
  creditLimit?: number | null;
};

export function calculateCartSubtotal(items: CartItem[]) {
  // Variant lines (money-mode tiers) price PER SERVING while qty is in base
  // units (grams) — one serving = step base units.
  return items.reduce((sum, item) => sum + (item.variant ? item.price * (item.qty / (item.step || 1)) : item.price * item.qty), 0);
}

export function addScannedItem(items: CartItem[], product: Product) {
  const existing = items.find((item) => item.id === product.id && !item.variant);
  if (existing) {
    return items.map((item) => item.id === product.id && !item.variant ? { ...item, qty: item.qty + 1 } : item);
  }
  return [...items, { id: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit }];
}

/** Parses the priceTiers JSON column — invalid entries are dropped silently. */
export function parsePriceTiers(json?: string | null): PriceTier[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((tier): tier is Record<string, unknown> => Boolean(tier) && typeof tier === "object")
      .map((tier) => ({ label: String(tier.label ?? "").trim(), price: Number(tier.price), qty: Number(tier.qty) }))
      .filter((tier) => Number.isFinite(tier.price) && tier.price > 0 && Number.isFinite(tier.qty) && tier.qty > 0);
  } catch {
    return [];
  }
}

/** Money-mode product: one tap = one serving of that price tier (น้ำแข็ง ฿5 = 1,000 ก.). */
export function addTierItem(items: CartItem[], product: Product, tier: PriceTier) {
  const variant = tier.label || `฿${tier.price}`;
  const existing = items.find((item) => item.id === product.id && item.variant === variant);
  if (existing) {
    return items.map((item) => (item.id === product.id && item.variant === variant ? { ...item, qty: item.qty + tier.qty } : item));
  }
  return [...items, { id: product.id, name: tier.label ? `${product.name} · ${tier.label}` : product.name, price: tier.price, qty: tier.qty, unit: product.unit, variant, step: tier.qty }];
}

/** ROUND 36 — dev ได้สิทธิ์ระดับผู้บริหาร (เข้าถึง ตั้งค่า/ผู้ใช้/Log ได้) */
export function isAdminRole(role: Role): boolean {
  return role === "admin" || role === "dev";
}

/** ป้ายบทบาทสั้นภาษาไทย (ใช้กับ actorRole ที่ส่งให้ backend และข้อความ UI) */
export function roleThaiLabel(role: Role): string {
  return role === "admin" ? "ผู้บริหาร" : role === "dev" ? "ผู้พัฒนา" : "เจ้าหน้าที่";
}

export function canAccessView(role: Role, view: View) {
  return isAdminRole(role) || !["settings", "logs", "users"].includes(view);
}

export function isStockAlert(stock: number, reorderLevel = 10) {
  return stock <= reorderLevel;
}

export type MemberNumberFormat = {
  prefix?: string;
  yearMode?: "none" | "buddhist" | "gregorian";
  yearDigits?: 2 | 4;
  resetMonth?: number;
  sequenceDigits?: number;
};

export function formatMemberNumber(mode: "running" | "year" | "manual", sequence: number, format: MemberNumberFormat = {}) {
  if (mode === "manual") return "กรอกเอง";
  const legacyYearMode = mode === "year" && format.yearMode === "none";
  if (legacyYearMode) return `69-${String(sequence).padStart(5, "0")}`;
  const prefix = format.prefix ?? (mode === "year" ? "" : "M");
  const yearMode = format.yearMode ?? (mode === "year" ? "buddhist" : "none");
  const yearDigits = format.yearDigits === 4 ? 4 : 2;
  const resetMonth = Math.min(12, Math.max(1, format.resetMonth ?? 1));
  const now = new Date();
  const cycleYear = now.getMonth() + 1 < resetMonth ? now.getFullYear() - 1 : now.getFullYear();
  const yearValue = yearMode === "buddhist" ? cycleYear + 543 : cycleYear;
  const yearText = yearMode === "none" ? "" : String(yearValue).slice(yearDigits === 4 ? -4 : -2);
  const head = [prefix.trim(), yearText].filter(Boolean).join("-");
  const digits = Math.min(10, Math.max(1, format.sequenceDigits ?? (mode === "year" ? 5 : 6)));
  return `${head ? `${head}-` : ""}${String(sequence).padStart(digits, "0")}`;
}

export const navItems: { id: View; label: string; caption: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "ภาพรวม", caption: "สรุปการดำเนินงาน", icon: LayoutDashboard },
  { id: "pos", label: "หน้าร้าน / POS", caption: "ขายสินค้าและรับชำระ", icon: ShoppingCart },
  { id: "stock", label: "สต็อกสินค้า", caption: "รับเข้าและนับสต็อก", icon: PackageSearch },
  { id: "members", label: "สมาชิกและบัญชี", caption: "สมาชิกและเจ้าหน้าที่", icon: UsersRound },
  { id: "reports", label: "รายงาน", caption: "วิเคราะห์และส่งออก", icon: BarChart3 },
];

// NOTE (OLD-2-b): mock exports `products` + `stockRows` were DELETED — Pos.tsx and
// Stock.tsx now load real data via trpc.product.list / trpc.stock.rows.
// NOTE (OLD-2-c): mock exports `memberRows` + `memberTransactions` + `logs` were
// DELETED — Home.tsx / Dashboard.tsx views load real data via tRPC procedures
// (member.list / member.detail / logs.list / dashboard.stats).

export const money = (value: number) => `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;

// --- POS held bills (พักบิล) — device-local parking of the current bill ------
export const HELD_BILLS_KEY = "png-held-bills-v1";
export const HELD_BILLS_LIMIT = 6;

export type HeldBill = {
  id: number;
  savedAt: number;
  items: CartItem[];
  discount: string;
  memberNumber: string | null;
};

/** Reads parked bills from localStorage, dropping malformed/empty entries. */
export function loadHeldBills(): HeldBill[] {
  try {
    const raw = localStorage.getItem(HELD_BILLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HeldBill[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((bill) => bill && Array.isArray(bill.items) && bill.items.length > 0)
      .slice(0, HELD_BILLS_LIMIT);
  } catch {
    return [];
  }
}

// --- Scan / search code normalization ---------------------------------------
// Every lookup box in the app accepts: hand-typed text, a barcode-gun burst, or
// a QR payload. QR payloads arrive in many shapes (raw id, "MEMBER:M-000001",
// full URLs, even JSON), so every search path funnels through these helpers.

/** Strips characters barcode/QR payloads never carry and collapses whitespace. */
function cleanScanRaw(raw: string) {
  return raw.replace(/[\u0000-\u001f]+/g, " ").trim();
}

/** Keys we check inside decoded JSON / URL-query payloads. */
const SCAN_PAYLOAD_KEYS = ["memberNumber", "member", "memberNo", "m", "sku", "productCode", "code", "barcode", "id", "bill", "orderNumber", "order"] as const;

function firstPayloadValue(payload: Record<string, unknown>) {
  for (const key of SCAN_PAYLOAD_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Normalizes a scanned or typed code to comparable candidates:
 * e.g. "https://x/m/M-000001?foo" -> ["https://x/m/m-000001?foo", "m-000001", "000001"]
 * Callers match with `scanMatches(value, input)` (case-insensitive).
 */
export function scanCandidates(raw: string): string[] {
  const cleaned = cleanScanRaw(raw);
  if (cleaned === "") return [];
  const lowered = cleaned.toLowerCase();
  const out = new Set<string>([lowered]);
  // JSON payload: {"memberNumber":"M-000001"}
  if (lowered.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const value = firstPayloadValue(parsed);
      if (value) out.add(value.toLowerCase());
    } catch {
      /* not JSON — treat as plain text */
    }
  }
  // URL payload: https://host/path/M-000001?member=M-000001
  if (lowered.includes("://") || lowered.includes("www.")) {
    try {
      const url = new URL(cleaned);
      url.searchParams.forEach((value) => { if (value) out.add(value.toLowerCase()); });
      const lastSegment = url.pathname.split("/").filter(Boolean).pop();
      if (lastSegment) out.add(decodeURIComponent(lastSegment).toLowerCase());
    } catch {
      /* not a URL — fall through */
    }
  }
  // "MEMBER:M-000001" / "SKU;DRK-001" / "M-000001," — take the last token
  const tokens = lowered.split(/[:;|,>]/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length > 1) out.add(tokens[tokens.length - 1]);
  // digits-only variant (strip letter prefixes, dashes, zeros)
  const digits = lowered.replace(/[^0-9]/g, "");
  if (digits.length >= 4) out.add(digits);
  return Array.from(out);
}

/**
 * Shrinks a picked photo (JPG/PNG/WEBP) into a compact JPEG data URL so real
 * product photos can live inside the SQLite row without bloating the DB.
 */
export async function compressImageToDataUrl(file: File, maxEdge = 480, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/** True when any normalized form of `input` equals the normalized `value`. */
export function scanMatches(value: string | null | undefined, input: string): boolean {
  if (!value) return false;
  const needle = value.trim().toLowerCase();
  return needle !== "" && scanCandidates(input).includes(needle);
}

/**
 * Round 32-19 — ค้นหาแบบฉลาด: ให้คะแนนว่า `value` (เลขสมาชิก / SKU / บาร์โค้ด / ชื่อ)
 * ตรงกับคำค้น `input` แค่ไหน — รองรับพิมพ์บางส่วน (เลขสมาชิกตัดหน้า), ตัวเลข 3 ตัวท้าย
 * ของบาร์โค้ด/SKU, และคำ/ตัวอักษรในชื่อ ยิ่งตรงมากคะแนนยิ่งสูง (บวกเข้า candidate
 * ปกติของ scanCandidates เช่น QR URL ด้วย)
 */
export function smartMatchScore(value: string | null | undefined, input: string): number {
  if (!value) return 0;
  const needle = value.trim().toLowerCase();
  const raw = input.trim().toLowerCase();
  if (!needle || !raw) return 0;
  let best = 0;
  const seen: Record<string, boolean> = {};
  for (const candidate of [raw, ...scanCandidates(input)]) {
    if (candidate === "" || seen[candidate]) continue;
    seen[candidate] = true;
    if (candidate === needle) best = Math.max(best, 100);
    else if (needle.startsWith(candidate)) best = Math.max(best, candidate.length >= 3 ? 82 : 60);
    else if (needle.includes(candidate)) best = Math.max(best, candidate.length >= 3 ? 62 : 40);
    else if (needle.endsWith(candidate) && candidate.length >= 2) best = Math.max(best, 52); // เลข 3 ตัวท้าย SKU/บาร์โค้ด
  }
  return best;
}

/** Round 43 — คำนำหน้าชื่อที่เสนอในฟอร์ม (datalist) — พิมพ์อื่นได้เสมอ */
export const PRENAME_OPTIONS = ["นาย", "นาง", "นางสาว", "ด.ช.", "ด.ญ.", "แพทย์หญิง", "พ.อ.", "พ.ญ.", "พ.ต.", "พ.ต.ญ.", "ร.ท.", "ร.ท.ญ."];

/** ชื่อเต็มพร้อมคำนำหน้า — "นางสาว สมหญิง มั่นคง" (ไม่มีคำนำหน้า = ชื่อ นามสกุลตามเดิม) */
export function memberFullName(member: { prename?: string | null; firstName?: string | null; lastName?: string | null }): string {
  return [member.prename?.trim() || "", member.firstName?.trim() || "", member.lastName?.trim() || ""].filter(Boolean).join(" ");
}
