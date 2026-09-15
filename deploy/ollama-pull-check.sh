#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# stub: /api/tags returns the model as present → script must exit 0 without pulling
python3 - <<'PY' &
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('content-type','application/json'); self.end_headers()
        self.wfile.write(json.dumps({"models":[{"name":"qwen2.5:3b-instruct-q4_K_M"}]}).encode())
    def log_message(self,*a): pass
http.server.HTTPServer(('127.0.0.1', 11499), H).serve_forever()
PY
pid=$!
sleep 0.5
OLLAMA_HOST=http://127.0.0.1:11499 MODEL_NAME=qwen2.5:3b-instruct-q4_K_M EMBED_MODEL= OLLAMA_BIN=/bin/false bash ollama-pull.sh
kill $pid
echo "ollama-pull ok (model already present, no pull attempted)"

# …and the case that actually broke in the container: no HTTP probe at all (the `ollama/ollama`
# image ships neither curl nor wget), so readiness and the presence check have to come from the
# CLI. `OLLAMA_HOST` points at a port nothing listens on, which is what `http_get` failing looks
# like; the fake binary reports the model present and fails loudly if a pull is attempted.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/ollama" <<'FAKE'
#!/bin/sh
case "$1" in
  list) printf 'NAME\tID\tSIZE\tMODIFIED\n'; printf '%s\tdeadbeef\t397 MB\t2 days ago\n' "$MODEL_NAME" ;;
  pull) echo "ollama-pull-check: pulled an already-present model" >&2; exit 1 ;;
  *) exit 1 ;;
esac
FAKE
chmod +x "$tmp/ollama"
OLLAMA_HOST=http://127.0.0.1:11498 MODEL_NAME=qwen2.5:0.5b-instruct-q4_K_M EMBED_MODEL= OLLAMA_BIN="$tmp/ollama" \
  bash ollama-pull.sh
echo "ollama-pull ok (no HTTP client: the CLI answered, still no pull)"

# ── W-3: the embedding model ──────────────────────────────────────────────────────────────────
# `deploy/.env.example` has always configured an EMBED_MODEL, and until now nothing pulled it: a
# documented clean install ended with one tag in `ollama list`, no error anywhere, and a search
# path quietly demoted to lexical ranking. These cases pin the behaviour that replaced it. *Which
# tags get pulled* is the whole finding, so the fake binary records every `pull` it is handed and
# the assertions are on that list rather than on the script's exit code — a script that pulled the
# embedding model twice, or pulled an empty string, would exit 0 just the same.
#
# The fake reports as present exactly the tags in $PRESENT (newline-separated) and appends every
# pull to $PULLED. `OLLAMA_HOST` points at a dead port throughout, so the CLI branch of the
# presence check is the one under test — the branch the real `ollama/ollama` image takes.
cat > "$tmp/recording-ollama" <<'FAKE'
#!/bin/sh
case "$1" in
  list)
    printf 'NAME\tID\tSIZE\tMODIFIED\n'
    if [ -n "$PRESENT" ]; then
      printf '%s\n' "$PRESENT" | while IFS= read -r t; do
        [ -n "$t" ] && printf '%s\tdeadbeef\t397 MB\t2 days ago\n' "$t"
      done
    fi
    exit 0 ;;
  pull) echo "$2" >>"$PULLED"; exit 0 ;;
  *) exit 1 ;;
esac
FAKE
chmod +x "$tmp/recording-ollama"

# expect_pulls <what> <MODEL_NAME> <EMBED_MODEL> <tags already present> <tags that must be pulled>
# The last two are newline-separated lists; the pulled list is compared in order.
expect_pulls() {
  local what=$1 model=$2 embed=$3 present=$4 want=$5 got
  : >"$tmp/pulled"
  PRESENT="$present" PULLED="$tmp/pulled" \
    OLLAMA_HOST=http://127.0.0.1:11497 MODEL_NAME="$model" EMBED_MODEL="$embed" \
    OLLAMA_BIN="$tmp/recording-ollama" bash ollama-pull.sh >/dev/null
  got=$(cat "$tmp/pulled")
  if [ "$got" != "$want" ]; then
    echo "ollama-pull-check FAILED: $what" >&2
    echo "  pulled:   ${got:-(nothing)}" >&2
    echo "  expected: ${want:-(nothing)}" >&2
    exit 1
  fi
  echo "ollama-pull ok ($what)"
}

expect_pulls 'a fresh volume pulls MODEL_NAME and EMBED_MODEL' \
  'qwen2.5:0.5b-instruct-q4_K_M' 'all-minilm:latest' \
  '' \
  'qwen2.5:0.5b-instruct-q4_K_M
all-minilm:latest'

# The exact state W-3 describes: a stack installed before this change, restarted after it.
expect_pulls 'the generation model is already there, the embedding model is not: only the second is pulled' \
  'qwen2.5:0.5b-instruct-q4_K_M' 'all-minilm:latest' \
  'qwen2.5:0.5b-instruct-q4_K_M' \
  'all-minilm:latest'

expect_pulls 'both present: still idempotent, nothing is pulled' \
  'qwen2.5:0.5b-instruct-q4_K_M' 'all-minilm:latest' \
  'qwen2.5:0.5b-instruct-q4_K_M
all-minilm:latest' \
  ''

# An empty EMBED_MODEL is a real configuration (no embedding model; search ranks lexically), and
# one tag for both is another. Neither may pull an empty string or pull the same model twice.
expect_pulls 'EMBED_MODEL unset pulls MODEL_NAME alone' \
  'qwen2.5:0.5b-instruct-q4_K_M' '' '' \
  'qwen2.5:0.5b-instruct-q4_K_M'

expect_pulls 'EMBED_MODEL equal to MODEL_NAME pulls it once' \
  'qwen2.5:0.5b-instruct-q4_K_M' 'qwen2.5:0.5b-instruct-q4_K_M' '' \
  'qwen2.5:0.5b-instruct-q4_K_M'
