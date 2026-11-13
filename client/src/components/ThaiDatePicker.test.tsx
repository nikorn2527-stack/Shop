import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThaiDatePicker } from "./ThaiDatePicker";
import { ThaiDateRangePicker } from "./ThaiDateRangePicker";

// Render the open popup in the existing Node-only test environment.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useLayoutEffect: () => undefined, useState: (initial: unknown) => actual.useState(initial === false ? true : initial) };
});
vi.mock("react-dom", () => ({ createPortal: (children: unknown) => children }));

describe("calendar current day", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Bangkok has passed midnight while UTC is still on November 12.
    vi.setSystemTime(new Date("2026-11-12T18:30:00Z"));
    vi.stubGlobal("document", { body: {} });
    vi.stubGlobal("React", React);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function expectToday(html: string, selectedClasses: string[] = []) {
    const cell = html.match(/<button\b[^>]*aria-label="13 พฤศจิกายน 2569[^\"]*"[^>]*>/)?.[0];
    expect(cell).toBeDefined();
    expect(cell).toContain('aria-current="date"');
    const classes = cell?.match(/class="([^"]*)"/)?.[1].split(" ");
    expect(classes).toContain("today");
    for (const className of selectedClasses) expect(classes).toContain(className);
    expect(html.match(/aria-current="date"/g)).toHaveLength(1);
  }

  it("marks Bangkok today even when it is the selected single date", () => {
    expectToday(renderToStaticMarkup(createElement(ThaiDatePicker, { value: "2026-11-13", onChange: () => undefined })), ["picked"]);
  });

  it("keeps today distinct from another selected date", () => {
    expectToday(renderToStaticMarkup(createElement(ThaiDatePicker, { value: "2026-11-12", onChange: () => undefined })));
  });

  it.each([
    ["2026-11-13", "2026-11-15", ["picked", "in-range"]],
    ["2026-11-11", "2026-11-15", ["in-range"]],
  ])("marks today within range %s to %s", (from, to, classes) => {
    expectToday(renderToStaticMarkup(createElement(ThaiDateRangePicker, { from, to, onChange: () => undefined })), classes);
  });

  it("does not mark a date in another month as today", () => {
    const html = renderToStaticMarkup(createElement(ThaiDatePicker, { value: "2026-10-13", onChange: () => undefined }));
    expect(html).not.toContain('aria-current="date"');
  });
});
