#!/usr/bin/env bash
# Builds the backup sidecar image and round-trips a backup/restore against a
# throwaway pgvector/pgvector:pg16 container, plus a retention-pruning check.
set -euo pipefail
cd "$(dirname "$0")/.."

# ── every name this run owns carries its pid ──────────────────────────────────────────────────
# These were fixed strings — `kb-backup-check-db`, `kb-backup-check-net`, `wecom-kb-backup:test`,
# `/tmp/restore.out`. The `docker rm -f` below is unconditional, so two runs on one machine
# (harmless in CI, ordinary on a developer's laptop: this script next to a `pnpm e2e:compose`, or
# two branches) deleted each other's database container and raced on the same image tag —
# producing a failure that reads as a broken backup rather than as two runs colliding.
#
# `$$` rather than `mktemp -u`: it is stable for the length of the run, needs no coordination, and
# says in the name which process owns the container when one is left behind by a hard kill.
run=$$
net=kb-backup-check-net-$run
db=kb-backup-check-db-$run
img=wecom-kb-backup:check-$run
docker rm -f "$db" >/dev/null 2>&1 || true
docker network rm "$net" >/dev/null 2>&1 || true
docker network create "$net" >/dev/null

BACKUP_DIR=$(mktemp -d)
# The image too: a concurrent run must not be left holding a tag this one is about to rebuild or
# remove. `rmi` is best-effort — a still-running container of another run's would keep it.
cleanup() {
  local status=$?
  docker rm -f "$db" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker rmi -f "$img" >/dev/null 2>&1 || true
  # The dumps and the restore transcript are what a failure has to be read from, so they survive
  # one — and only one, otherwise every green run leaves a directory of database dumps in /tmp.
  if [ "$status" = 0 ]; then rm -rf "$BACKUP_DIR"; else echo "backup-check: left $BACKUP_DIR for inspection" >&2; fi
}
trap cleanup EXIT

docker build -f deploy/backup.Dockerfile -t "$img" .

docker run -d --name "$db" --network "$net" --network-alias db \
  -e POSTGRES_USER=kb -e POSTGRES_PASSWORD=kb -e POSTGRES_DB=kb \
  pgvector/pgvector:pg16 >/dev/null

for i in $(seq 1 30); do docker exec "$db" pg_isready -U kb >/dev/null 2>&1 && break; sleep 1; done

export DATABASE_URL=postgres://kb:kb@db:5432/kb
export BACKUP_RETENTION_DAYS=14

docker exec "$db" psql -U kb -d kb -c "create table t(x int); insert into t values (1),(2),(3);" >/dev/null

docker run --rm --network "$net" -e DATABASE_URL -e BACKUP_RETENTION_DAYS \
  -v "$BACKUP_DIR:/backups" "$img" backup.sh

f=$(ls "$BACKUP_DIR"/kb-*.dump | head -1); test -s "$f"

docker exec "$db" psql -U kb -d kb -c "drop table t;" >/dev/null

# …into this run's own directory, not the shared /tmp/restore.out two runs used to overwrite for
# each other. The transcript survives a failure (see cleanup) and is deleted with everything else
# on a pass.
docker run --rm --network "$net" -e DATABASE_URL \
  -v "$BACKUP_DIR:/backups" "$img" restore.sh "/backups/$(basename "$f")" | tee "$BACKUP_DIR/restore.out"

docker exec "$db" psql -U kb -d kb -tAc "select count(*) from t" | grep -qx 3

# retention: an old file must be pruned
touch -d '20 days ago' "$BACKUP_DIR/kb-20000101-0000.dump" 2>/dev/null || touch -t 200001010000 "$BACKUP_DIR/kb-20000101-0000.dump"
docker run --rm --network "$net" -e DATABASE_URL -e BACKUP_RETENTION_DAYS \
  -v "$BACKUP_DIR:/backups" "$img" backup.sh
test ! -e "$BACKUP_DIR/kb-20000101-0000.dump"

echo "backup/restore ok"
