#!/usr/bin/env bash
# Builds the backup sidecar image and round-trips a backup/restore against a
# throwaway pgvector/pgvector:pg16 container, plus a retention-pruning check.
set -euo pipefail
cd "$(dirname "$0")/.."

net=kb-backup-check-net
db=kb-backup-check-db
docker rm -f "$db" >/dev/null 2>&1 || true
docker network rm "$net" >/dev/null 2>&1 || true
docker network create "$net" >/dev/null

cleanup() { docker rm -f "$db" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build -f deploy/backup.Dockerfile -t wecom-kb-backup:test .

docker run -d --name "$db" --network "$net" --network-alias db \
  -e POSTGRES_USER=kb -e POSTGRES_PASSWORD=kb -e POSTGRES_DB=kb \
  pgvector/pgvector:pg16 >/dev/null

for i in $(seq 1 30); do docker exec "$db" pg_isready -U kb >/dev/null 2>&1 && break; sleep 1; done

BACKUP_DIR=$(mktemp -d)
export DATABASE_URL=postgres://kb:kb@db:5432/kb
export BACKUP_RETENTION_DAYS=14

docker exec "$db" psql -U kb -d kb -c "create table t(x int); insert into t values (1),(2),(3);" >/dev/null

docker run --rm --network "$net" -e DATABASE_URL -e BACKUP_RETENTION_DAYS \
  -v "$BACKUP_DIR:/backups" wecom-kb-backup:test backup.sh

f=$(ls "$BACKUP_DIR"/kb-*.dump | head -1); test -s "$f"

docker exec "$db" psql -U kb -d kb -c "drop table t;" >/dev/null

docker run --rm --network "$net" -e DATABASE_URL \
  -v "$BACKUP_DIR:/backups" wecom-kb-backup:test restore.sh "/backups/$(basename "$f")" | tee /tmp/restore.out

docker exec "$db" psql -U kb -d kb -tAc "select count(*) from t" | grep -qx 3

# retention: an old file must be pruned
touch -d '20 days ago' "$BACKUP_DIR/kb-20000101-0000.dump" 2>/dev/null || touch -t 200001010000 "$BACKUP_DIR/kb-20000101-0000.dump"
docker run --rm --network "$net" -e DATABASE_URL -e BACKUP_RETENTION_DAYS \
  -v "$BACKUP_DIR:/backups" wecom-kb-backup:test backup.sh
test ! -e "$BACKUP_DIR/kb-20000101-0000.dump"

echo "backup/restore ok"
