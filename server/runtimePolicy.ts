/** Server-owned release policy. No database writes or client-selectable overrides. */
export type ReleaseChannel = "legacy" | "railway-live" | "windows-final";
export function resolveRuntimePolicy(env: Record<string, string | undefined>) {
  const channel = (env.SHOP_RELEASE_CHANNEL ?? "legacy").trim();
  if (!["legacy", "railway-live", "windows-final"].includes(channel)) {
    throw new Error(`Unknown SHOP_RELEASE_CHANNEL: ${channel}`);
  }
  const relaxed = channel === "railway-live";
  return {
    channel: channel as ReleaseChannel,
    requirePosRegistration: !relaxed,
    forceInitialPasswordChange: !relaxed,
    enforceEditionLimits: !relaxed,
  };
}
export const getRuntimePolicy = () => resolveRuntimePolicy(process.env);
