#!/usr/bin/env bash
# Nightly logical backup. Requires DATABASE_URL, BACKUP_DIR; optional BACKUP_RETENTION_DAYS (default 14).
set -euo pipefail
: "${BACKUP_DIR:=/backups}"; : "${BACKUP_RETENTION_DAYS:=14}"
mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y%m%d-%H%M)
out="$BACKUP_DIR/kb-$stamp.dump"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$out.tmp"
mv "$out.tmp" "$out"
echo "backup written: $out ($(du -h "$out" | cut -f1))"
find "$BACKUP_DIR" -name 'kb-*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -print -delete | sed 's/^/pruned: /'
