#!/usr/bin/env bash
# Pull the configured models once. Idempotent: skips every tag that already exists.
#
# W-3: this used to pull `MODEL_NAME` and nothing else, while `deploy/.env.example` has always
# shipped an `EMBED_MODEL` too (`nomic-embed-text`, the search vector re-rank). Compose did not
# even pass that variable in, so a documented clean install finished with exactly one tag in
# `ollama list` and *nothing said so*: `/system/health` reports on `MODEL_NAME` alone, no log line
# mentions the missing one, and search simply drops to lexical ranking for the life of the
# deployment. Both tags are pulled here now, and `deploy/smoke.sh` asserts both afterwards.
set -euo pipefail
: "${OLLAMA_HOST:=http://ollama:11434}"
: "${MODEL_NAME:=qwen2.5:3b-instruct-q4_K_M}"
# No default on purpose: an empty EMBED_MODEL means "this deployment configures no embedding
# model", which is a supported configuration (search stays lexical), and inventing a tag here
# would pull ~270 MB nobody asked for.
: "${EMBED_MODEL:=}"
: "${OLLAMA_BIN:=ollama}"

# ── wave 6 (X1): the tier and the two generation slots ────────────────────────────────────────
# `MODEL_TIER=n` selects a whole row of the tier table and the API resolves it at boot
# (`apps/api/src/lib/modelSlots.ts`). This script has to resolve the *same* row or a clean install
# at a tier finishes with the wrong tags in `ollama list`: the API would ask Ollama for
# `dictalm2.0-instruct:7b-q4_K_M` and find `qwen2.5:3b-instruct-q4_K_M`, with nothing but a
# per-request 404 to say so. The table below therefore mirrors `MODEL_TIER_PRESETS`
# (`packages/shared/src/schemas/wave6.ts`) — change them together.
: "${MODEL_TIER:=}"
: "${SUGGEST_MODEL:=}"
: "${CHAT_MODEL:=}"
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
# Precedence, identical to `resolveModelSlots`: an explicit slot env → the tier preset →
# MODEL_NAME (generation) / whatever EMBED_MODEL says. EMBED_MODEL is the one exception the api
# also makes: its zod default is `nomic-embed-text`, so a tier overrides exactly that value.
if [ -n "$MODEL_TIER" ]; then
  [ -n "$SUGGEST_MODEL" ] || SUGGEST_MODEL=$(tier_slot "$MODEL_TIER" suggest)
  [ -n "$CHAT_MODEL" ] || CHAT_MODEL=$(tier_slot "$MODEL_TIER" chat)
  if [ -z "$EMBED_MODEL" ] || [ "$EMBED_MODEL" = 'nomic-embed-text' ]; then
    tier_embed=$(tier_slot "$MODEL_TIER" embed)
    [ -n "$tier_embed" ] && EMBED_MODEL=$tier_embed
  fi
fi
: "${SUGGEST_MODEL:=$MODEL_NAME}"
: "${CHAT_MODEL:=$MODEL_NAME}"

# `ollama/ollama` ships neither curl nor wget any more (checked against the `latest` image,
# 2026-09), and this script runs *inside* that image as the `ollama-pull` service. The old
# unconditional `curl -fsS … >/dev/null 2>&1` swallowed the "command not found" along with every
# other failure, so the readiness loop simply waited out all sixty attempts and the presence check
# then died with 127 under `set -e` — a pull that never happened, reported as an opaque exit code
# two minutes later. Use an HTTP client when there is one and the CLI (which is always there, and
# talks to $OLLAMA_HOST) when there is not.
http_get() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    return 127
  fi
}
ready() {
  http_get "$OLLAMA_HOST/api/tags" >/dev/null 2>&1 || OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" list >/dev/null 2>&1
}

for i in $(seq 1 60); do
  if ready; then break; fi
  echo "waiting for ollama ($i)"; sleep 2
done

# `ollama list` prints `NAME ID SIZE MODIFIED`, one model per line after a header, and the name
# carries the tag — so the first column is exactly what /api/tags calls `name`.
present() { # <tag> → prints yes|no
  local tag=$1 listing
  listing=$(http_get "$OLLAMA_HOST/api/tags" 2>/dev/null || true)
  if [ -n "$listing" ]; then
    printf '%s' "$listing" | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$tag\"" && echo yes || echo no
  else
    OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$tag" && echo yes || echo no
  fi
}

# Every tag the deployment configures, de-duplicated in slot order: a deployment whose two
# generation slots are the same tag (every tier but 2 and 3), or that embeds with its generation
# model, or that leaves EMBED_MODEL empty, must not pull the same thing twice or an empty string.
wanted=()
add_slot() { # <slot name> <tag>
  local slot=$1 tag=$2 have
  if [ -z "$tag" ]; then
    echo "$slot: no tag configured — skipping"
    return 0
  fi
  for have in ${wanted[@]+"${wanted[@]}"}; do
    if [ "$have" = "$tag" ]; then
      echo "$slot: $tag (already queued by an earlier slot — one pull covers both)"
      return 0
    fi
  done
  echo "$slot: $tag"
  wanted+=("$tag")
}
add_slot suggest "$SUGGEST_MODEL"
add_slot chat "$CHAT_MODEL"
if [ -z "$EMBED_MODEL" ]; then
  echo "EMBED_MODEL is not set — no embedding model to pull, search will rank lexically"
else
  add_slot embed "$EMBED_MODEL"
fi

for tag in "${wanted[@]}"; do
  # Re-asked per tag rather than once: after the first pull the cached listing is stale, and a
  # stale "absent" would re-pull a model that is already there.
  if [ "$(present "$tag")" = yes ]; then
    echo "model $tag already present"
    continue
  fi
  echo "pulling $tag (CPU quantized, first start only)"
  OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" pull "$tag"
done
echo "model ready: ${wanted[*]}"
