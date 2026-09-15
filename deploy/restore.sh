#!/usr/bin/env bash
# Usage: restore.sh <dump.dump>  — restores a pg_dump custom-format dump into
# DATABASE_URL after recreating the public and pgboss schemas.
set -euo pipefail
file=${1:?dump file required}
test -s "$file"
# Host and database only — never the whole URL. `$DATABASE_URL` carries the Postgres password, and
# this line goes to stdout, which is the container log (`docker compose logs backup`), a CI
# transcript (deploy/backup-check.sh tees it) and whatever the operator's shell is recording.
# Everything up to and including the last `@` is the credential part; what remains is
# host:port/database, which is the only part worth seeing.
target=${DATABASE_URL##*@}
echo "restoring $file into $target"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;"
pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" "$file"
n=$(psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")
echo "restore complete: $n tables in $target"
