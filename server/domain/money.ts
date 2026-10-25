/** Preserve the existing business rounding until a separately verified numeric migration. */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** ฿-formatted money for log details, e.g. "฿1,240.00". */
export function money(value: number) {
  return `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
