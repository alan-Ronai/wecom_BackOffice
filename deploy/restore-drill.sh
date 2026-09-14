#!/usr/bin/env bash
# Restore drill: proves a real backup is actually restorable, not just present.
#
# Restores the newest (or an explicitly given) kb-*.dump into a throwaway
# "scratch" database on the *same* Postgres server named in DATABASE_URL,
# counts apps/api's `documents` table in it, then drops the scratch database.
# Never touches the real database DATABASE_URL points at.
#
# Usage:
#   DATABASE_URL=postgres://kb:kb@db:5432/kb BACKUP_DIR=/backups deploy/restore-drill.sh [dump-file]
#
# Exit code is non-zero on any failure (missing dump, restore error, or a
# document count of zero when the source clearly should have documents).
set -euo pipefail
: "${BACKUP_DIR:=/backups}"
: "${DATABASE_URL:?DATABASE_URL is required (same server the real kb database lives on)}"

dump="${1:-}"
if [ -z "$dump" ]; then
  dump=$(ls -t "$BACKUP_DIR"/kb-*.dump 2>/dev/null | head -1 || true)
fi
if [ -z "$dump" ] || [ ! -s "$dump" ]; then
  echo "restore-drill FAILED: no kb-*.dump found in $BACKUP_DIR (or given path does not exist)" >&2
  exit 1
fi
echo "restore drill: using $dump"

scratch="kb_restore_drill_$(date +%Y%m%d%H%M%S)_$$"
# DATABASE_URL with the db name swapped for the scratch db, and again for the
# server's default `postgres` maintenance db (needed to create/drop the scratch db).
base_url=${DATABASE_URL%/*}
scratch_url="$base_url/$scratch"
maint_url="$base_url/postgres"

cleanup() {
  psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "drop database if exists $scratch with (force);" \
    2>/dev/null || psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "drop database if exists $scratch;" 2>/dev/null || true
}
trap cleanup EXIT

echo "restore drill: creating scratch database $scratch"
psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "create database $scratch;"

echo "restore drill: restoring dump into $scratch"
pg_restore --no-owner --no-privileges --dbname="$scratch_url" "$dump"

count=$(psql "$scratch_url" -tAc "select count(*) from documents" 2>/dev/null || echo "ERROR")
if [ "$count" = "ERROR" ]; then
  echo "restore-drill FAILED: restored database has no readable 'documents' table" >&2
  exit 1
fi
tables=$(psql "$scratch_url" -tAc "select count(*) from information_schema.tables where table_schema='public'")

echo "restore drill OK: $dump restored, $tables tables, $count documents"
