#!/usr/bin/env bash
# Validates nginx.conf syntax inside the official image with dummy certs.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -days 1 -subj "/CN=test" >/dev/null 2>&1
docker run --rm -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" -v "$tmp:/etc/nginx/certs:ro" nginx:1.27-alpine nginx -t
grep -q 'proxy_buffering off' nginx.conf && grep -q 'try_files $uri /index.html' nginx.conf && echo "nginx.conf ok"
