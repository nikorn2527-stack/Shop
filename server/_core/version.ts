/**
 * P4 (release/rollback) — Version tracking for the PNG Shop.
 *
 * Reads the app version from `package.json` (`wellbeing-hospital-store`)
 * and exposes runtime/build metadata so the health check endpoint, the
 * installer hand-over doc and the release log can all reference the same
 * canonical version string.
 *
 * Works in BOTH run modes:
 *   • `pnpm dev` (tsx watch on `server/_core/index.ts`) — version.ts is
 *     loaded directly, `import.meta.url` points at this source file.
 *   • `pnpm start` (esbuild bundles into `dist/index.js`) — the bundle
 *     inlines package.json, but we still need a real on-disk file to stat
 *     for `buildDate`. We walk up from `import.meta.url` until we find a
 *     `package.json`, then derive the project root + dist/ from it.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const requireFromHere = createRequire(import.meta.url);

/**
 * Resolve the absolute path of `package.json` by walking up from this
 * file's location. In dev (tsx) `import.meta.url` is the source file in
 * `server/_core/`, so the project root is two levels up. In the esbuild
 * bundle the source map is collapsed but `import.meta.url` still
 * resolves to the bundle file path, and we walk up to find package.json.
 */
function findPackageJsonPath(): string | null {
  let here = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = resolve(here, "package.json");
    try {
      requireFromHere(candidate);
      return candidate;
    } catch {
      // not found at this level — go up one directory
    }
    const parent = dirname(here);
    if (parent === here) break; // filesystem root reached
    here = parent;
  }
  return null;
}

const PACKAGE_JSON_PATH = findPackageJsonPath();

type PackageJsonShape = { name?: string; version?: string };

function readPackageJson(): PackageJsonShape {
  if (!PACKAGE_JSON_PATH) return {};
  try {
    return requireFromHere(PACKAGE_JSON_PATH) as PackageJsonShape;
  } catch {
    return {};
  }
}

const PKG = readPackageJson();

/** The canonical semver string of the running build (e.g. "1.0.0"). */
export function getVersion(): string {
  const version = (PKG.version ?? "").trim();
  if (!version) {
    // Should never happen — package.json declares `version: "1.0.0"` — but
    // we'd rather report "0.0.0" than `undefined`/empty if the file is
    // missing so downstream consumers (logs, audit) keep a parseable value.
    return "0.0.0";
  }
  return version;
}

export type VersionInfo = {
  /** App semver from package.json */
  version: string;
  /** Node.js runtime version string, e.g. "v20.10.0" */
  nodeVersion: string;
  /** OS platform, e.g. "linux" / "darwin" / "win32" */
  platform: string;
  /**
   * Build timestamp (ISO string) — derived from the mtime of this module's
   * directory. In dev mode that is the `server/_core/` source folder; in
   * production (`pnpm start` against `dist/index.js`) it is the `dist/`
   * folder, whose mtime reflects when `pnpm build` last ran.
   *
   * `null` when the directory cannot be stat'd (rare — read-only
   * container without stat permission on the bundle directory).
   */
  buildDate: string | null;
};

/**
 * Full runtime/build descriptor. Used by:
 *   • `system.health` tRPC procedure — surfaces `version` to monitoring
 *   • `scripts/update.sh` — writes the same `version` into release_logs
 *   • `docs/RELEASE_TEMPLATE_TH.md` — hand-over doc records Node/platform
 */
export function getVersionInfo(): VersionInfo {
  let buildDate: string | null = null;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const stats = statSync(here);
    buildDate = stats.mtime.toISOString();
  } catch {
    buildDate = null;
  }
  return {
    version: getVersion(),
    nodeVersion: process.version,
    platform: process.platform,
    buildDate,
  };
}
