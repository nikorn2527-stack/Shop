/**
 * Money + timezone + format helpers — Bangkok local time, 2-decimal rounding.
 *
 * Why: the original Shop set `process.env.TZ = "Asia/Bangkok"` on the server.
 * In Next.js (serverless/edge) we cannot rely on TZ env. Instead we format
 * timestamps at the boundary with `Intl.DateTimeFormat` + `date-fns-tz`.
 *
 * Money is stored as Float (SQLite REAL) but always rounded with `round2()`
 * so calculations stay exact to the satang.
 */

import { format, toZonedTime, fromZonedTime } from 'date-fns-tz'

export const STORE_TIMEZONE = 'Asia/Bangkok' as const

/** Round to 2 decimal places (Thai Baht). Uses Number.EPSILON to fix float drift. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Round to 4 decimals — used for money-mode unit price (e.g. ice sold by gram). */
export function round4(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

/** Format money as Thai Baht string: `฿1,240.00`. */
export function money(value: number): string {
  return `฿${value.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Compact baht for chart axis: `฿14.9k` / `฿1.2M`. */
export function compactBaht(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `฿${(value / 1_000).toFixed(1)}k`
  return `฿${value.toFixed(0)}`
}

/** Store timestamp as ISO UTC (Prisma DateTime). All DB writes go through this. */
export function nowUtc(): Date {
  return new Date()
}

/** Convert a UTC Date to Bangkok wall-time components (used for grouping by day). */
export function toBangkok(date: Date): Date {
  return toZonedTime(date, STORE_TIMEZONE)
}

/** Convert a Bangkok wall-time string "YYYY-MM-DD HH:MM:SS" back to UTC Date. */
export function fromBangkokString(text: string): Date {
  return fromZonedTime(text, STORE_TIMEZONE)
}

/** Format a UTC Date for display: `18 ก.ย. 2569 14:42`. */
export function formatThaiDateTime(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return format(toZonedTime(d, STORE_TIMEZONE), 'dd MMM yyyy HH:mm', {
    locale: undefined,
  }).replace(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/g, m => THAI_MONTHS_SHORT[m])
    .replace(/\b\d{4}\b/, y => String(Number(y) + 543))
}

/** Format a UTC Date for display: `18 ก.ย. 2569`. */
export function formatThaiDate(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return format(toZonedTime(d, STORE_TIMEZONE), 'dd MMM yyyy')
    .replace(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/g, m => THAI_MONTHS_SHORT[m])
    .replace(/\b\d{4}\b/, y => String(Number(y) + 543))
}

/** Format a UTC Date for display: `กันยายน 2569`. */
export function formatThaiMonthYear(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  const bangkok = toZonedTime(d, STORE_TIMEZONE)
  const month = THAI_MONTHS_FULL[bangkok.getMonth()]
  const year = bangkok.getFullYear() + 543
  return `${month} ${year}`
}

/** Format a UTC Date for display: `14:42`. */
export function formatThaiTime(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return format(toZonedTime(d, STORE_TIMEZONE), 'HH:mm')
}

/** Human-friendly "last activity" — `วันนี้ 14:24` / `เมื่อวาน 09:12` / `16 ก.ย. 09:12`. */
export function formatLastActivity(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const bangkokNow = toZonedTime(new Date(), STORE_TIMEZONE)
  const bangkokThen = toZonedTime(d, STORE_TIMEZONE)
  const diffMs = bangkokNow.getTime() - bangkokThen.getTime()
  const sameDay = bangkokNow.toDateString() === bangkokThen.toDateString()
  const yesterday = new Date(bangkokNow)
  yesterday.setDate(yangKerYesterday(yesterday))
  const isYesterday = yesterday.toDateString() === bangkokThen.toDateString()
  const time = format(bangkokThen, 'HH:mm')
  if (sameDay) return `วันนี้ ${time}`
  if (isYesterday) return `เมื่อวาน ${time}`
  return formatThaiDate(d)
}

function yangKerYesterday(d: Date): number {
  return d.getDate() - 1
}

/** Return Bangkok "YYYY-MM-DD" for a UTC date (used in date-range filters). */
export function bangkokDateString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(toZonedTime(d, STORE_TIMEZONE), 'yyyy-MM-dd')
}

/** Return Bangkok "YYYY-MM-DD HH:mm:ss" for a UTC date (lexicographically sortable). */
export function bangkokDateTimeString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(toZonedTime(d, STORE_TIMEZONE), 'yyyy-MM-dd HH:mm:ss')
}

/** Generate a Bangkok-local date range [start, end] as UTC Dates for Prisma queries. */
export function bangkokDateRange(fromIso?: string, toIso?: string): { gte?: Date; lte?: Date } {
  const out: { gte?: Date; lte?: Date } = {}
  if (fromIso) {
    // fromIso = "2026-09-18" → start of day Bangkok = UTC 2026-09-17T17:00:00Z
    out.gte = fromZonedTime(`${fromIso}T00:00:00`, STORE_TIMEZONE)
  }
  if (toIso) {
    out.lte = fromZonedTime(`${toIso}T23:59:59`, STORE_TIMEZONE)
  }
  return out
}

const THAI_MONTHS_SHORT: Record<string, string> = {
  Jan: 'ม.ค.',
  Feb: 'ก.พ.',
  Mar: 'มี.ค.',
  Apr: 'เม.ย.',
  May: 'พ.ค.',
  Jun: 'มิ.ย.',
  Jul: 'ก.ค.',
  Aug: 'ส.ค.',
  Sep: 'ก.ย.',
  Oct: 'ต.ค.',
  Nov: 'พ.ย.',
  Dec: 'ธ.ค.',
}

const THAI_MONTHS_FULL: Record<number, string> = {
  0: 'มกราคม',
  1: 'กุมภาพันธ์',
  2: 'มีนาคม',
  3: 'เมษายน',
  4: 'พฤษภาคม',
  5: 'มิถุนายน',
  6: 'กรกฎาคม',
  7: 'สิงหาคม',
  8: 'กันยายน',
  9: 'ตุลาคม',
  10: 'พฤศจิกายน',
  11: 'ธันวาคม',
}

export const THAI_MONTHS_SHORT_LIST = Object.values(THAI_MONTHS_SHORT)
export const THAI_MONTHS_FULL_LIST = Object.values(THAI_MONTHS_FULL)

/** Format with Thai day-of-week prefix: `พฤ 18 ก.ย. 2569`. */
const THAI_DAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
export function formatThaiDayDate(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  const bangkok = toZonedTime(d, STORE_TIMEZONE)
  const day = THAI_DAYS_SHORT[bangkok.getDay()]
  return `${day} ${formatThaiDate(d)}`
}
