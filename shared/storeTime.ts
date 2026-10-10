export const STORE_TIME_ZONE = "Asia/Bangkok";

/** Unzoned store timestamps are Bangkok wall time, not browser-local time. */
export function parseBangkokDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const text = value.trim();
  const wallTime = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(text);
  const normalized = wallTime
    ? (text.length === 10 ? `${text}T00:00:00` : text.replace(" ", "T")) + "+07:00"
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function bangkokParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function formatBangkokTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: STORE_TIME_ZONE,
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}