#!/usr/bin/env bash
# Smoke test: health must be reachable over TLS and report db=true (and
# model=true unless SMOKE_REQUIRE_MODEL=false).
set -euo pipefail
base=${1:-https://localhost}
: "${SMOKE_REQUIRE_MODEL:=true}"
for i in $(seq 1 60); do
  body=$(curl -ksS "$base/api/v1/system/health" || true)
  if echo "$body" | grep -q '"db":true'; then
    if [ "$SMOKE_REQUIRE_MODEL" = "true" ] && ! echo "$body" | grep -q '"model":true'; then echo "waiting for model ($i): $body"; sleep 5; continue; fi
    echo "health ok: $body"
    rid=$(curl -ksSI "$base/api/v1/system/health" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-request-id"{print $2}')
    test -n "$rid" && echo "request id ok: $rid"
    curl -ksS -o /dev/null -w 'spa %{http_code}\n' "$base/" | grep -q 'spa 200'
    echo "smoke passed"; exit 0
  fi
  echo "waiting for api ($i): $body"; sleep 2
done
echo "smoke FAILED"; exit 1
