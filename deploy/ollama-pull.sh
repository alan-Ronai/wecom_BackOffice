#!/usr/bin/env bash
# Pull the configured model once. Idempotent: skips when the tag already exists.
set -euo pipefail
: "${OLLAMA_HOST:=http://ollama:11434}"
: "${MODEL_NAME:=qwen2.5:3b-instruct-q4_K_M}"
: "${OLLAMA_BIN:=ollama}"

for i in $(seq 1 60); do
  if curl -fsS "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then break; fi
  echo "waiting for ollama ($i)"; sleep 2
done

if curl -fsS "$OLLAMA_HOST/api/tags" | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$MODEL_NAME\""; then
  echo "model $MODEL_NAME already present"
  exit 0
fi
echo "pulling $MODEL_NAME (CPU quantized, first start only)"
OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" pull "$MODEL_NAME"
echo "model ready"
