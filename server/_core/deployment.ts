/**
 * P5 (one codebase — cloud + on-premise) — Deployment-mode helpers.
 *
 * The PNG Shop ships the same Node.js + tRPC + node:sqlite codebase to two
 * production deployment targets that have very different operational
 * characteristics:
 *
 *   • Cloud (e.g. Railway) — managed infra, ephemeral filesystem, HTTPS
 *     terminated by the platform, DB either persisted on a volume or
 *     pushed to an external service.
 *   • On-Premise — Docker/VM inside the customer's network, persistent
 *     local disk for `/data`, `/uploads`, `/config`, `/backups`, `/logs`,
 *     customer-operated update + rollback via `scripts/update.sh` and
 *     `scripts/rollback.sh`.
 *
 * Everything that needs to behave differently between the two is driven
 * off the `DEPLOYMENT_MODE` env var so that:
 *   - application code stays in one branch (`main-v2`)
 *   - the Dockerfile and `docker-compose.yml` work for both targets
 *   - `scripts/update.sh` / `scripts/rollback.sh` can warn or branch on
 *     the target without needing a separate codebase
 *
 * Mirrors `server/_core/env.ts` (plain object + getters, no runtime
 * dependencies). Kept side-effect free so importing it from anywhere
 * (server entrypoint, scripts, tests) is safe.
 */

/** The three deployment modes the codebase understands. */
export type DeploymentMode = "cloud" | "onpremise" | "development";

/**
 * Cloud provider identifier. Only meaningful when `DEPLOYMENT_MODE=cloud`.
 * Used by the health endpoint / release log for traceability — does not
 * change application behaviour.
 */
export type CloudProvider = "aws" | "gcp" | "azure" | "railway" | string;

/**
 * Normalise an arbitrary env-var value into one of the three known
 * deployment modes. Unknown / empty values collapse to "development" so
 * a misconfigured box never silently runs as cloud/on-premise.
 *
 * The check is intentionally case-insensitive and trim-tolerant so
 * `ONPREMISE`, `on-premise`, `onPremise` etc. all map correctly.
 */
export function getDeploymentMode(): DeploymentMode {
  const raw = (process.env.DEPLOYMENT_MODE ?? "").trim().toLowerCase();
  if (raw === "cloud") return "cloud";
  if (raw === "onpremise" || raw === "on-premise" || raw === "on_premise") {
    return "onpremise";
  }
  if (raw === "development" || raw === "dev" || raw === "") {
    return "development";
  }
  // Unknown value → safest default is "development" (no cloud-only
  // optimisations, no on-premise file-path assumptions).
  return "development";
}

/** True when running on a managed cloud provider (Railway, AWS, …). */
export function isCloud(): boolean {
  return getDeploymentMode() === "cloud";
}

/** True when running on a customer-controlled server / VM / container. */
export function isOnPremise(): boolean {
  return getDeploymentMode() === "onpremise";
}

/**
 * True when no explicit deployment mode has been configured — the typical
 * state for `pnpm dev` on a developer's laptop. Behaves like on-premise
 * for path purposes but skips the production-only steps in
 * `scripts/update.sh` (e.g. git fetch from origin).
 */
export function isDevelopment(): boolean {
  return getDeploymentMode() === "development";
}

/**
 * Full deployment descriptor. Surfaced via the `system.health` tRPC
 * procedure so an operator can verify which target a given instance is
 * running as before/after an update or rollback.
 *
 * All fields except `mode` are optional and only meaningful for cloud
 * deployments; on-premise installs typically leave them blank because
 * the box is self-contained.
 */
export type DeploymentInfo = {
  mode: DeploymentMode;
  /** Cloud provider name when `mode === "cloud"`, otherwise `null`. */
  cloudProvider: CloudProvider | null;
  /** Cloud region (e.g. "ap-southeast-1", "asia-southeast1") — cloud only. */
  region: string | null;
  /**
   * Data residency policy tag (e.g. "thailand"). Useful for audits —
   * set explicitly for both cloud and on-premise when the customer's
   * contract requires data to stay within a specific jurisdiction.
   */
  dataResidency: string | null;
};

/**
 * Read the full deployment descriptor from env vars. Reads:
 *   - `DEPLOYMENT_MODE`  (cloud / onpremise / development; default dev)
 *   - `CLOUD_PROVIDER`   (aws / gcp / azure / railway — optional)
 *   - `CLOUD_REGION`     (optional)
 *   - `DATA_RESIDENCY`   (optional — e.g. "thailand")
 *
 * The function never throws — every field is read defensively so that a
 * missing or malformed env var results in `null` rather than a crash.
 */
export function getDeploymentInfo(): DeploymentInfo {
  const mode = getDeploymentMode();

  const cloudProviderRaw = (process.env.CLOUD_PROVIDER ?? "").trim();
  const cloudProvider: CloudProvider | null =
    cloudProviderRaw.length > 0 ? cloudProviderRaw.toLowerCase() : null;

  const regionRaw = (process.env.CLOUD_REGION ?? "").trim();
  const region: string | null = regionRaw.length > 0 ? regionRaw : null;

  const dataResidencyRaw = (process.env.DATA_RESIDENCY ?? "").trim();
  const dataResidency: string | null =
    dataResidencyRaw.length > 0 ? dataResidencyRaw.toLowerCase() : null;

  return {
    mode,
    cloudProvider,
    region,
    dataResidency,
  };
}
