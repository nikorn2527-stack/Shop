/** Approved customer welcome screen. Custom uploads and explicit plain mode remain supported. */
export const DEFAULT_LOGIN_ORGANIZATION_NAME = "โรงพยาบาลธัญญารักษ์อุดรธานี";
export const DEFAULT_LOGIN_BACKGROUND = "/images/login-garden.webp";
export type LoginBackgroundMode = "default" | "custom" | "plain";
export function normalizeLoginBackgroundMode(mode: string | undefined): LoginBackgroundMode {
  return mode === "plain" || mode === "custom" ? mode : "default";
}
export function resolveLoginBackgroundImage(brand: { loginBackground?: string; loginBackgroundMode?: string }): string {
  const mode = normalizeLoginBackgroundMode(brand.loginBackgroundMode);
  if (mode === "plain") return "";
  const image = brand.loginBackground ?? "";
  if (image.length <= 1_500_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return image;
  return mode === "custom" ? "" : DEFAULT_LOGIN_BACKGROUND;
}
