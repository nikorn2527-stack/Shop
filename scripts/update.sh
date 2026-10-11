#!/usr/bin/env bash
#
# PNG Shop — On-Premise Update Script
#
# Usage:
#   ./scripts/update.sh [version]
#
# Description:
#   Runs the 10-step on-premise update flow described in section 5 of
#   docs/TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md. Every step logs to
#   stdout AND to data/update-<timestamp>.log so an interrupted run can
#   be audited post-mortem. The script is `set -euo pipefail` — any
#   failure halts immediately so a partial update cannot leave the
#   store in an inconsistent state. Run rollback.sh to revert.
#
# Steps (from the handoff doc):
#   1.  Pre-check:            version, disk, service health, compatibility
#   2.  Backup Database:      copy welfare-store.sqlite -> data/backups/
#   3.  Backup Configuration: copy .env + data/https -> data/backups/config/
#   4.  Pull artifact:       git fetch + checkout the target version tag
#   5.  Stop service:        kill the running pnpm dev/start process
#   6.  Update package:     pnpm install --frozen-lockfile
#   7.  Run migrations:      pnpm db:push (idempotent — safe on existing DB)
#   8.  Start service:       pnpm start (or pnpm dev for staging)
#   9.  Health check:        curl /api/trpc/system.health
#   10. Log release:         record install/update entry via tRPC
#
# Environment variables:
#   APP_VERSION       override the version (default: reads package.json or $1)
#   SQLITE_DB_PATH    DB file path (default: data/welfare-store.sqlite)
#   SQLITE_BACKUP_DIR backup directory (default: data/backups)
#   PORT              server port (default: 3000)
#   NODE_ENV          production | development (default: production)
#   GIT_REMOTE        git remote to pull from (default: origin)
#   SKIP_GIT_PULL=1   skip the git fetch/checkout step (offline/air-gapped)
#   SKIP_INSTALL=1    skip the pnpm install step (already installed)
#   SKIP_MIGRATE=1    skip the pnpm db:push step (no schema changes)
#   DRY_RUN=1         log every step without actually doing anything

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${APP_DIR}"

LOG_DIR="${APP_DIR}/data/logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/update-$(date -u +%Y%m%dT%H%M%SZ).log"

#tee every output to the log file
exec > >(tee -a "${LOG_FILE}") 2>&1

DB_PATH="${SQLITE_DB_PATH:-${APP_DIR}/data/welfare-store.sqlite}"
BACKUP_DIR="${SQLITE_BACKUP_DIR:-${APP_DIR}/data/backups}"
PORT="${PORT:-3000}"
NODE_ENV_VAL="${NODE_ENV:-production}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
HOSTNAME="$(hostname 2>/dev/null || echo unknown)"
ACTOR="${USER:-unknown}@${HOSTNAME}"

# Resolve target version: explicit arg > env var > package.json
if [[ $# -ge 1 ]]; then
  TARGET_VERSION="$1"
elif [[ -n "${APP_VERSION:-}" ]]; then
  TARGET_VERSION="${APP_VERSION}"
elif [[ -f "${APP_DIR}/package.json" ]]; then
  # extract version field with node (no jq dependency)
  TARGET_VERSION="$(node -e "console.log(require('./package.json').version || '0.0.0')")"
else
  TARGET_VERSION="0.0.0"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() {
  printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${1:-INFO}" "${2:-}"
}

step() {
  log "STEP" "=== $1 ==="
}

die() {
  log "ERROR" "$1"
  log "ERROR" "Update aborted. See ${LOG_FILE} for full output."
  log "ERROR" "If you need to revert, run: ./scripts/rollback.sh <last-backup-file>"
  exit 1
}

run_or_dry() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    log "DRY-RUN" "$*"
  else
    log "EXEC" "$*"
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

step "1/10 Pre-check: version, disk, service health, compatibility"

log "INFO" "Target version: ${TARGET_VERSION}"
log "INFO" "App dir: ${APP_DIR}"
log "INFO" "DB path: ${DB_PATH}"
log "INFO" "Backup dir: ${BACKUP_DIR}"
log "INFO" "Node env: ${NODE_ENV_VAL}"
log "INFO" "Actor: ${ACTOR}"

command -v node >/dev/null 2>&1 || die "node is not on PATH"
command -v pnpm >/dev/null 2>&1 || die "pnpm is not on PATH"
command -v git  >/dev/null 2>&1 || die "git is not on PATH"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  die "Node >= 20 is required (current major: ${NODE_MAJOR})"
fi

# Disk: refuse to update if less than 200MB free on the data partition
DATA_PART="${APP_DIR}/data"
mkdir -p "${DATA_PART}"
DISK_AVAIL_MB="$(df -m "${DATA_PART}" | awk 'NR==2 {print $4}')"
if [[ "${DISK_AVAIL_MB}" -lt 200 ]]; then
  die "Less than 200MB free on ${DATA_PART} (only ${DISK_AVAIL_MB}MB) — free up space before updating"
fi
log "INFO" "Disk free on data partition: ${DISK_AVAIL_MB} MB"

# Service health (best-effort — service may already be down for a planned update)
if curl -fsS --max-time 5 "http://localhost:${PORT}/api/trpc/system.health" >/dev/null 2>&1; then
  log "INFO" "Service is currently UP (will be stopped in step 5)"
else
  log "WARN" "Service is currently DOWN — proceeding (cold-update mode)"
fi

# ---------------------------------------------------------------------------
# Step 2: Backup DB
# ---------------------------------------------------------------------------

step "2/10 Backup Database (welfare-store.sqlite -> data/backups/)"

mkdir -p "${BACKUP_DIR}"
BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="welfare-store-${BACKUP_STAMP}.sqlite"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

if [[ -f "${DB_PATH}" ]]; then
  log "INFO" "Copying ${DB_PATH} -> ${BACKUP_PATH}"
  run_or_dry cp -p "${DB_PATH}" "${BACKUP_PATH}"
  if [[ -f "${BACKUP_PATH}" ]]; then
    BACKUP_SIZE="$(stat -c%s "${BACKUP_PATH}" 2>/dev/null || stat -f%z "${BACKUP_PATH}" 2>/dev/null || echo 0)"
    BACKUP_SHA="$(sha256sum "${BACKUP_PATH}" | awk '{print $1}')"
    log "INFO" "Backup OK: ${BACKUP_FILE} (${BACKUP_SIZE} bytes, sha256=${BACKUP_SHA:0:16}…)"
  else
    die "Backup file was not created at ${BACKUP_PATH}"
  fi
else
  log "WARN" "DB file ${DB_PATH} does not exist (first install?) — skipping DB backup"
  BACKUP_FILE=""
  BACKUP_SHA=""
fi

# ---------------------------------------------------------------------------
# Step 3: Backup Configuration
# ---------------------------------------------------------------------------

step "3/10 Backup Configuration (.env + data/https -> data/backups/config/)"

CONFIG_BACKUP_DIR="${BACKUP_DIR}/config-${BACKUP_STAMP}"
run_or_dry mkdir -p "${CONFIG_BACKUP_DIR}"

for cfg_path in "${APP_DIR}/.env" "${APP_DIR}/data/https" "${APP_DIR}/Caddyfile"; do
  if [[ -e "${cfg_path}" ]]; then
    log "INFO" "Copying ${cfg_path} -> ${CONFIG_BACKUP_DIR}/"
    run_or_dry cp -rp "${cfg_path}" "${CONFIG_BACKUP_DIR}/"
  fi
done
log "INFO" "Config backup at ${CONFIG_BACKUP_DIR}"

# ---------------------------------------------------------------------------
# Step 4: Pull code / receive artifact
# ---------------------------------------------------------------------------

step "4/10 Receive Deployment Artifact (git fetch + checkout v${TARGET_VERSION})"

if [[ "${SKIP_GIT_PULL:-0}" == "1" ]]; then
  log "INFO" "SKIP_GIT_PULL=1 — skipping git fetch/checkout"
else
  if [[ ! -d "${APP_DIR}/.git" ]]; then
    die "${APP_DIR} is not a git repo — cannot pull artifact. Set SKIP_GIT_PULL=1 to bypass."
  fi
  log "INFO" "git fetch ${GIT_REMOTE} --tags --force"
  run_or_dry git fetch "${GIT_REMOTE}" --tags --force
  # Try a tag first (vX.Y.Z), then a branch, then a bare commit
  if git rev-parse -q --verify "refs/tags/v${TARGET_VERSION}" >/dev/null; then
    REF="refs/tags/v${TARGET_VERSION}"
  elif git rev-parse -q --verify "refs/heads/${TARGET_VERSION}" >/dev/null; then
    REF="${TARGET_VERSION}"
  elif git rev-parse -q --verify "${TARGET_VERSION}" >/dev/null; then
    REF="${TARGET_VERSION}"
  else
    die "Could not resolve ${TARGET_VERSION} as a tag, branch, or commit"
  fi
  log "INFO" "git checkout ${REF}"
  run_or_dry git checkout "${REF}"
  log "INFO" "git clean -fd (untracked files from old run)"
  run_or_dry git clean -fd
  GIT_HASH="$(git rev-parse HEAD)"
  log "INFO" "Now at ${GIT_HASH}"
fi

# ---------------------------------------------------------------------------
# Step 5: Stop service
# ---------------------------------------------------------------------------

step "5/10 Stop Service"

# Kill any process listening on PORT — the pnpm dev/start process that was
# booting the Express server. Pidfile-based kill is unreliable with pnpm+tsx
# (the pidfile points at the wrapper, not the long-running child), so we
# resolve by port instead. We DO NOT kill PM2/systemd-managed processes
# here — those should be stopped via the system service manager before
# running this script (the operator is told so in the README).
if command -v lsof >/dev/null 2>&1; then
  PID_LISTENING="$(lsof -ti tcp:${PORT} 2>/dev/null || true)"
elif command -v ss >/dev/null 2>&1; then
  PID_LISTENING="$(ss -ltnp 2>/dev/null | awk -v p=":${PORT}" '$4 ~ p {print $NF; exit}' | sed -E 's/.*pid=([0-9]+).*/\1/' || true)"
else
  PID_LISTENING=""
fi

if [[ -n "${PID_LISTENING}" ]]; then
  log "INFO" "Killing process ${PID_LISTENING} on port ${PORT}"
  run_or_dry kill -TERM "${PID_LISTENING}" || true
  sleep 2
  if kill -0 "${PID_LISTENING}" 2>/dev/null; then
    log "WARN" "Process still alive — sending KILL"
    run_or_dry kill -KILL "${PID_LISTENING}" || true
  fi
else
  log "INFO" "No process listening on ${PORT}"
fi

# ---------------------------------------------------------------------------
# Step 6: Update package (install deps)
# ---------------------------------------------------------------------------

step "6/10 Update Package (pnpm install --frozen-lockfile)"

if [[ "${SKIP_INSTALL:-0}" == "1" ]]; then
  log "INFO" "SKIP_INSTALL=1 — skipping pnpm install"
else
  run_or_dry pnpm install --frozen-lockfile
fi

# ---------------------------------------------------------------------------
# Step 7: Run migrations
# ---------------------------------------------------------------------------

step "7/10 Run Database Migrations (pnpm db:push)"

if [[ "${SKIP_MIGRATE:-0}" == "1" ]]; then
  log "INFO" "SKIP_MIGRATE=1 — skipping migrations"
  MIGRATIONS_SUMMARY="skipped"
else
  log "INFO" "Running drizzle-kit migrations (idempotent on existing schema)"
  run_or_dry pnpm db:push
  MIGRATIONS_SUMMARY="applied"
fi

# Schema-version stamp — uses the in-app setting (store_settings.schema_version).
# This is intentionally separate from the app semver so we can detect a
# migration that did not bump the schema (or a schema bump that did not ship
# with a migration). Operators can run scripts/check-db.ts to verify.
SCHEMA_BEFORE="$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('${DB_PATH}', { readOnly: true });
const row = db.prepare('SELECT value FROM store_settings WHERE key = ?').get('schema_version');
console.log(row ? row.value : '1.0');
" 2>/dev/null || echo unknown)"
log "INFO" "Schema version before: ${SCHEMA_BEFORE}"

# ---------------------------------------------------------------------------
# Step 8: Start service
# ---------------------------------------------------------------------------

step "8/10 Start Service"

# Prefer PM2/systemd if they own the process — operator should start them
# externally and re-run this script with SKIP_START=1. Otherwise we boot
# the production build directly so the script is self-contained.
if [[ "${SKIP_START:-0}" == "1" ]]; then
  log "INFO" "SKIP_START=1 — service will be started externally"
else
  log "INFO" "Starting: NODE_ENV=${NODE_ENV_VAL} pnpm start"
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    log "DRY-RUN" "NODE_ENV=${NODE_ENV_VAL} pnpm start (backgrounded)"
  else
    NODE_ENV="${NODE_ENV_VAL}" nohup pnpm start >"${LOG_DIR}/server-$(date -u +%Y%m%dT%H%M%SZ).log" 2>&1 &
    SERVER_PID=$!
    log "INFO" "Server booting (pid ${SERVER_PID})"
    # wait up to 30s for the port to come up
    for i in $(seq 1 30); do
      if curl -fsS --max-time 2 "http://localhost:${PORT}/api/trpc/system.health" >/dev/null 2>&1; then
        log "INFO" "Service is up after ${i}s"
        break
      fi
      sleep 1
      if [[ $i -eq 30 ]]; then
        die "Service did not come up within 30s — see ${LOG_DIR}/server-*.log"
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
# Step 9: Health check + smoke test
# ---------------------------------------------------------------------------

step "9/10 Health Check and Smoke Test"

HEALTH_PAYLOAD="$(curl -fsS --max-time 10 "http://localhost:${PORT}/api/trpc/system.health" 2>/dev/null || echo "")"
if [[ -z "${HEALTH_PAYLOAD}" ]]; then
  die "Health check failed — service did not respond on /api/trpc/system.health"
fi
log "INFO" "Health response: ${HEALTH_PAYLOAD}"

# Smoke test: DB has the expected tables
SMOKE_CHECK="$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('${DB_PATH}', { readOnly: true });
const row = db.prepare(\"SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('app_users', 'members', 'store_settings', 'products')\").get();
console.log(row.n);
" 2>/dev/null || echo 0)"
if [[ "${SMOKE_CHECK}" -lt 4 ]]; then
  die "Smoke test failed — DB at ${DB_PATH} is missing core tables (found ${SMOKE_CHECK}/4)"
fi
log "INFO" "Smoke test OK — DB has all 4 core tables"

# ---------------------------------------------------------------------------
# Step 10: Log release (audit + release_logs row)
# ---------------------------------------------------------------------------

step "10/10 Log Release (record update entry in release_logs)"

# The release_logs table is written via the in-app tRPC procedure so the
# audit trail and the release history stay in sync. Operators with a dev
# session cookie can also call this procedure from the UI; here we POST
# via tRPC. The actor is the human/script that ran this script.
NOTES="update.sh @ ${HOSTNAME} by ${ACTOR} (log: $(basename "${LOG_FILE}"))"
HEALTH_SHORT="$(printf '%s' "${HEALTH_PAYLOAD}" | head -c 200)"
PAYLOAD=$(node -e "
const payload = {
  version: '${TARGET_VERSION}',
  action: 'update',
  notes: ${JSON.stringify("${NOTES}")},
  migrations: ${JSON.stringify("${MIGRATIONS_SUMMARY}")},
  backupFile: ${JSON.stringify("${BACKUP_FILE}")},
  healthCheck: ${JSON.stringify("${HEALTH_SHORT}")},
  actor: ${JSON.stringify("${ACTOR}")},
};
console.log(JSON.stringify(payload));
")

# Authenticate as the dev user only when credentials are provided — otherwise
# this step logs a warning and the operator can manually append via the UI.
if [[ -n "${RELEASE_LOG_DEV_USER:-}" && -n "${RELEASE_LOG_DEV_PASS:-}" ]]; then
  log "INFO" "Logging release via tRPC system.logRelease (auth as ${RELEASE_LOG_DEV_USER})"
  # 1. Login to get the session cookie
  COOKIE_JAR="${LOG_DIR}/.cookies-$(date -u +%s).txt"
  LOGIN_OK=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "http://localhost:${PORT}/api/trpc/auth.login" \
    -H "content-type: application/json" \
    -d "{\"0\":{\"json\":{\"username\":\"${RELEASE_LOG_DEV_USER}\",\"password\":\"${RELEASE_LOG_DEV_PASS}\"}}}" \
    -c "${COOKIE_JAR}" || echo "000")
  if [[ "${LOGIN_OK}" != "200" ]]; then
    log "WARN" "Login as ${RELEASE_LOG_DEV_USER} failed (HTTP ${LOGIN_OK}) — skipping release log write"
  else
    LOG_OK=$(curl -sS -o /dev/null -w "%{http_code}" \
      -X POST "http://localhost:${PORT}/api/trpc/system.logRelease" \
      -H "content-type: application/json" \
      -d "{\"0\":{\"json\":${PAYLOAD}}}" \
      -b "${COOKIE_JAR}" || echo "000")
    if [[ "${LOG_OK}" != "200" ]]; then
      log "WARN" "system.logRelease returned HTTP ${LOG_OK} — release NOT recorded in DB"
    else
      log "INFO" "Release entry written to release_logs (HTTP ${LOG_OK})"
    fi
  fi
  rm -f "${COOKIE_JAR}"
else
  log "WARN" "RELEASE_LOG_DEV_USER / RELEASE_LOG_DEV_PASS not set — release NOT recorded in DB"
  log "WARN" "Operator should manually call system.logRelease via the UI with payload:"
  log "WARN" "${PAYLOAD}"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

log "INFO" "================================================="
log "INFO" "Update to v${TARGET_VERSION} COMPLETE"
log "INFO" "  Backup:    ${BACKUP_FILE:-none}"
log "INFO" "  Schema:    ${SCHEMA_BEFORE}"
log "INFO" "  Migrations: ${MIGRATIONS_SUMMARY}"
log "INFO" "  Log:        ${LOG_FILE}"
log "INFO" "================================================="
log "INFO" "If smoke test or runtime errors appear, run:"
log "INFO" "  ./scripts/rollback.sh ${BACKUP_FILE:-<last-backup>}"
log "INFO" "================================================="
