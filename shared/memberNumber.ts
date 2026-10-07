export type MemberNumberMode = "running" | "year" | "manual";
export type MemberNumberFormat = {
  prefix?: string;
  yearMode?: "none" | "buddhist" | "gregorian";
  yearDigits?: 2 | 4;
  resetMonth?: number;
  sequenceDigits?: number;
  separator?: "-" | "/" | "_" | "";
};

export function memberNumberHead(mode: MemberNumberMode, format: MemberNumberFormat, now = new Date()) {
  // Preserve the historical year-mode format when no year format was configured.
  if (mode === "year" && format.yearMode === "none") {
    const endMonth = Math.min(12, Math.max(1, format.resetMonth ?? 12));
    const year = now.getFullYear() + (now.getMonth() + 1 > endMonth ? 1 : 0) + 543;
    return `${String(year).slice(-2)}-`;
  }
  const prefix = (format.prefix ?? (mode === "year" ? "" : "M")).trim();
  const yearMode = format.yearMode ?? (mode === "year" ? "buddhist" : "none");
  const endMonth = Math.min(12, Math.max(1, format.resetMonth ?? 12));
  const cycleYear = now.getFullYear() + (now.getMonth() + 1 > endMonth ? 1 : 0);
  const year = yearMode === "none" ? "" : String(cycleYear + (yearMode === "buddhist" ? 543 : 0)).slice(format.yearDigits === 4 ? -4 : -2);
  const separator = format.separator ?? "-";
  const head = [prefix, year].filter(Boolean).join(separator);
  return head ? head + separator : "";
}

export function nextMemberNumberSequence(members: readonly { memberNumber: string }[], mode: MemberNumberMode, format: MemberNumberFormat, now = new Date()) {
  if (mode === "manual") return 0;
  const head = memberNumberHead(mode, format, now);
  const prefix = (format.prefix ?? (mode === "year" ? "" : "M")).trim();
  const separator = format.separator ?? "-";
  const prefixHead = prefix ? prefix + separator : "";
  const yearMode = format.yearMode ?? (mode === "year" ? "buddhist" : "none");
  let max = 0;
  for (const member of members) {
    let suffix: string;
    if (mode === "year" || yearMode === "none") {
      if (!member.memberNumber.startsWith(head)) continue;
      suffix = member.memberNumber.slice(head.length);
    } else {
      if (!member.memberNumber.startsWith(prefixHead)) continue;
      const rest = member.memberNumber.slice(prefixHead.length);
      const digits = format.yearDigits === 4 ? 4 : 2;
      if (!/^\d+$/.test(rest.slice(0, digits)) || rest.slice(digits, digits + separator.length) !== separator) continue;
      suffix = rest.slice(digits + separator.length);
    }
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  return max + 1;
}