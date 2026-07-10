#!/usr/bin/env bash
# PostgreSQL restore drill (Milestone 18, ADR-0027).
#
# Restores the most recent dump into a scratch database, verifies its
# checksum and that schema/data came back, then drops the scratch database.
# This is the "tested restore" the SOPS §19 checklist requires — a backup you
# have never restored is not a backup.
#
#   docker compose -f infra/production/docker-compose.yml run --rm \
#     --entrypoint /usr/local/bin/pg-restore-drill.sh pg-backup
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DRILL_DB="${DRILL_DB:-support_restore_drill}"

latest="$(ls -1t "${BACKUP_DIR}"/support-*.dump 2>/dev/null | head -1 || true)"
if [[ -z "$latest" ]]; then
  echo "[restore-drill] no dump found in ${BACKUP_DIR}; take a backup first (RUN_ONCE=true)"
  exit 1
fi
echo "[restore-drill] latest dump: ${latest}"

if [[ -f "${latest}.sha256" ]]; then
  (cd "$(dirname "$latest")" && sha256sum -c "$(basename "$latest").sha256") \
    || { echo "[restore-drill] checksum FAILED"; exit 1; }
fi

cleanup() {
  psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[restore-drill] (re)creating scratch db ${DRILL_DB}"
psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB};"
psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE ${DRILL_DB};"

echo "[restore-drill] restoring…"
pg_restore --no-owner --no-privileges --dbname="${DRILL_DB}" "$latest"

migrations="$(psql -tA -d "${DRILL_DB}" -c "select count(*) from schema_migrations;")"
tenants="$(psql -tA -d "${DRILL_DB}" -c "select count(*) from tenants;")"
echo "[restore-drill] restored schema_migrations=${migrations} tenants=${tenants}"

if [[ "${migrations}" -lt 1 ]]; then
  echo "[restore-drill] FAILED — restored database has no applied migrations"
  exit 1
fi

echo "[restore-drill] PASS — dump is restorable (${migrations} migrations verified)"
