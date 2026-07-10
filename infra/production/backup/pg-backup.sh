#!/usr/bin/env bash
# Nightly PostgreSQL backup loop (Milestone 18, ADR-0027).
#
# Runs `pg_dump` in custom format to $BACKUP_DIR, records a checksum, prunes
# dumps older than the retention window, and optionally ships each dump
# offsite via BACKUP_UPLOAD_CMD. Runs as the pg-backup service (has the PG
# client + PG* credentials). Set RUN_ONCE=true to take a single backup and
# exit — used by CI and the restore drill.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
SCHEDULE_UTC="${BACKUP_SCHEDULE_UTC:-01:30}"
PGDATABASE="${PGDATABASE:-support}"

mkdir -p "$BACKUP_DIR"

take_backup() {
  local ts file
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  file="${BACKUP_DIR}/support-${ts}.dump"
  echo "[pg-backup] dumping ${PGDATABASE} -> ${file}"
  pg_dump --format=custom --no-owner --no-privileges --file="${file}.tmp" "$PGDATABASE"
  mv "${file}.tmp" "$file"
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
  echo "[pg-backup] wrote $(du -h "$file" | cut -f1) ${file}"

  if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
    echo "[pg-backup] shipping offsite"
    if bash -c "$BACKUP_UPLOAD_CMD" _ "$file" && bash -c "$BACKUP_UPLOAD_CMD" _ "${file}.sha256"; then
      echo "[pg-backup] offsite upload ok"
    else
      echo "[pg-backup] WARNING offsite upload failed for ${file}"
    fi
  else
    echo "[pg-backup] BACKUP_UPLOAD_CMD unset — local dump only (configure offsite for production)"
  fi

  find "$BACKUP_DIR" -name 'support-*.dump*' -mtime "+${RETENTION_DAYS}" -print -delete || true
}

seconds_until() {
  local target now diff
  target="$(date -u -d "today ${SCHEDULE_UTC}" +%s)"
  now="$(date -u +%s)"
  diff=$(( target - now ))
  if (( diff <= 0 )); then diff=$(( diff + 86400 )); fi
  echo "$diff"
}

if [[ "${RUN_ONCE:-false}" == "true" ]]; then
  take_backup
  exit 0
fi

echo "[pg-backup] scheduler started; nightly at ${SCHEDULE_UTC} UTC, retention ${RETENTION_DAYS}d"
while true; do
  sleep_for="$(seconds_until)"
  echo "[pg-backup] next backup in ${sleep_for}s"
  sleep "$sleep_for"
  take_backup || echo "[pg-backup] ERROR backup failed; will retry next cycle"
done
