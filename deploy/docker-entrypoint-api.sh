#!/bin/sh
# Entrypoint for the api image: run pending migrations, then start the server.
# Set MIGRATE_ON_START=false to skip (e.g. for a read-only replica or a
# manual-migration rollout).
set -eu

if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  echo "docker-entrypoint-api: running migrations"
  pnpm --filter @wecom/api migrate
  # Tells server.js they are already done, so they do not run a second time.
  export MIGRATIONS_APPLIED=1
else
  echo "docker-entrypoint-api: MIGRATE_ON_START=false, skipping migrations"
fi

echo "docker-entrypoint-api: starting server"
exec node apps/api/dist/server.js
