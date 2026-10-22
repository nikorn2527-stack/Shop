/** Preserve punctuation in receipt/member identifiers when building a server substring query. */
export function normalizeBillSearch(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f]+/g, " ").trim();
  const keys = [
    "orderNumber",
    "bill",
    "order",
    "memberNumber",
    "member",
    "memberNo",
    "m",
    "code",
    "id",
  ];
  const value = (record: Record<string, unknown>) => {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim())
        return candidate.trim();
      if (typeof candidate === "number" && Number.isFinite(candidate))
        return String(candidate);
    }
  };
  if (cleaned.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return value(parsed as Record<string, unknown>) ?? cleaned;
    } catch {
      /* Incomplete scanner payloads remain editable as plain text. */
    }
  }
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const url = new URL(cleaned);
      for (const key of keys) {
        const candidate = url.searchParams.get(key);
        if (candidate?.trim()) return candidate.trim();
      }
      const segment = url.pathname.split("/").filter(Boolean).pop();
      if (segment) return decodeURIComponent(segment);
    } catch {
      /* Do not discard a partially typed URL. */
    }
  }
  return (
    cleaned
      .match(
        /^(?:bill|order|member|membernumber|code|sku)[:;|,>]\s*(.+)$/i
      )?.[1]
      ?.trim() || cleaned
  );
}
