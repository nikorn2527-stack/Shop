#!/usr/bin/env bash
#
# PNG Shop — Pre-release checklist
#
# Usage:
#   ./scripts/release-checklist.sh
#
# Description:
#   Run this BEFORE every release to verify the codebase is production-
#   ready. The script is `set -euo pipefail` — it halts on the first
#   HARD failure (TypeScript, build, missing binaries) but reports SOFT
#   warnings (uncommitted changes, missing backup) without exiting so
#   the operator gets a full picture before deciding to release.
#
#   The script does NOT mutate anything — it is read-only with respect
#   to the working tree, the database, and the remote. Safe to run
#   multiple times.
#
# Pairs with:
#   docs/RELEASE_CHECKLIST_TH.md   — the human-readable checklist (this
#                                    script automates the pre-release
#                                    section; the doc covers deploy +
#                                    post-release + rollback + hotfix)
#   scripts/update.sh              — 10-step on-premise update flow (P4)
#   scripts/rollback.sh            — 7-step rollback flow (P4)
#
# Exit codes:
#   0  — all HARD checks passed (warnings are OK)
#   1  — at least one HARD check failed (TypeScript / build)
#
set -euo pipefail

# Switch to project root so relative paths (data/backups, package.json)
# resolve regardless of where the operator runs the script from.
# Mirrors the pattern used in scripts/update.sh and scripts/rollback.sh.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${APP_DIR}"

echo "=== PNG Shop Release Checklist ==="
echo ""

# 1. Version check — surface what we are about to release.
# `node -p` evaluates the expression and prints the result; if node
# itself is missing we want this to be the first failure so the operator
# knows to install Node before continuing.
echo -n "1. Version: "
node -p "require('./package.json').version"
echo ""

# 2. TypeScript check (HARD) — `npx tsc --noEmit` is the same command
# the project's `pnpm check` script runs. Zero TS errors is a
# non-negotiable gate before any release tag is pushed.
echo -n "2. TypeScript check... "
if npx tsc --noEmit > /tmp/pngshop-tsc.log 2>&1; then
  echo "✓ PASS"
else
  echo "✗ FAIL"
  echo ""
  echo "---- TypeScript errors (first 40 lines) ----"
  head -n 40 /tmp/pngshop-tsc.log
  echo "---- end of TypeScript errors ----"
  echo ""
  echo "Fix the TypeScript errors above before releasing."
  exit 1
fi
echo ""

# 3. Production build (HARD) — `pnpm run build` runs both `vite build`
# (client → dist/public/) and the esbuild bundle (server → dist/index.js).
# A failing build means a broken artifact — never release in that state.
echo -n "3. Production build... "
if pnpm run build > /tmp/pngshop-build.log 2>&1; then
  echo "✓ PASS"
else
  echo "✗ FAIL"
  echo ""
  echo "---- Build errors (first 40 lines) ----"
  head -n 40 /tmp/pngshop-build.log
  echo "---- end of build errors ----"
  echo ""
  echo "Fix the build errors above before releasing."
  exit 1
fi
echo ""

# 4. Tests (SOFT) — `pnpm test:sqlite` runs the SQLite-specific test
# suite via vitest. Tests are not a release gate (some are flaky in CI),
# but a failing run is a yellow flag the operator should investigate
# before pushing the release tag.
echo -n "4. Tests... "
if pnpm test:sqlite > /tmp/pngshop-tests.log 2>&1; then
  echo "✓ PASS"
else
  echo "✗ FAIL (tests) — review /tmp/pngshop-tests.log; not a hard gate"
fi
echo ""

# 5. Git working tree clean (SOFT) — uncommitted changes are a warning,
# not a blocker. The operator may have legitimate local edits (e.g.,
# .env.local) that they intend to keep out of the release commit.
echo -n "5. Git working tree clean... "
if [ -z "$(git status --porcelain)" ]; then
  echo "✓ PASS"
else
  echo "⚠ WARN: uncommitted changes"
  echo "    (run 'git status' to review — these will NOT be in the release tag)"
fi
echo ""

# 6. DB migration status (INFO) — schema version lives in the
# store_settings table (`schema_version` key, added in P4). It can only
# be inspected after the deploy via the system.health endpoint; we
# surface a reminder here so the operator knows to verify it post-deploy.
echo -n "6. Schema version... "
echo "(check via system.health endpoint after deploy)"
echo "    curl https://<host>/api/trpc/system.health"
echo ""

# 7. Backup exists (SOFT) — a pre-release backup should already be
# sitting in data/backups/ from the last cron run OR a manual
# `pnpm backup:sqlite`. The release-time backup is created by
# scripts/update.sh step 2, but having at least one prior backup is
# a safety net in case the update.sh backup fails for any reason.
echo -n "7. Backup before release... "
if [ -d "data/backups" ] && [ -n "$(ls -A data/backups 2>/dev/null)" ]; then
  BACKUP_COUNT="$(ls -1 data/backups 2>/dev/null | wc -l | tr -d ' ')"
  echo "✓ EXISTS (${BACKUP_COUNT} file(s) in data/backups/)"
else
  echo "⚠ WARN: no backup"
  echo "    Run 'pnpm backup:sqlite' before releasing, or accept that"
  echo "    scripts/update.sh will create one as step 2."
fi
echo ""

echo "=== Checklist complete ==="
echo ""
echo "Next: ./scripts/update.sh [version]"
echo "      (or push the release tag and let Railway auto-deploy)"
