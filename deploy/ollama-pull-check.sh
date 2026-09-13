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
