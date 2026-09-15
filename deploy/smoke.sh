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

# ── the API must not believe a client's own X-Forwarded-For ───────────────────────────────────
# nginx sets `X-Forwarded-For $remote_addr` (it replaces, rather than appending to, whatever the
# client sent) and the API is told how far to unwind it (TRUST_PROXY / TRUST_PROXY_HOPS). Get
# either wrong and `req.ip` becomes an address the caller chose — which is what the Palo Alto
# User-ID allowlist is checked against, so a client on the LAN could be signed in as whoever the
# firewall maps, and the audit trail would record the address they typed.
#
# Proving it from outside needs no credentials and no debug route. `POST /auth/local` is public
# and rate-limited to 5 attempts a minute *per req.ip*. Send more than that with a different
# forged X-Forwarded-For on each: if the API believed the header, every attempt would land in its
# own bucket and all of them would come back 401. A 429 means all of them shared one bucket —
# i.e. req.ip was this host, whatever the header said.
#
# The credentials are deliberately invalid, so nothing can be signed in to; the cost is that this
# host cannot attempt a local login for the next minute. SMOKE_CHECK_XFF=false skips it.
: "${SMOKE_CHECK_XFF:=true}"
xff_check() {
  [ "$SMOKE_CHECK_XFF" = "true" ] || { echo "x-forwarded-for check skipped (SMOKE_CHECK_XFF=false)"; return 0; }
  local base=$1 code n
  for n in 1 2 3 4 5 6 7; do
    code=$(curl -ksS -o /dev/null -w '%{http_code}' \
      -X POST "$base/api/v1/auth/local" \
      -H 'content-type: application/json' \
      -H "X-Forwarded-For: 203.0.113.$n" \
      -H "X-Real-IP: 203.0.113.$n" \
      --data '{"email":"smoke-probe@invalid.local","password":"not-a-password"}' || true)
    case "$code" in
      429)
        echo "x-forwarded-for ok: the API rate-limited by this host's real address, not the forged one (attempt $n)"
        return 0
        ;;
      401|400) ;;                                  # expected: bad credentials
      *) echo "smoke FAILED: POST /auth/local answered $code, expected 401 or 429"; exit 1 ;;
    esac
  done
  echo "smoke FAILED: 7 login attempts, each with a different forged X-Forwarded-For, were never"
  echo "  rate-limited — the API is deriving req.ip from the client's header. Check that"
  echo "  deploy/nginx.conf sets 'X-Forwarded-For \$remote_addr' (deploy/nginx-check.sh), and that"
  echo "  TRUST_PROXY names only the proxy hop (never 'true') with TRUST_PROXY_HOPS=1 in deploy/.env."
  exit 1
}

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
    xff_check "$base"
    echo "smoke passed"; exit 0
  fi
  echo "waiting for api ($i): $body"; sleep 2
done
echo "smoke FAILED"; exit 1
