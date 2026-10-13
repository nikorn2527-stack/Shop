import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildThermalPageCss,
  getThermalPrintProfile,
  resolveThermalPaperWidth,
  resolveThermalPrintProfile,
  saveThermalPrintProfile,
  thermalContentLeftMm,
  THERMAL_PROFILE_PRESETS,
} from "./thermalPrint";

describe("thermal print profiles", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("provides the three supported paper presets", () => {
    expect(THERMAL_PROFILE_PRESETS["58"]).toMatchObject({ paperWidthMm: 58, printableWidthMm: 54 });
    expect(THERMAL_PROFILE_PRESETS["72"]).toMatchObject({ paperWidthMm: 72, printableWidthMm: 68 });
    expect(THERMAL_PROFILE_PRESETS["80"]).toMatchObject({ paperWidthMm: 80, printableWidthMm: 76 });
  });

  it("falls back to 72 mm for missing or invalid values", () => {
    expect(resolveThermalPaperWidth(undefined)).toBe("72");
    expect(resolveThermalPaperWidth("invalid")).toBe("72");
    expect(resolveThermalPrintProfile(null)).toEqual(THERMAL_PROFILE_PRESETS["72"]);
  });

  it("clamps unsafe calibration values", () => {
    expect(resolveThermalPrintProfile({
      printerName: "Test printer",
      paperWidthMm: 58,
      printableWidthMm: 100,
      horizontalOffsetMm: -20,
      bottomFeedMm: 99,
    })).toEqual({
      printerName: "Test printer",
      paperWidthMm: 58,
      printableWidthMm: 58,
      horizontalOffsetMm: -5,
      bottomFeedMm: 20,
    });
  });

  it("keeps the content inside the paper after applying horizontal offset", () => {
    expect(thermalContentLeftMm({ printerName: "", paperWidthMm: 80, printableWidthMm: 76, horizontalOffsetMm: -5, bottomFeedMm: 4 })).toBe(0);
    expect(thermalContentLeftMm({ printerName: "", paperWidthMm: 80, printableWidthMm: 76, horizontalOffsetMm: 5, bottomFeedMm: 4 })).toBe(4);
  });

  it.each([58, 72, 80] as const)("builds a %i mm page rule", width => {
    const profile = THERMAL_PROFILE_PRESETS[String(width) as "58" | "72" | "80"];
    const css = buildThermalPageCss(profile, 125, "receipt-paper");
    expect(css).toContain(`@page{size:${width}mm 125mm;margin:0}`);
    expect(css).toContain(`width:${profile.printableWidthMm}mm!important`);
    expect(css).toContain("#receipt-paper");
  });

  it("stores calibration separately for each paper preset", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        style: { setProperty: () => undefined },
      },
    });
    saveThermalPrintProfile({ printerName: "Printer A", paperWidthMm: 58, printableWidthMm: 52, horizontalOffsetMm: -1, bottomFeedMm: 6 });
    saveThermalPrintProfile({ printerName: "Printer B", paperWidthMm: 58, printableWidthMm: 50, horizontalOffsetMm: 1, bottomFeedMm: 8 });
    expect(getThermalPrintProfile(58, "Printer A")).toMatchObject({ printerName: "Printer A", printableWidthMm: 52, horizontalOffsetMm: -1, bottomFeedMm: 6 });
    expect(getThermalPrintProfile(58, "Printer B")).toMatchObject({ printerName: "Printer B", printableWidthMm: 50, horizontalOffsetMm: 1, bottomFeedMm: 8 });
    expect(getThermalPrintProfile(72)).toEqual(THERMAL_PROFILE_PRESETS["72"]);
  });
});