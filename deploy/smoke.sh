#!/usr/bin/env bash
# Smoke test: health must be reachable over TLS and report db=true, and — unless
# SMOKE_REQUIRE_MODEL=false — that the *configured model tag* is pulled, not merely that Ollama
# answers.
#
# O-2: the old check accepted `"model":true`, which `/system/health` returned whenever Ollama's
# HTTP port was open. An operator who mistyped MODEL_NAME got `smoke passed` and found out at the
# first suggestion job. Health now also returns
# `modelStatus:{reachable,tagPresent,name}` from `GET {MODEL_URL}/api/tags`, and this script
# insists on `tagPresent` and prints the tag it was looking for when it is missing.
set -euo pipefail
base=${1:-https://localhost}
: "${SMOKE_REQUIRE_MODEL:=true}"

# Reads one scalar out of the health body without needing jq on the host. Each key appears once,
# and the value may itself contain a colon (`qwen2.5:3b-instruct-q4_K_M`), so this stops at the
# next quote, comma or brace rather than splitting on ':'.
field() { printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\).*/\1/p"; }

for i in $(seq 1 60); do
  body=$(curl -ksS "$base/api/v1/system/health" || true)
  if echo "$body" | grep -q '"db":true'; then
    if [ "$SMOKE_REQUIRE_MODEL" = "true" ]; then
      reachable=$(field "$body" reachable)
      tag_present=$(field "$body" tagPresent)
      model_name=$(field "$body" name)
      if [ "$reachable" != "true" ]; then
        echo "waiting for the model service at MODEL_URL ($i): $body"; sleep 5; continue
      fi
      if [ "$tag_present" != "true" ]; then
        echo "waiting for the model tag '${model_name:-?}' to be pulled ($i) — ollama is up but \`ollama list\` does not contain it; check MODEL_NAME in deploy/.env and re-run deploy/ollama-pull.sh"
        sleep 5; continue
      fi
      echo "model ok: '$model_name' is pulled"
    fi
    echo "health ok: $body"
    rid=$(curl -ksSI "$base/api/v1/system/health" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-request-id"{print $2}')
    test -n "$rid" && echo "request id ok: $rid"
    curl -ksS -o /dev/null -w 'spa %{http_code}\n' "$base/" | grep -q 'spa 200'
    # O-1: the headers must be on the document the browser renders, not only on /api/*.
    hdrs=$(curl -ksSI "$base/" | tr -d '\r' | tr 'A-Z' 'a-z')
    for h in content-security-policy strict-transport-security x-content-type-options x-frame-options referrer-policy; do
      echo "$hdrs" | grep -q "^$h:" || { echo "smoke FAILED: GET / is missing the $h header"; exit 1; }
    done
    echo "security headers ok"
    echo "smoke passed"; exit 0
  fi
  echo "waiting for api ($i): $body"; sleep 2
done
echo "smoke FAILED"; exit 1
