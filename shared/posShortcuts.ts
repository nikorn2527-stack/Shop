export type PosShortcutKeys = Record<string, string>;

export function parsePosShortcutKeys(
  serialized: string | null | undefined
): PosShortcutKeys {
  try {
    const parsed: unknown = JSON.parse(serialized || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

export function getPosShortcutKey(
  keys: PosShortcutKeys,
  action: string,
  fallback = ""
): string {
  const configured = keys[action]?.trim() || "";
  return (configured || fallback).trim().toUpperCase();
}

export function matchesPosShortcut(
  event: Pick<KeyboardEvent, "key" | "code">,
  keys: PosShortcutKeys,
  action: string,
  fallback: string
): boolean {
  const assigned = getPosShortcutKey(keys, action, fallback);
  return (
    assigned !== "" &&
    assigned !== "ESC" &&
    (event.key.toUpperCase() === assigned ||
      event.code.toUpperCase() === assigned)
  );
}
/** Effective defaults must participate in validation even when no override was saved. */
export const POS_SHORTCUT_ACTIONS = [
  { action: "scan", label: "สแกน", key: "F8" },
  { action: "customer", label: "ลูกค้า", key: "F1" },
  { action: "deposit", label: "เติมเงิน", key: "F2" },
  { action: "withdraw", label: "ถอนเงิน", key: "F3" },
  { action: "card", label: "คืนบัตร", key: "" },
  { action: "special", label: "รายการพิเศษ", key: "F4" },
  { action: "hold", label: "พักบิล", key: "F5" },
  { action: "register", label: "สมาชิกใหม่", key: "F6" },
  { action: "manage", label: "จัดแผง", key: "F7" },
  { action: "receive", label: "รับเข้าสินค้า", key: "F9" },
  { action: "add", label: "เพิ่มสินค้าใหม่", key: "F10" },
] as const;

export function findPosShortcutConflicts(
  serialized: string | null | undefined,
  hiddenSerialized: string | null | undefined
) {
  const keys = parsePosShortcutKeys(serialized);
  let hidden: unknown;
  try {
    hidden = JSON.parse(hiddenSerialized || "[]");
  } catch {
    hidden = [];
  }
  const hiddenActions = new Set(
    Array.isArray(hidden) ? hidden.filter(item => typeof item === "string") : []
  );
  const assigned = new Map<string, { actions: string[]; labels: string[] }>();
  for (const entry of POS_SHORTCUT_ACTIONS) {
    if (hiddenActions.has(entry.action)) continue;
    const key = getPosShortcutKey(keys, entry.action, entry.key);
    if (!key) continue;
    const group = assigned.get(key) ?? { actions: [], labels: [] };
    group.actions.push(entry.action);
    group.labels.push(entry.label);
    assigned.set(key, group);
  }
  return Array.from(assigned)
    .filter(([, group]) => group.actions.length > 1)
    .map(([key, group]) => ({ key, ...group }));
}

export function posShortcutConflictMessage(
  conflict: ReturnType<typeof findPosShortcutConflicts>[number]
) {
  return `คีย์ ${conflict.key} ใช้ซ้ำกันในเมนู ${conflict.labels.join(" / ")} กรุณาเลือกคีย์อื่น`;
}
