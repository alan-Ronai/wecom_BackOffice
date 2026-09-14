#!/usr/bin/env bash
# Validates nginx.conf inside the official image with dummy certs:
#   1. `nginx -t` (syntax), plus two greps for settings that have silently regressed before
#   2. the security headers are actually on the wire for every response the browser can get
#
# (2) exists because acceptance review O-1 found that `nginx -t` passing and the `add_header`
# lines being present in the file proved nothing: nginx drops every inherited `add_header` in a
# location that declares one of its own, so `/` and `/assets/*` shipped with no CSP, no HSTS, no
# nosniff and no X-Frame-Options while the config "looked" right. Only a live `curl -I` catches
# that class of defect, so this check starts a throwaway container and asks it.
set -euo pipefail
cd "$(dirname "$0")"

tmp=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -days 1 -subj "/CN=test" >/dev/null 2>&1

conf_mounts=(
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro"
  -v "$PWD/nginx-security-headers.conf:/etc/nginx/security-headers.conf:ro"
  -v "$tmp:/etc/nginx/certs:ro"
)

docker run --rm "${conf_mounts[@]}" nginx:1.27-alpine nginx -t
grep -q 'proxy_buffering off' nginx.conf && grep -q 'try_files $uri /index.html' nginx.conf && echo "nginx.conf ok"

# ── live header assertion ──────────────────────────────────────────────────────
# A user-defined network gives the container Docker's embedded resolver at 127.0.0.11, which the
# config needs at request time for the `api` upstream. Nothing answers as `api`, so /api/* is a
# 502 — that is fine and in fact the stronger assertion, because the headers are declared
# `always` and must survive an error response too.
name=kb-nginx-header-check
net=kb-nginx-header-check-net
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
docker rm -f "$name" >/dev/null 2>&1 || true
docker network rm "$net" >/dev/null 2>&1 || true
docker network create "$net" >/dev/null

root=$(mktemp -d)
mkdir -p "$root/assets"
printf '<!doctype html><title>kb</title>' >"$root/index.html"
printf 'export const x = 1;\n' >"$root/assets/x.js"
chmod -R a+rX "$root"

docker run -d --name "$name" --network "$net" \
  "${conf_mounts[@]}" \
  -v "$root:/usr/share/nginx/html:ro" \
  -p 127.0.0.1:0:443 nginx:1.27-alpine >/dev/null

port=$(docker port "$name" 443/tcp | head -1 | sed 's/.*://')
base="https://127.0.0.1:$port"

for i in $(seq 1 30); do
  curl -ksS -o /dev/null "$base/" && break
  [ "$i" = 30 ] && { echo "nginx-check FAILED: container never answered on $base" >&2; docker logs "$name" >&2; exit 1; }
  sleep 1
done

# The exact header set deploy/nginx-security-headers.conf promises. Matched case-insensitively
# on `name: value-prefix` so a tightened CSP or a longer max-age does not break the check.
expect=(
  'strict-transport-security: max-age=31536000; includesubdomains'
  'x-content-type-options: nosniff'
  'x-frame-options: sameorigin'
  'referrer-policy: strict-origin-when-cross-origin'
  "content-security-policy: default-src 'self'; script-src 'self'"
)

fail=0
for path in / /assets/x.js /api/v1/system/health; do
  headers=$(curl -kI -sS "$base$path" | tr -d '\r' | tr 'A-Z' 'a-z')
  missing=0
  for want in "${expect[@]}"; do
    if ! printf '%s\n' "$headers" | grep -qF "$want"; then
      echo "nginx-check FAILED: $path is missing header '${want%%:*}'" >&2
      missing=1
      fail=1
    fi
  done
  [ "$missing" = 0 ] && echo "security headers ok: $path"
done
rm -rf "$root"
[ "$fail" = 0 ] || exit 1

echo "nginx security headers ok (/, /assets/*, /api/*)"
