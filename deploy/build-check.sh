#!/usr/bin/env bash
# Builds the api and web images and sanity-checks their contents.
# Requires apps/api and apps/web to exist (wave 2 of this lane's work) —
# until then this fails at the `COPY apps/api/package.json` step, which is
# expected and documented in the L1 report.
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f deploy/Dockerfile.api -t wecom-kb-api:test .
docker build -f deploy/Dockerfile.web -t wecom-kb-web:test .
docker run --rm wecom-kb-api:test node -e "import('/app/apps/api/dist/app.js').then(()=>console.log('api image ok'))"
docker run --rm wecom-kb-web:test sh -c "test -f /usr/share/nginx/html/index.html && nginx -t && echo web image ok"
