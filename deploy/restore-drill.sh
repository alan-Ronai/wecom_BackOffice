#!/usr/bin/env bash
# Restore drill: proves a real backup is actually restorable, not just present.
#
# Restores the newest (or an explicitly given) kb-*.dump into a throwaway
# "scratch" database on the *same* Postgres server named in DATABASE_URL,
# counts apps/api's `documents` table in it, then drops the scratch database.
# Never touches the real database DATABASE_URL points at.
#
# Usage, inside the `backup` container (which compose already gives a correct DATABASE_URL —
# do not pass one, see below):
#   docker compose -f deploy/docker-compose.yml exec backup restore-drill.sh [dump-file]
#
# Exit code is non-zero on any failure (missing dump, restore error, or a
# document count of zero when the source clearly should have documents).
set -euo pipefail
: "${BACKUP_DIR:=/backups}"
: "${DATABASE_URL:?DATABASE_URL is required (same server the real kb database lives on)}"

# O-3: the documented command used to pass `-e DATABASE_URL=postgres://kb:$POSTGRES_PASSWORD@…`,
# which the *host* shell expands — and `POSTGRES_PASSWORD` is not set there unless the operator
# happened to source deploy/.env. Run literally it became `postgres://kb:@db:5432/kb` and failed
# at authentication with a message that says nothing about the real cause. The documents no
# longer pass a URL at all; this refuses the empty-password shape outright so the old,
# copy-pasted spelling fails with the actual explanation.
case "$DATABASE_URL" in
  *://*:@*)
    echo "restore-drill FAILED: DATABASE_URL has an empty password — \$POSTGRES_PASSWORD was not
set in the shell that expanded it. The backup container already has a correct DATABASE_URL, so
run this without any -e override:
  docker compose -f deploy/docker-compose.yml exec backup restore-drill.sh
or, if you really need to pass one, export it first: set -a; . deploy/.env; set +a" >&2
    exit 1
    ;;
esac

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
# `--exit-on-error` (-e), not the default. Without it pg_restore reports every failed command and
# then **exits 0**: a dump truncated by a full disk restored "successfully" into an empty database,
# and this drill — the one check that is supposed to prove a backup is restorable — was green.
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$scratch_url" "$dump"

count=$(psql "$scratch_url" -tAc "select count(*) from documents" 2>/dev/null || echo "ERROR")
if [ "$count" = "ERROR" ]; then
  echo "restore-drill FAILED: restored database has no readable 'documents' table" >&2
  exit 1
fi
# The zero-document failure this script's own header, deploy/INSTALL.md and docs/operations.md all
# promise, and which was never actually coded. A pilot library is never empty, so a restored
# `documents` table that is means the dump carried a schema and no data — which `pg_restore` alone
# will not tell you, and which is exactly the backup you do not want to discover on the day.
case "$count" in
  ''|*[!0-9]*)
    echo "restore-drill FAILED: could not read a document count out of the restored database (got '$count')" >&2
    exit 1
    ;;
esac
if [ "$count" -eq 0 ]; then
  echo "restore-drill FAILED: $dump restored, but the 'documents' table is empty. A backup of a
non-empty library that restores to zero documents is not a usable backup — check that pg_dump ran
against the real database (DATABASE_URL), that the dump is not truncated (\`ls -l $dump\`), and the
backup container's logs for the night it was written." >&2
  exit 1
fi
tables=$(psql "$scratch_url" -tAc "select count(*) from information_schema.tables where table_schema='public'")

echo "restore drill OK: $dump restored, $tables tables, $count documents"
