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

# ── X-Forwarded-For must replace, never append ────────────────────────────────
# `$proxy_add_x_forwarded_for` appends the connecting address to whatever the client sent, so with
# TRUST_PROXY naming this hop the API unwound the list to an address the *client* chose — and
# req.ip is what the Palo Alto User-ID allowlist is checked against. Any client that could reach
# nginx could be identified as whoever the firewall maps. Asserted statically, on every location
# that proxies, because a single reverted line is all it takes and nothing downstream would say so.
#
# Comments are stripped first: the file explains the rule in prose, and the prose names the
# variable it forbids.
stripped=$(sed 's/#.*//' nginx.conf)

if printf '%s\n' "$stripped" | grep -q 'proxy_add_x_forwarded_for'; then
  echo "nginx-check FAILED: nginx.conf uses \$proxy_add_x_forwarded_for, which appends the client's own X-Forwarded-For — use \$remote_addr" >&2
  exit 1
fi

# Every `location` block containing a proxy_pass must also set X-Forwarded-For to $remote_addr.
proxy_locations=$(printf '%s\n' "$stripped" | awk '/^[ \t]*location[ \t]/ { inloc=1 } inloc && /proxy_pass/ { n++ } inloc && /^[ \t]*\}/ { inloc=0 } END { print n+0 }')
bad_locations=$(printf '%s\n' "$stripped" | awk '
  /^[ \t]*location[ \t]/ {
    loc = $0; sub(/[ \t]*\{.*/, "", loc); sub(/^[ \t]*/, "", loc)
    inloc = 1; pass = 0; xff = 0; next
  }
  inloc && /proxy_pass/ { pass = 1 }
  inloc && /proxy_set_header[ \t]+X-Forwarded-For[ \t]+\$remote_addr[ \t]*;/ { xff = 1 }
  inloc && /^[ \t]*\}/ { if (pass && !xff) print "  " loc; inloc = 0 }
')
if [ -n "$bad_locations" ]; then
  echo "nginx-check FAILED: these locations proxy without \`proxy_set_header X-Forwarded-For \$remote_addr;\`:" >&2
  echo "$bad_locations" >&2
  exit 1
fi
# A parser that matched nothing would "pass" silently; the config has /api/ and the SSE location.
if [ "$proxy_locations" -lt 2 ]; then
  echo "nginx-check FAILED: found $proxy_locations proxying locations, expected at least 2 (/api/ and the SSE stream) — has the config been restructured?" >&2
  exit 1
fi
echo "X-Forwarded-For ok: \$remote_addr on all $proxy_locations proxying locations, no \$proxy_add_x_forwarded_for"

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
