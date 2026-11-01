/** Suggestions only: never infer an English spelling from a Thai name. */
export function suggestUsername(englishName: string, existingUsernames: readonly string[] = []): string {
  const parts = englishName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().split(/\s+/)
    .map(part => part.toLowerCase().replace(/[^a-z]/g, ""));
  if (parts.some(part => !part)) return "";
  const first = parts[0];
  const surname = parts.slice(1).join("");
  const taken = new Set(existingUsernames.map(name => name.trim().toLowerCase()));
  let base = first.slice(0, 30);
  if (surname) {
    for (let length = 1; length <= Math.min(surname.length, 28); length++) {
      const initial = surname.slice(0, length);
      base = `${first.slice(0, 29 - initial.length)}.${initial}`;
      if (!taken.has(base)) return base;
    }
  } else if (base.length < 3) return "";
  else if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(base.slice(0, 30 - String(suffix).length) + suffix)) suffix++;
  return base.slice(0, 30 - String(suffix).length) + suffix;
}

export function suggestReportName(fullName: string): string {
  const parts = fullName.trim().replace(/^(?:นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s+/, "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const surname = parts[parts.length - 1];
  // Thai leading vowels are not the surname initial, e.g. แสง → ส.
  const initial = surname.match(/[ก-ฮ]/)?.[0] ?? surname.match(new RegExp("\\p{L}", "u"))?.[0];
  return initial ? `${parts[0]}.${initial}` : parts[0];
}
