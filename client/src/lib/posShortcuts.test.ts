import { describe, expect, it } from "vitest";
import { getPosShortcutKey, matchesPosShortcut, parsePosShortcutKeys } from "./posShortcuts";

describe("POS shortcut settings", () => {
  it("uses the configured key in labels and keyboard matching", () => {
    const keys = parsePosShortcutKeys('{"hold":"f7"}');

    expect(getPosShortcutKey(keys, "hold", "F5")).toBe("F7");
    expect(matchesPosShortcut({ key: "F7", code: "F7" }, keys, "hold", "F5")).toBe(true);
    expect(matchesPosShortcut({ key: "F5", code: "F5" }, keys, "hold", "F5")).toBe(false);
  });

  it("falls back safely for empty, malformed, or non-object settings", () => {
    expect(getPosShortcutKey(parsePosShortcutKeys('{"hold":""}'), "hold", "F5")).toBe("F5");
    expect(getPosShortcutKey(parsePosShortcutKeys("not-json"), "hold", "F5")).toBe("F5");
    expect(parsePosShortcutKeys("[]")).toEqual({});
  });

  it("keeps the legacy limit key compatible with the card action", () => {
    expect(getPosShortcutKey(parsePosShortcutKeys('{"limit":"home"}'), "card")).toBe("HOME");
  });
});