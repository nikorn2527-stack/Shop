export type PosShortcutKeys = Record<string, string>;

export function parsePosShortcutKeys(serialized: string | null | undefined): PosShortcutKeys {
  try {
    const parsed: unknown = JSON.parse(serialized || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

export function getPosShortcutKey(keys: PosShortcutKeys, action: string, fallback = ""): string {
  const configured = keys[action] || "";
  return (configured || fallback).trim().toUpperCase();
}

export function matchesPosShortcut(
  event: Pick<KeyboardEvent, "key" | "code">,
  keys: PosShortcutKeys,
  action: string,
  fallback: string
): boolean {
  const assigned = getPosShortcutKey(keys, action, fallback);
  return assigned !== "" && assigned !== "ESC" &&
    (event.key.toUpperCase() === assigned || event.code.toUpperCase() === assigned);
}