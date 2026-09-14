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
OLLAMA_HOST=http://127.0.0.1:11499 MODEL_NAME=qwen2.5:3b-instruct-q4_K_M OLLAMA_BIN=/bin/false bash ollama-pull.sh
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
OLLAMA_HOST=http://127.0.0.1:11498 MODEL_NAME=qwen2.5:0.5b-instruct-q4_K_M OLLAMA_BIN="$tmp/ollama" \
  bash ollama-pull.sh
echo "ollama-pull ok (no HTTP client: the CLI answered, still no pull)"
