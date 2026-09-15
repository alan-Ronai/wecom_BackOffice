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
#
# W-7: the argument is an *origin* — scheme, host and, if it is not the scheme's default, port.
# `https://kb.wecom.local:9443` is the spelling a deployment with WEB_HTTPS_PORT≠443 needs, and
# dropping the port sends every request to 443, where nothing answers and the only symptom is
# sixty rounds of `waiting for api`. Three conveniences so that the obvious spellings work rather
# than time out: a bare `host:port` is assumed https, a trailing slash is dropped (it would build
# `//api/v1/...`), and a path is refused outright, because silently prefixing every request with
# it produces the same sixty rounds and a wrong reason to look for them.
set -euo pipefail
base=${1:-https://localhost}
base=${base%/}
case "$base" in
  https://*|http://*) ;;
  *) base="https://$base" ;;
esac
case "${base#*://}" in
  '')
    echo "smoke FAILED: '${1:-}' names no host. Pass an origin: https://kb.wecom.local:9443" >&2
    exit 1 ;;
  */*)
    hostport=${base#*://}
    echo "smoke FAILED: '${1:-}' has a path. This takes an origin — scheme, host and port, nothing" >&2
    echo "  after it; the paths it checks are its own. Try: ${base%%://*}://${hostport%%/*}" >&2
    exit 1 ;;
esac
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
# ── wave 6 (X1): the tier and the two generation slots ────────────────────────────────────────
# `MODEL_TIER=n` picks the suggestion model, the chat model, the embedder and its width in one
# number, and `deploy/ollama-pull.sh` resolves it the same way. This mirrors that resolution once
# more so the smoke test asserts the tags the *api* will ask for, not the ones someone typed —
# the three copies (api, pull, smoke) all mirror `MODEL_TIER_PRESETS`. Change them together.
tier_slot() { # <tier> <suggest|chat|embed>
  case "$1:$2" in
    0:suggest|0:chat) echo 'qwen2.5:3b-instruct-q4_K_M' ;;
    0:embed) echo 'nomic-embed-text' ;;
    1:suggest|1:chat) echo 'dictalm2.0-instruct:7b-q4_K_M' ;;
    2:suggest) echo 'gemma3:12b-it-q4_K_M' ;;
    2:chat) echo 'dictalm2.0-instruct:7b-q4_K_M' ;;
    3:suggest) echo 'gemma3:27b-it-q4_K_M' ;;
    3:chat) echo 'gemma3:12b-it-q4_K_M' ;;
    4:suggest|4:chat) echo 'gemma3:27b-it-q4_K_M' ;;
    [1-4]:embed) echo 'bge-m3' ;;
    *) echo '' ;;
  esac
}
# The effective tag for one slot: explicit env → tier preset → MODEL_NAME (generation) / the
# configured EMBED_MODEL. Empty is a real answer for `embed` (no embedding model configured).
resolved_slot() { # <suggest|chat|embed>
  local slot=$1 tier explicit name
  tier=${MODEL_TIER:-$(env_value MODEL_TIER)}
  case "$slot" in
    suggest) explicit=${SUGGEST_MODEL:-$(env_value SUGGEST_MODEL)} ;;
    chat) explicit=${CHAT_MODEL:-$(env_value CHAT_MODEL)} ;;
    embed) explicit=${EMBED_MODEL:-$(env_value EMBED_MODEL)} ;;
  esac
  if [ "$slot" = embed ]; then
    if [ -n "$tier" ] && { [ -z "$explicit" ] || [ "$explicit" = 'nomic-embed-text' ]; }; then
      local t; t=$(tier_slot "$tier" embed); [ -n "$t" ] && explicit=$t
    fi
    printf '%s' "$explicit"
    return 0
  fi
  [ -n "$explicit" ] && { printf '%s' "$explicit"; return 0; }
  if [ -n "$tier" ]; then
    local t; t=$(tier_slot "$tier" "$slot")
    [ -n "$t" ] && { printf '%s' "$t"; return 0; }
  fi
  name=${MODEL_NAME:-$(env_value MODEL_NAME)}
  printf '%s' "$name"
}

# Is one tag in Ollama's listing? → yes | no | unknown ("could not be asked", which is a note
# rather than a failure: no docker on this host, or a remote deployment). Two sources, in order:
# `$SMOKE_OLLAMA_TAGS_URL` for a stack that publishes Ollama's port, then `docker compose exec`,
# which is how the shipped stack is reachable — Ollama has no published port, by design.
: "${SMOKE_OLLAMA_TAGS_URL:=}"
tag_present() { # <tag> → yes|no|unknown
  local tag=$1 listing compose_file
  listing=""
  if [ -n "$SMOKE_OLLAMA_TAGS_URL" ]; then
    listing=$(curl -ksS -m 10 "$SMOKE_OLLAMA_TAGS_URL" 2>/dev/null || true)
  elif command -v docker >/dev/null 2>&1; then
    compose_file="$(dirname "$0")/docker-compose.yml"
    # No --env-file: compose reads deploy/.env from the compose file's own directory, which is the
    # same file this script is standing next to.
    listing=$(docker compose -f "$compose_file" exec -T ollama ollama list 2>/dev/null || true)
  fi
  [ -n "$listing" ] || { echo unknown; return 0; }
  # One matcher for both shapes: /api/tags' JSON `"name":"<tag>"` and `ollama list`'s first column.
  if printf '%s' "$listing" | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$tag\"" ||
     printf '%s\n' "$listing" | awk 'NR>1{print $1}' | grep -Fxq "$tag"; then
    echo yes
  else
    echo no
  fi
}

# Prints the resolved tier line, and — when a generation slot resolves to something other than the
# tag `/system/health` already asserted — checks that Ollama has it too. A tiered install whose
# chat slot was never pulled answers `model: true` and 404s on every chat turn.
slot_check() { # <the generation tag health reported>
  local reported=$1 tier suggest chat embed dims
  tier=${MODEL_TIER:-$(env_value MODEL_TIER)}
  suggest=$(resolved_slot suggest); chat=$(resolved_slot chat); embed=$(resolved_slot embed)
  dims=${EMBED_DIMENSION:-$(env_value EMBED_DIMENSION)}
  echo "models: tier=${tier:-legacy} suggest=${suggest:-?} chat=${chat:-?} embed=${embed:-none} (dims ${dims:-768})"
  local tag
  for tag in "$suggest" "$chat"; do
    [ -n "$tag" ] || continue
    [ "$tag" = "$reported" ] && continue
    case "$(tag_present "$tag")" in
      yes) echo "slot ok: '$tag' is pulled" ;;
      unknown) echo "slot '$tag': not verified — Ollama could not be asked" ;;
      *)
        echo "smoke FAILED: the resolved generation tag '$tag' is not in Ollama." >&2
        echo "  /system/health only asserts MODEL_NAME, so a tiered install would 404 on every" >&2
        echo "  generation call with nothing else to say so. Pull it:" >&2
        echo "    docker compose -f deploy/docker-compose.yml up -d ollama-pull" >&2
        exit 1 ;;
    esac
  done
}

: "${SMOKE_OLLAMA_TAGS_URL:=}"
embed_check() { # <health body> <the generation tag health reported>
  local body=$1 model=$2 embed present listing compose_file
  [ "$SMOKE_REQUIRE_EMBED" = "true" ] || { echo "embedding model check skipped (SMOKE_REQUIRE_EMBED=false)"; return 0; }

  embed=$(resolved_slot embed)
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
  case "$(tag_present "$embed")" in
    unknown)
      echo "embedding model '$embed': not verified — neither /system/health nor Ollama could be asked"
      echo "  (Ollama has no published port; this check needs docker on this host, or"
      echo "   SMOKE_OLLAMA_TAGS_URL pointing at its /api/tags). Confirm by hand with:"
      echo "    docker compose -f deploy/docker-compose.yml exec ollama ollama list"
      return 0 ;;
    yes)
      echo "embed ok: '$embed' is pulled"
      return 0 ;;
  esac
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

# ── W-9: what the backup status means on an install that is ten minutes old ────────────────────
# `system.backup-check` runs at API start-up and after the nightly job. At install time there is no
# dump, so health has always answered `lastBackupOk:false, lastBackupAt:null` — a red backup status
# on a stack that has done nothing wrong. The operator walkthrough hit it as step 22 and it is
# documented in INSTALL's Troubleshooting; the durable fix is a tri-state in health, and this reads
# either shape:
#
#   future: a `backup` block (or scalar) carrying `status` — "ok" / "never" (or "pending") /
#           "stale" / "failed";
#   today:  `lastBackupOk` + `lastBackupAt`, where false-with-a-null-timestamp is exactly "never".
#
# None of it fails the smoke test. "Is a dump older than a day, or missing on a fresh install" is
# not the question this script answers — it answers "is the stack up" — and an install-time failure
# here would be the false alarm W-9 is about. A stale or failed backup on a *running* pilot is a
# real problem, so it is printed as a warning the operator cannot miss rather than swallowed.
backup_check() { # <health body>
  local body=$1 block status ok at
  # The `backup` object, if there is one; `[^}]*` keeps this to a flat block, which is all the
  # shape above needs, and an absent key simply yields nothing.
  block=$(printf '%s' "$body" | sed -n 's/.*"backup"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p')
  # Only ever inside that block: `status` is a common enough key that scanning the whole body
  # would sooner or later read some other subsystem's.
  status=''
  if [ -n "$block" ]; then status=$(field "$block" status); fi
  # …or a plain string, `"backup":"never"`.
  [ -n "$status" ] || status=$(printf '%s' "$body" | sed -n 's/.*"backup"[[:space:]]*:[[:space:]]*"\([A-Za-z]*\)".*/\1/p')

  if [ -z "$status" ]; then
    ok=$(field "$body" lastBackupOk)
    at=$(field "$body" lastBackupAt)
    case "$ok" in
      true) status=ok ;;
      false|'')
        # A null/absent timestamp and a not-ok check is a stack that has never seen a dump; with a
        # timestamp it has, and the check on it did not pass.
        case "$at" in null|'') status=never ;; *) status=failed ;; esac ;;
      *) status=$ok ;;
    esac
  fi

  case "$status" in
    ok|true)
      echo "backup ok: the last dump passed its check" ;;
    never|pending|none)
      echo "backup: none yet — expected on a fresh install, and not a failure. \`system.backup-check\`"
      echo "  runs at API start-up, before any dump exists, so /admin/system shows this red until the"
      echo "  first one. Take one now and restart the API to clear it:"
      echo "    docker compose -f deploy/docker-compose.yml exec backup backup.sh"
      echo "    docker compose -f deploy/docker-compose.yml restart api" ;;
    stale)
      echo "smoke WARNING: the newest backup is stale — the nightly job has not produced a dump" >&2
      echo "  recently. The stack is up and this does not fail the smoke test, but a pilot with no" >&2
      echo "  current dump is one \`down -v\` from unrecoverable. Check: docker compose -f" >&2
      echo "  deploy/docker-compose.yml logs backup" >&2 ;;
    failed|false)
      echo "smoke WARNING: a backup exists and its check did not pass. The stack is up; the dump is" >&2
      echo "  not trustworthy. Check: docker compose -f deploy/docker-compose.yml logs backup, and" >&2
      echo "  re-run deploy/backup-check.sh." >&2 ;;
    *)
      echo "backup status: '$status' (unrecognised — reported, not judged)" ;;
  esac
}

# Everything above is argument handling and pure functions; everything below talks to a stack.
# `deploy/smoke-check.sh` sources this file with SMOKE_LIB_ONLY=1 to exercise the first half
# without needing the second — `return` outside a sourced file is an error, hence the guard's
# shape, and a direct run never sets the variable.
if [ "${SMOKE_LIB_ONLY:-}" = "1" ]; then return 0; fi

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
      slot_check "$model_name"
      embed_check "$body" "$model_name"
    fi
    echo "health ok: $body"
    backup_check "$body"
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
