import { describe, expect, it } from "vitest";
import { activeSearchSlot, type SearchSlot } from "./sharedSearch";

const slot = (id: string, priority: number, modal = false): SearchSlot => ({ id, label: id, priority, modal });
describe("shared search ownership", () => {
  it("falls back to global search when no screen registers", () => {
    expect(activeSearchSlot([])).toBeUndefined();
  });
  it("gives the modal's search precedence over the background page", () => {
    expect(activeSearchSlot([slot("pos", 10), slot("receive", 130, true)])?.id).toBe("receive");
  });
  it("keeps modal precedence regardless of registration order", () => {
    expect(activeSearchSlot([slot("wallet", 120, true), slot("stock", 10)])?.id).toBe("wallet");
  });
  it("uses the latest registered search for equal priorities", () => {
    expect(activeSearchSlot([slot("previous", 10), slot("current", 10)])?.id).toBe("current");
  });
  it("restores the screen search after removing the modal", () => {
    const slots = [slot("pos", 10), slot("wallet", 120, true)];
    expect(activeSearchSlot(slots.filter(item => item.id !== "wallet"))?.id).toBe("pos");
  });
});