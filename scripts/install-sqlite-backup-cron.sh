#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-$(pwd)}"
SCHEDULE="${SQLITE_BACKUP_CRON:-0 2 * * *}"
MARKER="# PNG-SHOP-SQLITE-BACKUP"
COMMAND="cd ${APP_DIR} && pnpm backup:sqlite >> ${APP_DIR}/data/sqlite-backup.log 2>&1 ${MARKER}"

mkdir -p "${APP_DIR}/data"
(crontab -l 2>/dev/null | grep -v "${MARKER}" || true; printf '%s %s\n' "${SCHEDULE}" "${COMMAND}") | crontab -
printf 'Installed SQLite backup cron: %s\n' "${SCHEDULE}"
printf 'Backup directory: %s/data/backups\n' "${APP_DIR}"
