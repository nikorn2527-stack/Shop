// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { usePickerNavigation } from "./usePickerNavigation";

afterEach(() => { cleanup(); document.body.replaceChildren(); });

function event(key: string) {
  return { key, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent<HTMLInputElement>;
}

describe("usePickerNavigation state and ARIA", () => {
  function setup() {
    const callbacks = { onOpen: vi.fn(), onClose: vi.fn(), onPick: vi.fn(), onCommit: vi.fn() };
    const hook = renderHook(({ keys, open }) => usePickerNavigation({ keys, open, ...callbacks }), {
      initialProps: { keys: ["a / ไทย", "b"], open: true },
    });
    return { ...hook, callbacks };
  }
  it("invalidates a removed result and falls back to commit instead of picking a stale key", () => {
    const { result, rerender, callbacks } = setup();
    act(() => result.current.onKeyDown(event("ArrowDown")));
    rerender({ keys: ["b"], open: true });
    expect(result.current.activeKey).toBeNull();
    expect(result.current.inputProps["aria-activedescendant"]).toBeUndefined();
    act(() => result.current.onKeyDown(event("Enter")));
    expect(callbacks.onPick).not.toHaveBeenCalled();
    expect(callbacks.onCommit).toHaveBeenCalledOnce();
  });
  it("clears highlights when closed and gives each instance unique, encoded option IDs", () => {
    const first = setup();
    const second = setup();
    expect(first.result.current.listId).not.toBe(second.result.current.listId);
    expect(first.result.current.optionId("a / ไทย")).toContain(encodeURIComponent("a / ไทย"));
    act(() => first.result.current.onKeyDown(event("ArrowDown")));
    first.rerender({ keys: ["a / ไทย", "b"], open: false });
    first.rerender({ keys: ["a / ไทย", "b"], open: true });
    expect(first.result.current.activeKey).toBeNull();
  });
  it("scrolls only the list vertically to reveal a highlighted row", () => {
    const { result } = setup();
    const list = document.createElement("div");
    list.id = result.current.listId;
    list.scrollLeft = 17;
    list.getBoundingClientRect = () => ({ top: 100, bottom: 200 }) as DOMRect;
    const row = document.createElement("button");
    row.id = result.current.optionId("a / ไทย");
    row.getBoundingClientRect = () => ({ top: 220, bottom: 250 }) as DOMRect;
    list.append(row);
    document.body.append(list);
    act(() => result.current.onKeyDown(event("ArrowDown")));
    expect(list.scrollTop).toBe(50);
    expect(list.scrollLeft).toBe(17);
    act(() => result.current.reset());
    row.getBoundingClientRect = () => ({ top: 80, bottom: 110 }) as DOMRect;
    act(() => result.current.onKeyDown(event("ArrowDown")));
    expect(list.scrollTop).toBe(30);
    expect(list.scrollLeft).toBe(17);
  });
});
