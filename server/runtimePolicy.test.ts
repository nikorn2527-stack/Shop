import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimePolicy, resolveRuntimePolicy } from "./runtimePolicy";
import { ensureEditionFeature, resolveEditionStatus } from "./license";
const settings = { licenseKey: "", licenseName: "", trialStart: "2000-01-01" };
afterEach(() => vi.unstubAllEnvs());
describe("release channel policy", () => {
  it("keeps legacy security with full customer functionality when no channel was configured", () => {
    expect(resolveRuntimePolicy({})).toMatchObject({
      channel: "legacy",
      requirePosRegistration: true,
      forceInitialPasswordChange: true,
      enforceEditionLimits: false,
    });
  });
  it.each(["", "railway", "windows", "development", "typo"])(
    "rejects an unknown channel %s",
    channel => {
      expect(() =>
        resolveRuntimePolicy({ SHOP_RELEASE_CHANNEL: channel })
      ).toThrow();
    }
  );
  it("requires an explicit server channel, not a cloud hostname", () => {
    expect(
      resolveRuntimePolicy({
        RAILWAY_PROJECT_ID: "test",
        DEPLOYMENT_MODE: "cloud",
      }).enforceEditionLimits
    ).toBe(false);
  });
  it("enables Railway features without modifying stored licensing values", () => {
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    expect(getRuntimePolicy()).toMatchObject({
      requirePosRegistration: false,
      forceInitialPasswordChange: false,
      enforceEditionLimits: false,
    });
    const before = { ...settings };
    expect(resolveEditionStatus(settings)).toMatchObject({
      source: "managed",
      edition: "proplus",
      trialDaysLeft: null,
    });
    expect(() =>
      ensureEditionFeature(settings, "usersUnlimited")
    ).not.toThrow();
    expect(settings).toEqual(before);
  });
  it("keeps all features when moving to Windows while restoring its security policies", () => {
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "railway-live");
    expect(resolveEditionStatus(settings).source).toBe("managed");
    vi.stubEnv("SHOP_RELEASE_CHANNEL", "windows-final");
    expect(getRuntimePolicy().forceInitialPasswordChange).toBe(true);
    expect(resolveEditionStatus(settings)).toMatchObject({
      edition: "proplus",
      source: "managed",
    });
    expect(getRuntimePolicy().requirePosRegistration).toBe(true);
    expect(() => ensureEditionFeature(settings, "usersUnlimited")).not.toThrow();
  });
});
