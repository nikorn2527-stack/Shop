import { afterEach, describe, expect, it, vi } from "vitest";
import { BinaryBitmap, Code128Reader, HybridBinarizer, RGBLuminanceSource } from "@zxing/library";
import { code128Canvas } from "./barcode";

describe("printed Code128 identifiers", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["700111", "000001", "CARD-00001", "UX-WALLET-001"])("decodes %s with its original leading zeros and valid checksum", value => {
    // Rasterize the actual renderer's bars, then decode with an independent barcode reader.
    const rectangles: number[][] = [];
    const context = {
      fillStyle: "",
      fillRect(x: number, y: number, w: number, h: number) { if (this.fillStyle !== "#ffffff") rectangles.push([x, y, w, h]); },
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    vi.stubGlobal("document", { createElement: () => canvas });
    code128Canvas(value, { height: 96, moduleWidth: 2, padding: 20, showLabel: false });
    const pixels = new Uint8ClampedArray(canvas.width * canvas.height).fill(255);
    for (const [x, y, w, h] of rectangles) {
      for (let row = y; row < y + h; row++) pixels.fill(0, row * canvas.width + x, row * canvas.width + x + w);
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, canvas.width, canvas.height)));
    expect(new Code128Reader().decode(bitmap).getText()).toBe(value);
  });
});
