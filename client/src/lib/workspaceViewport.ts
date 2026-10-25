/** One desktop coordinate system; screen size changes only its uniform scale. */
export const WORKSPACE_WIDTH = 1920;
export const WORKSPACE_HEIGHT = 900;
export function workspaceViewport(
  width: number,
  height: number,
  touch: boolean
) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0))
    throw new Error("Viewport dimensions must be positive finite numbers");
  // Keep small touch devices and narrow phone-sized windows usable without scaling.
  const mobile = width <= 820 || (touch && width < 1280);
  if (mobile)
    return {
      mode: "responsive" as const,
      width,
      height,
      scale: 1,
      left: 0,
      top: 0,
    };
  const scale = Math.min(width / WORKSPACE_WIDTH, height / WORKSPACE_HEIGHT);
  return {
    mode: "desktop" as const,
    width: WORKSPACE_WIDTH,
    height: WORKSPACE_HEIGHT,
    scale,
    left: Math.max(0, (width - WORKSPACE_WIDTH * scale) / 2),
    top: Math.max(0, (height - WORKSPACE_HEIGHT * scale) / 2),
  };
}
