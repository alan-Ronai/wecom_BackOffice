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
#
# W-3: and — unless SMOKE_REQUIRE_EMBED=false — that `EMBED_MODEL` is pulled too. A clean install
# used to end with the embedding model missing, `model:true` in health, nothing in any log, and
# search permanently demoted to lexical ranking. `/system/health` reports on the *generation*
# model, so this one is asked of Ollama itself; see embed_check.
set -euo pipefail
base=${1:-https://localhost}
: "${SMOKE_REQUIRE_MODEL:=true}"
: "${SMOKE_REQUIRE_EMBED:=true}"

# ── never certify the end-to-end stack as a deployment ────────────────────────────────────────
# `pnpm e2e:compose` copies deploy/e2e.env over deploy/.env for the length of a run and moves the
# operator's own aside. A hard kill leaves it there: the next `docker compose up -d` on the VM
# brings the pilot stack up on a SESSION_SECRET that is committed to git, POSTGRES_PASSWORD=e2e,
# and AUTH_FALLBACK=paloalto pointed at whatever answers as `paloalto`. Every check below would
# pass on that stack — it is healthy, the model is pulled, the headers are right — and "smoke
# passed" is precisely the sentence that would send it into use.
#
# deploy/e2e.env marks itself with WECOM_E2E_STACK=1 for this. scripts/e2e-compose.mjs is the only
# thing that sets WECOM_E2E_RUNNER=1, so the gate's own runs are unaffected.
env_file="$(dirname "$0")/.env"
if [ "${WECOM_E2E_RUNNER:-}" != "1" ] && [ -f "$env_file" ] &&
   grep -qE '^[[:space:]]*WECOM_E2E_STACK[[:space:]]*=[[:space:]]*1[[:space:]]*$' "$env_file"; then
  echo "smoke FAILED: $env_file is the end-to-end test configuration (WECOM_E2E_STACK=1), not a" >&2
  echo "  deployment's. A killed 'pnpm e2e:compose' run leaves it there. Refusing to certify a" >&2
  echo "  stack built from it: its SESSION_SECRET is in git, its database password is 'e2e', and" >&2
  echo "  AUTH_FALLBACK=paloalto will sign in whoever the configured firewall names." >&2
  echo >&2
  echo "  Recover, from the repo root:" >&2
  echo "    mv deploy/.env.before-e2e deploy/.env    # your real config, saved by the runner" >&2
  echo "    docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d" >&2
  echo "  then re-run this smoke test." >&2
  exit 1
fi

# Reads one scalar out of the health body without needing jq on the host. Each key appears once,
# and the value may itself contain a colon (`qwen2.5:3b-instruct-q4_K_M`), so this stops at the
# next quote, comma or brace rather than splitting on ':'.
field() { printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\).*/\1/p"; }

# The last assignment of a key in deploy/.env, unquoted and untrimmed of trailing space — enough to
# read the two model tags without sourcing a file full of secrets into this shell.
env_value() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$env_file" |
    tail -1 | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# ── W-3: the embedding model has to be pulled too ─────────────────────────────────────────────
# `deploy/.env.example` configures EMBED_MODEL (the search vector re-rank). Nothing pulled it and
# nothing reported it: `/system/health`'s `modelStatus` describes MODEL_NAME alone, so a stack
# whose embedding tag does not exist answers `model:true`, logs nothing, and quietly ranks search
# lexically for the life of the deployment. `deploy/ollama-pull.sh` now pulls both; this asserts it
# from the outside, which is the half that keeps working if that script regresses.
#
# Where the answer comes from, in order:
#   1. the health body, if a future `/system/health` reports the embedding tag (`embedTagPresent`)
#      — then no docker is needed and this works against a remote host;
#   2. `$SMOKE_OLLAMA_TAGS_URL`, for a deployment that publishes Ollama's port;
#   3. `docker compose exec ollama ollama list`, which is how the shipped stack is reachable —
#      Ollama has no published port, by design.
# None of the three available (no docker, a remote host) is a *note*, not a failure: the check
# cannot be performed, and saying "smoke FAILED" for that would be a lie about the stack.
: "${SMOKE_OLLAMA_TAGS_URL:=}"
embed_check() { # <health body> <the generation tag health reported>
  local body=$1 model=$2 embed present listing compose_file
  [ "$SMOKE_REQUIRE_EMBED" = "true" ] || { echo "embedding model check skipped (SMOKE_REQUIRE_EMBED=false)"; return 0; }

  embed=${EMBED_MODEL:-$(env_value EMBED_MODEL)}
  if [ -z "$embed" ]; then
    echo "embedding model: none configured (EMBED_MODEL is empty) — search ranks lexically"
    return 0
  fi
  if [ "$embed" = "$model" ]; then
    echo "embed ok: EMBED_MODEL is the same tag as MODEL_NAME ('$embed'), asserted above"
    return 0
  fi

  # 1. the API, if it has grown the field.
  present=$(field "$body" embedTagPresent)
  if [ -n "$present" ]; then
    [ "$present" = "true" ] || {
      echo "smoke FAILED: /system/health reports the embedding model '$embed' is not pulled." >&2
      echo "  Search would silently fall back to lexical ranking. Pull it:" >&2
      echo "    docker compose -f deploy/docker-compose.yml up -d ollama-pull" >&2
      exit 1
    }
    echo "embed ok: '$embed' is pulled (reported by /system/health)"
    return 0
  fi

  # 2/3. Ollama itself.
  listing=""
  if [ -n "$SMOKE_OLLAMA_TAGS_URL" ]; then
    listing=$(curl -ksS -m 10 "$SMOKE_OLLAMA_TAGS_URL" 2>/dev/null || true)
  elif command -v docker >/dev/null 2>&1; then
    compose_file="$(dirname "$0")/docker-compose.yml"
    # No --env-file: compose reads deploy/.env from the compose file's own directory, which is the
    # same file this script is standing next to.
    listing=$(docker compose -f "$compose_file" exec -T ollama ollama list 2>/dev/null || true)
  fi
  if [ -z "$listing" ]; then
    echo "embedding model '$embed': not verified — neither /system/health nor Ollama could be asked"
    echo "  (Ollama has no published port; this check needs docker on this host, or"
    echo "   SMOKE_OLLAMA_TAGS_URL pointing at its /api/tags). Confirm by hand with:"
    echo "    docker compose -f deploy/docker-compose.yml exec ollama ollama list"
    return 0
  fi
  # One matcher for both shapes: /api/tags' JSON `"name":"<tag>"` and `ollama list`'s first column.
  if printf '%s' "$listing" | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$embed\"" ||
     printf '%s\n' "$listing" | awk 'NR>1{print $1}' | grep -Fxq "$embed"; then
    echo "embed ok: '$embed' is pulled"
    return 0
  fi
  echo "smoke FAILED: EMBED_MODEL is '$embed' and Ollama does not have that tag." >&2
  echo "  Nothing else would have told you: health reports on MODEL_NAME, no log line mentions the" >&2
  echo "  missing one, and search would rank lexically for the life of this deployment. Pull it:" >&2
  echo "    docker compose -f deploy/docker-compose.yml up -d ollama-pull" >&2
  exit 1
}

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
      embed_check "$body" "$model_name"
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
