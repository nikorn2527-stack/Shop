#!/usr/bin/env bash
#
# PNG Shop — Rollback Script
#
# Usage:
#   ./scripts/rollback.sh [backup-file]
#
# Description:
#   Reverts the welfare store to a previously-known-good state after a
#   failed update or hotfix. Restores the SQLite DB from a backup file
#   in data/backups/, checks out the previous git revision, and re-boots
#   the service. Like update.sh, this script is `set -euo pipefail` and
#   logs every step to data/logs/rollback-<timestamp>.log so the rollback
#   is fully auditable.
#
# Steps:
#   1. Stop service                  (free the DB file handle + port)
#   2. Backup current DB (safety)    (so the broken state is recoverable)
#   3. Restore DB from backup        (verify integrity -> overwrite)
#   4. Git checkout previous version (revert code to last-known-good)
#   5. Start service                 (pnpm install --frozen-lockfile; pnpm start)
#   6. Health check                  (curl /api/trpc/system.health)
#   7. Log rollback                  (record a 'rollback' entry in release_logs)
#
# Environment variables:
#   SQLITE_DB_PATH     DB file path (default: data/welfare-store.sqlite)
#   SQLITE_BACKUP_DIR backup directory (default: data/backups)
#   PORT               server port (default: 3000)
#   NODE_ENV           production | development (default: production)
#   GIT_PREV_REF       explicit git ref to revert to (default: HEAD@{1})
#   SKIP_GIT_CHECKOUT=1 skip the git revert step (DB-only rollback)
#   SKIP_INSTALL=1     skip pnpm install (lockfile unchanged)
#   SKIP_START=1       do not start the service (operator starts it externally)
#   DRY_RUN=1          log every step without doing anything

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${APP_DIR}"

LOG_DIR="${APP_DIR}/data/logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/rollback-$(date -u +%Y%m%dT%H%M%SZ).log"

exec > >(tee -a "${LOG_FILE}") 2>&1

DB_PATH="${SQLITE_DB_PATH:-${APP_DIR}/data/welfare-store.sqlite}"
BACKUP_DIR="${SQLITE_BACKUP_DIR:-${APP_DIR}/data/backups}"
PORT="${PORT:-3000}"
NODE_ENV_VAL="${NODE_ENV:-production}"
HOSTNAME="$(hostname 2>/dev/null || echo unknown)"
ACTOR="${USER:-unknown}@${HOSTNAME}"

# Resolve target backup file: explicit arg > most-recent .sqlite in BACKUP_DIR
if [[ $# -ge 1 ]]; then
  BACKUP_FILE="$1"
elif [[ -d "${BACKUP_DIR}" ]]; then
  BACKUP_FILE="$(ls -1t "${BACKUP_DIR}"/welfare-store-*.sqlite* 2>/dev/null | head -n1 || true)"
  if [[ -z "${BACKUP_FILE}" ]]; then
    echo "[ERROR] No backup file specified and no welfare-store-*.sqlite* found in ${BACKUP_DIR}" >&2
    exit 2
  fi
else
  echo "[ERROR] Backup directory ${BACKUP_DIR} does not exist" >&2
  exit 2
fi

# Normalize the path (allow the operator to pass just the filename)
if [[ ! -f "${BACKUP_FILE}" ]]; then
  BACKUP_FILE="${BACKUP_DIR}/$(basename "${BACKUP_FILE}")"
fi
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[ERROR] Backup file not found: ${BACKUP_FILE}" >&2
  exit 2
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
  log "ERROR" "Rollback aborted. See ${LOG_FILE} for full output."
  log "ERROR" "The DB may be in an inconsistent state — verify with scripts/check-db.ts"
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
# Pre-flight
# ---------------------------------------------------------------------------

log "INFO" "Rollback target: ${BACKUP_FILE}"
log "INFO" "DB path: ${DB_PATH}"
log "INFO" "App dir: ${APP_DIR}"
log "INFO" "Node env: ${NODE_ENV_VAL}"
log "INFO" "Actor: ${ACTOR}"

command -v node >/dev/null 2>&1 || die "node is not on PATH"
command -v pnpm >/dev/null 2>&1 || die "pnpm is not on PATH"
command -v git  >/dev/null 2>&1 || die "git is not on PATH"

# Verify the backup is a real SQLite file before we touch the live DB.
# (The 16-byte header "SQLite format 3\0" is the canonical magic.)
BACKUP_MAGIC="$(head -c 16 "${BACKUP_FILE}" 2>/dev/null | xxd -p 2>/dev/null | head -c32 || true)"
EXPECTED_MAGIC="53514c69746520666f726d6174203300"
if [[ "${BACKUP_MAGIC}" != "${EXPECTED_MAGIC}" ]]; then
  die "Backup file is not a SQLite database (magic: ${BACKUP_MAGIC:-empty}). Expected ${EXPECTED_MAGIC}"
fi
BACKUP_SIZE="$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo 0)"
BACKUP_SHA="$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')"
log "INFO" "Backup verified: ${BACKUP_FILE} (${BACKUP_SIZE} bytes, sha256=${BACKUP_SHA:0:16}…)"

# ---------------------------------------------------------------------------
# Step 1: Stop service
# ---------------------------------------------------------------------------

step "1/7 Stop Service"

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
  log "INFO" "No process listening on ${PORT} (service already down)"
fi

# ---------------------------------------------------------------------------
# Step 2: Backup current DB (safety)
# ---------------------------------------------------------------------------

step "2/7 Backup Current DB (safety net — capture the broken state)"

SAFETY_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SAFETY_FILE="welfare-store-rollback-source-${SAFETY_STAMP}.sqlite"
SAFETY_PATH="${BACKUP_DIR}/${SAFETY_FILE}"

if [[ -f "${DB_PATH}" ]]; then
  log "INFO" "Copying current ${DB_PATH} -> ${SAFETY_PATH}"
  run_or_dry mkdir -p "${BACKUP_DIR}"
  run_or_dry cp -p "${DB_PATH}" "${SAFETY_PATH}"
  log "INFO" "Safety backup: ${SAFETY_FILE}"
else
  log "WARN" "Current DB file ${DB_PATH} does not exist — nothing to safety-backup"
  SAFETY_FILE=""
fi

# ---------------------------------------------------------------------------
# Step 3: Restore DB from backup
# ---------------------------------------------------------------------------

step "3/7 Restore DB from backup"

# Close WAL/SHM sidecars so the restore is a clean copy
for suffix in "" "-wal" "-shm"; do
  if [[ -e "${DB_PATH}${suffix}" ]]; then
    log "INFO" "Removing existing ${DB_PATH}${suffix}"
    run_or_dry rm -f "${DB_PATH}${suffix}"
  fi
done

log "INFO" "Restoring ${BACKUP_FILE} -> ${DB_PATH}"
run_or_dry cp -p "${BACKUP_FILE}" "${DB_PATH}"

# Verify the restored file passes PRAGMA integrity_check
INTEGRITY_OK="$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('${DB_PATH}', { readOnly: true });
const row = db.prepare('PRAGMA integrity_check').get();
console.log(row && row.integrity_check === 'ok' ? 'OK' : 'FAIL');
" 2>/dev/null || echo FAIL)"

if [[ "${INTEGRITY_OK}" != "OK" ]]; then
  die "Restored DB failed PRAGMA integrity_check — DO NOT start the service. Manually inspect ${DB_PATH} and consider restoring ${SAFETY_FILE} (the broken-state backup) for forensic analysis."
fi
log "INFO" "Restored DB integrity check: OK"

# ---------------------------------------------------------------------------
# Step 4: Git checkout previous version
# ---------------------------------------------------------------------------

step "4/7 Git Checkout Previous Version"

if [[ "${SKIP_GIT_CHECKOUT:-0}" == "1" ]]; then
  log "INFO" "SKIP_GIT_CHECKOUT=1 — skipping git revert"
  GIT_REF="<unchanged>"
else
  if [[ ! -d "${APP_DIR}/.git" ]]; then
    die "${APP_DIR} is not a git repo — cannot revert code. Set SKIP_GIT_CHECKOUT=1 to bypass."
  fi
  if [[ -n "${GIT_PREV_REF:-}" ]]; then
    GIT_REF="${GIT_PREV_REF}"
  else
    # HEAD@{1} is the prior position of HEAD (before the most recent checkout
    # / reset / commit). If that reflog entry is missing we fall back to the
    # commit before HEAD on the current branch.
    GIT_REF="$(git rev-parse -q --verify "HEAD@{1}" 2>/dev/null || git rev-parse -q --verify "HEAD^" 2>/dev/null || echo "")"
    if [[ -z "${GIT_REF}" ]]; then
      die "Could not resolve a previous git ref (HEAD@{1} and HEAD^ both missing). Set GIT_PREV_REF explicitly."
    fi
  fi
  log "INFO" "git checkout ${GIT_REF}"
  run_or_dry git checkout "${GIT_REF}"
  GIT_HASH="$(git rev-parse HEAD)"
  log "INFO" "Now at ${GIT_HASH}"
fi

# ---------------------------------------------------------------------------
# Step 5: Start service (re-install deps if lockfile changed, then boot)
# ---------------------------------------------------------------------------

step "5/7 Start Service"

if [[ "${SKIP_START:-0}" == "1" ]]; then
  log "INFO" "SKIP_START=1 — service will be started externally"
else
  if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
    log "INFO" "pnpm install --frozen-lockfile (in case lockfile changed)"
    run_or_dry pnpm install --frozen-lockfile
  fi
  log "INFO" "Starting: NODE_ENV=${NODE_ENV_VAL} pnpm start"
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    log "DRY-RUN" "NODE_ENV=${NODE_ENV_VAL} pnpm start (backgrounded)"
  else
    NODE_ENV="${NODE_ENV_VAL}" nohup pnpm start >"${LOG_DIR}/server-rollback-$(date -u +%Y%m%dT%H%M%SZ).log" 2>&1 &
    SERVER_PID=$!
    log "INFO" "Server booting (pid ${SERVER_PID})"
    for i in $(seq 1 30); do
      if curl -fsS --max-time 2 "http://localhost:${PORT}/api/trpc/system.health" >/dev/null 2>&1; then
        log "INFO" "Service is up after ${i}s"
        break
      fi
      sleep 1
      if [[ $i -eq 30 ]]; then
        die "Service did not come up within 30s — see ${LOG_DIR}/server-rollback-*.log"
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
# Step 6: Health check
# ---------------------------------------------------------------------------

step "6/7 Health Check"

HEALTH_PAYLOAD="$(curl -fsS --max-time 10 "http://localhost:${PORT}/api/trpc/system.health" 2>/dev/null || echo "")"
if [[ -z "${HEALTH_PAYLOAD}" ]]; then
  die "Health check failed — service did not respond on /api/trpc/system.health"
fi
log "INFO" "Health response: ${HEALTH_PAYLOAD}"

# Smoke test the restored DB: confirm 4 core tables are intact
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
# Step 7: Log rollback
# ---------------------------------------------------------------------------

step "7/7 Log Rollback (record rollback entry in release_logs)"

NOTES="rollback.sh @ ${HOSTNAME} by ${ACTOR}; restored from $(basename "${BACKUP_FILE}"); safety backup=${SAFETY_FILE:-none}; git=${GIT_REF:-n/a}; log=$(basename "${LOG_FILE}")"
HEALTH_SHORT="$(printf '%s' "${HEALTH_PAYLOAD}" | head -c 200)"
PAYLOAD=$(node -e "
const payload = {
  version: 'rollback-$(date -u +%Y%m%dT%H%M%SZ)',
  action: 'rollback',
  notes: ${JSON.stringify("${NOTES}")},
  migrations: 'rollback',
  backupFile: ${JSON.stringify("$(basename "${BACKUP_FILE}")")},
  healthCheck: ${JSON.stringify("${HEALTH_SHORT}")},
  actor: ${JSON.stringify("${ACTOR}")},
};
console.log(JSON.stringify(payload));
")

if [[ -n "${RELEASE_LOG_DEV_USER:-}" && -n "${RELEASE_LOG_DEV_PASS:-}" ]]; then
  log "INFO" "Logging rollback via tRPC system.logRelease (auth as ${RELEASE_LOG_DEV_USER})"
  COOKIE_JAR="${LOG_DIR}/.cookies-rollback-$(date -u +%s).txt"
  LOGIN_OK=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "http://localhost:${PORT}/api/trpc/auth.login" \
    -H "content-type: application/json" \
    -d "{\"0\":{\"json\":{\"username\":\"${RELEASE_LOG_DEV_USER}\",\"password\":\"${RELEASE_LOG_DEV_PASS}\"}}}" \
    -c "${COOKIE_JAR}" || echo "000")
  if [[ "${LOGIN_OK}" != "200" ]]; then
    log "WARN" "Login as ${RELEASE_LOG_DEV_USER} failed (HTTP ${LOGIN_OK}) — rollback NOT recorded in DB"
  else
    LOG_OK=$(curl -sS -o /dev/null -w "%{http_code}" \
      -X POST "http://localhost:${PORT}/api/trpc/system.logRelease" \
      -H "content-type: application/json" \
      -d "{\"0\":{\"json\":${PAYLOAD}}}" \
      -b "${COOKIE_JAR}" || echo "000")
    if [[ "${LOG_OK}" != "200" ]]; then
      log "WARN" "system.logRelease returned HTTP ${LOG_OK} — rollback NOT recorded in DB"
    else
      log "INFO" "Rollback entry written to release_logs (HTTP ${LOG_OK})"
    fi
  fi
  rm -f "${COOKIE_JAR}"
else
  log "WARN" "RELEASE_LOG_DEV_USER / RELEASE_LOG_DEV_PASS not set — rollback NOT recorded in DB"
  log "WARN" "Operator should manually call system.logRelease via the UI with payload:"
  log "WARN" "${PAYLOAD}"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

log "INFO" "================================================="
log "INFO" "Rollback COMPLETE"
log "INFO" "  Restored from: $(basename "${BACKUP_FILE}")"
log "INFO" "  Safety backup:  ${SAFETY_FILE:-none}"
log "INFO" "  Git ref:        ${GIT_REF:-unchanged}"
log "INFO" "  Log:            ${LOG_FILE}"
log "INFO" "================================================="
log "INFO" "Verify business operations before deleting the safety backup:"
log "INFO" "  ls -la ${BACKUP_DIR}/${SAFETY_FILE:-<safety-backup>}"
log "INFO" "================================================="
