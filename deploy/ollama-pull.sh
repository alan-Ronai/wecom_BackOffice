#!/usr/bin/env bash
# Pull the configured model once. Idempotent: skips when the tag already exists.
set -euo pipefail
: "${OLLAMA_HOST:=http://ollama:11434}"
: "${MODEL_NAME:=qwen2.5:3b-instruct-q4_K_M}"
: "${OLLAMA_BIN:=ollama}"

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
tags=$(http_get "$OLLAMA_HOST/api/tags" 2>/dev/null || true)
if [ -n "$tags" ]; then
  present=$(printf '%s' "$tags" | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$MODEL_NAME\"" && echo yes || echo no)
else
  present=$(OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$MODEL_NAME" && echo yes || echo no)
fi
if [ "$present" = yes ]; then
  echo "model $MODEL_NAME already present"
  exit 0
fi
echo "pulling $MODEL_NAME (CPU quantized, first start only)"
OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" pull "$MODEL_NAME"
echo "model ready"
