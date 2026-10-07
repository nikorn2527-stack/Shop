import { nextMemberNumberSequence } from "../../../shared/memberNumber";
import { TRPCClientError } from "@trpc/client";

/**
 * Shared formatting helpers for the store views (Dashboard/Home). The backend
 * returns raw values (numbers, ISO-ish timestamps, english status keys) while
 * the original mock data shipped preformatted Thai strings — these helpers
 * replicate the mock display formats against real API data.
 */

/** Extracts the Thai user-facing message from a tRPC error. */
export function getErrorMessage(error: unknown) {
  if (error instanceof TRPCClientError) return error.message;
  return "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ กรุณาลองอีกครั้ง";
}

export const MEMBER_STATUS_META: Record<"active" | "suspended", { label: string; tone: string }> = {
  active: { label: "ใช้งานอยู่", tone: "green" },
  suspended: { label: "ระงับการใช้งาน", tone: "red" },
};

export const WALLET_TX_META: Record<string, { label: string; tone: string }> = {
  purchase: { label: "ซื้อสินค้า", tone: "blue" },
  deposit: { label: "เติมเงิน", tone: "green" },
  withdrawal: { label: "ถอนเงิน", tone: "purple" },
  // ROUND 65 — ประเภทใหม่ตามรายงานโรงพยาบาล (เปิดใช้บัตร / คืนบัตรเงินสด)
  activation: { label: "เปิดใช้บัตร", tone: "green" },
  refund: { label: "คืนบัตรเงินสด", tone: "amber" },
};

const THAI_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const THAI_LONG_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Backend stores local wall-time timestamps like "2026-09-18 14:42:33". */
export function parseStoreDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateTime(value: string) {
  return value.length === 10 ? `${value}T00:00:00` : value;
}

export function isSameMonth(date: Date | null, reference: Date) {
  if (!date) return false;
  return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth();
}

export function isSameDay(date: Date | null, reference: Date) {
  return isSameMonth(date, reference) && date!.getDate() === reference.getDate();
}

/** "2026-09-18" or "2026-09-18 14:42:33" → "18 ก.ย. 2569" */
export function formatThaiDate(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : parseStoreDate(value ? toDateTime(value) : null);
  if (!date) return value ? String(value) : "-";
  return `${date.getDate()} ${THAI_SHORT_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
}

/** "2026-09-18" → "18 ก.ย." */
export function formatShortDay(value: string) {
  const date = parseStoreDate(toDateTime(value));
  return date ? `${date.getDate()} ${THAI_SHORT_MONTHS[date.getMonth()]}` : value;
}

/** "2026-09-18" → "กันยายน 2569" */
export function formatThaiMonthYear(value: string) {
  const date = parseStoreDate(toDateTime(value));
  return date ? `${THAI_LONG_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}` : value;
}

/** Audit log timestamp → "18 ก.ย. 2569 14:42" (Logs table). */
export function formatLogDateTime(value: string) {
  const date = parseStoreDate(value);
  return date ? `${formatThaiDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}` : value;
}

/** Transaction timestamp → "17 ก.ย. 2569 · 14:38" (member history). */
export function formatHistoryDate(value: string) {
  const date = parseStoreDate(value);
  return date ? `${formatThaiDate(date)} · ${pad2(date.getHours())}:${pad2(date.getMinutes())}` : value;
}

/** Timestamp → "14:38" (dashboard recent activity). */
export function formatTimeShort(value: string) {
  const date = parseStoreDate(value);
  return date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : value;
}

/** lastTransactionAt → "วันนี้ 14:24" / "เมื่อวาน 09:12" / "16 ก.ย. 09:12" / "ยังไม่มีรายการ". */
export function formatLastActivity(value: string | null | undefined) {
  const date = parseStoreDate(value);
  if (!date) return "ยังไม่มีรายการ";
  const now = new Date();
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameDay(date, now)) return `วันนี้ ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `เมื่อวาน ${time}`;
  return `${date.getDate()} ${THAI_SHORT_MONTHS[date.getMonth()]} ${time}`;
}

/** Compact axis label: 15000 → "15k", 0 → "0". */
export function formatAxisLabel(value: number) {
  if (value <= 0) return "0";
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

/** Parses the ฿ amount out of an audit-log detail like "M-000218 · ฿500.00 · เงินสด". */
export function parseBahtFromDetail(detail: string | null | undefined) {
  const match = (detail ?? "").match(/฿([\d,]+(?:\.\d+)?)/);
  return match ? Number(match[1].replaceAll(",", "")) : 0;
}

/** Mirrors the backend numbering rules to preview the next member number client-side. */
export function nextMemberSequence(members: readonly { memberNumber: string }[], mode: "running" | "year" | "manual", format: { prefix?: string; yearMode?: "none" | "buddhist" | "gregorian"; yearDigits?: 2 | 4; resetMonth?: number; separator?: "-" | "/" | "_" | "" } = {}) {
  return nextMemberNumberSequence(members, mode, format);
}
