/** Accept ISO or day/month/year; years 2400+ are Buddhist calendar years. */
export function normalizeExpiryDate(value: string): string | null {
  const text = value.trim();
  if (!text) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const thai = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(text);
  if (!iso && !thai) return null;
  let year = Number(iso ? iso[1] : thai![3]);
  if (!iso && year >= 2400) year -= 543;
  const month = Number(iso ? iso[2] : thai![2]);
  const day = Number(iso ? iso[3] : thai![1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}