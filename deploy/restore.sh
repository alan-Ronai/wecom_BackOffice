#!/usr/bin/env bash
# Usage: restore.sh <dump.dump>  — restores a pg_dump custom-format dump into
# DATABASE_URL after recreating the public and pgboss schemas.
set -euo pipefail
file=${1:?dump file required}
test -s "$file"
echo "restoring $file into $DATABASE_URL"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;"
pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" "$file"
n=$(psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")
echo "restore complete: $n tables"
