import { describe, expect, it } from "vitest";
import {
  workspaceViewport,
  WORKSPACE_WIDTH,
  WORKSPACE_HEIGHT,
} from "./workspaceViewport";
describe("uniform desktop workspace", () => {
  it.each([
    [1891, 857],
    [1350, 606],
    [1359, 593],
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
    [1024, 600],
  ])("preserves one canvas and aspect ratio at %sx%s", (width, height) => {
    const v = workspaceViewport(width, height, false);
    expect(v.mode).toBe("desktop");
    expect(v.width).toBe(WORKSPACE_WIDTH);
    expect(v.height).toBe(WORKSPACE_HEIGHT);
    expect(v.width * v.scale + 2 * v.left).toBeCloseTo(width);
    expect(v.height * v.scale + 2 * v.top).toBeCloseTo(height);
    expect(v.left).toBeGreaterThanOrEqual(0);
    expect(v.top).toBeGreaterThanOrEqual(0);
    expect(Math.min(v.left, v.top)).toBeCloseTo(0);
  });
  it.each([
    [390, 844],
    [844, 390],
    [834, 1112],
    [1180, 820],
  ])("keeps small touch screens responsive at %sx%s", (w, h) => {
    expect(workspaceViewport(w, h, true)).toEqual({
      mode: "responsive",
      width: w,
      height: h,
      scale: 1,
      left: 0,
      top: 0,
    });
  });
  it("uses the desktop canvas for a large touch workstation", () =>
    expect(workspaceViewport(1920, 1080, true).mode).toBe("desktop"));
  it.each([
    [0, 900],
    [1920, 0],
    [-1, 900],
    [NaN, 900],
    [1920, Infinity],
  ])("rejects invalid viewport dimensions", (w, h) =>
    expect(() => workspaceViewport(w, h, false)).toThrow()
  );
});
