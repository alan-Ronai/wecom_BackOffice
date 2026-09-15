#!/usr/bin/env bash
# Validates nginx.conf inside the official image with dummy certs:
#   1. `nginx -t` (syntax), plus greps for settings that have silently regressed before
#   2. X-Forwarded-For replaces rather than appends, on every proxying location
#   3. server_tokens and the TLS settings are present in the file…
#   4. …and the security headers, the Server header and the handshake are what that file says,
#      asked of a throwaway container over a real connection
#
# The live half exists because acceptance review O-1 found that `nginx -t` passing and the
# `add_header` lines being present in the file proved nothing: nginx drops every inherited
# `add_header` in a location that declares one of its own, so `/` and `/assets/*` shipped with no
# CSP, no HSTS, no nosniff and no X-Frame-Options while the config "looked" right. The same gap
# applies to any directive that can be overridden in a narrower context — `server_tokens off` in
# `http` means nothing if `server` says `on` — so both halves are kept: the static greps catch a
# deleted line, the live assertions catch a line that is there and not in effect.
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

# ── the TLS and version-disclosure settings ───────────────────────────────────
# Stated in nginx.conf rather than inherited from whichever nginx image the VM pulled, so they are
# asserted here the same way: statically, because a deleted line is silent, and then against a real
# handshake below, because a *present* line that nginx ignored is just as silent.
tls_missing=0
want_setting() { # <grep -E pattern> <what it is>
  printf '%s\n' "$stripped" | grep -Eq "$1" || {
    echo "nginx-check FAILED: nginx.conf does not set $2 (expected /$1/)" >&2
    tls_missing=1
  }
}
want_setting '^[ \t]*server_tokens[ \t]+off[ \t]*;' 'server_tokens off (nginx advertises its exact version otherwise)'
want_setting '^[ \t]*ssl_protocols[ \t]+TLSv1\.2[ \t]+TLSv1\.3[ \t]*;' 'ssl_protocols TLSv1.2 TLSv1.3'
want_setting '^[ \t]*ssl_ciphers[ \t]+ECDHE' 'an explicit ECDHE-only ssl_ciphers list'
want_setting '^[ \t]*ssl_prefer_server_ciphers[ \t]+on[ \t]*;' 'ssl_prefer_server_ciphers on'
want_setting '^[ \t]*ssl_session_cache[ \t]+shared:' 'a shared ssl_session_cache'
want_setting '^[ \t]*ssl_session_tickets[ \t]+off[ \t]*;' 'ssl_session_tickets off'
# Anything here would undo the list above by re-admitting CBC/RSA/SHA-1 suites.
if printf '%s\n' "$stripped" | grep -Eq 'ssl_ciphers[^;]*(DES|RC4|MD5|NULL|EXPORT|:AES[0-9]+-)'; then
  echo "nginx-check FAILED: ssl_ciphers admits a legacy suite (DES/RC4/MD5/NULL/EXPORT or a non-ECDHE AES suite)" >&2
  tls_missing=1
fi
[ "$tls_missing" = 0 ] || exit 1
echo "TLS settings ok: server_tokens off, TLSv1.2+1.3, ECDHE-only ciphers, shared session cache, no tickets"

# ── live header assertion ──────────────────────────────────────────────────────
# A user-defined network gives the container Docker's embedded resolver at 127.0.0.11, which the
# config needs at request time for the `api` upstream. Nothing answers as `api`, so /api/* is a
# 502 — that is fine and in fact the stronger assertion, because the headers are declared
# `always` and must survive an error response too.
#
# Suffixed with this process's pid, for the reason deploy/backup-check.sh now is: the `docker rm
# -f` below is unconditional, so with fixed names two runs on one machine — this script beside a
# `pnpm e2e:compose`, or two branches — deleted each other's container and network mid-assertion.
name=kb-nginx-header-check-$$
net=kb-nginx-header-check-net-$$
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
# `= /api/v1/events` last, and it is not redundant with `/api/v1/system/health`: an *exact*-match
# location outranks the `/api/` prefix block, so it is a separate block with its own `include` —
# and the SSE stream is the one long-lived connection the app opens. Deleting that one line would
# leave it uncovered while every other path here still passed.
for path in / /assets/x.js /api/v1/system/health /api/v1/events; do
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
[ "$fail" = 0 ] || exit 1

echo "nginx security headers ok (/, /assets/*, /api/*, = /api/v1/events)"

# ── what the CSP must allow, and what it must never allow ─────────────────────────────────────
# The grep above matches a *prefix* of the header, so it says nothing about the directives after
# `script-src 'self'`. Two things have to hold, and they pull in opposite directions.
#
# It must admit the app's own scripts, styles and fonts. The walkthrough found the deployed app
# logging a CSP violation on every page load for its pre-paint theme script (W-4) and for a Google
# Fonts `@import` (W-5): the theme stamp never ran, and the Hebrew typography the design assumes
# was never what a user saw. The app lane's fix for both is to become same-origin — the script
# moves into a file Vite emits, the fonts are self-hosted under `apps/web/public/fonts/` — and
# that fix only works if `script-src`, `style-src` and `font-src` each keep `'self'`. Losing one
# would break the page silently, with the evidence only in a browser console nobody has open.
#
# And it must not be "fixed" the other way. The browser offers `'unsafe-inline'` in the very error
# message, and adding it to `script-src` re-admits every injected inline script — which is most of
# what a CSP is for, given the app has a `dangerouslySetInnerHTML`. So that is asserted absent,
# here, where a future edit trying the easy fix meets a red check with a reason.
#
# `style-src` keeps its `'unsafe-inline'`: React writes inline `style` attributes and there is no
# same-origin alternative. That is a deliberate, documented exception (see
# nginx-security-headers.conf) and is not what W-4 is about, so it is not asserted against.
csp=$(curl -kI -sS "$base/" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy:[[:space:]]*//p' | head -1)
[ -n "$csp" ] || { echo "nginx-check FAILED: GET / returned no Content-Security-Policy" >&2; exit 1; }

# One directive's value, by name, out of the `a 'self'; b 'self' x` list.
csp_directive() { printf '%s' "$csp" | tr ';' '\n' | sed -n "s/^[[:space:]]*$1[[:space:]]\{1,\}//p" | head -1; }

csp_fail=0
# script-src/style-src/font-src each fall back to default-src when absent, so an explicit
# `default-src 'self'` satisfies the requirement — read the fallback the way a browser does.
default_src=$(csp_directive default-src)
for d in script-src style-src font-src; do
  value=$(csp_directive "$d")
  [ -n "$value" ] || value=$default_src
  case "$value" in
    *"'self'"*) ;;
    *)
      echo "nginx-check FAILED: the CSP's $d is \"${value:-(absent, and no default-src)}\" — it does not" >&2
      echo "  allow 'self'. The app's own script, stylesheet and font files are served from this" >&2
      echo "  origin; without 'self' the page loads with the theme script blocked and the Hebrew" >&2
      echo "  web fonts refused, and the only evidence is a browser console (walkthrough W-4/W-5)." >&2
      csp_fail=1 ;;
  esac
done

script_src=$(csp_directive script-src)
[ -n "$script_src" ] || script_src=$default_src
for bad in "'unsafe-inline'" "'unsafe-eval'"; do
  case "$script_src" in
    *"$bad"*)
      echo "nginx-check FAILED: the CSP's script-src contains $bad." >&2
      echo "  The browser suggests 'unsafe-inline' by name when it blocks an inline script, and" >&2
      echo "  taking that suggestion re-admits every injected one — which is most of what this" >&2
      echo "  header is for. The inline script belongs in a file served from this origin instead;" >&2
      echo "  'self' already covers it." >&2
      csp_fail=1 ;;
  esac
done
[ "$csp_fail" = 0 ] || exit 1
echo "CSP ok: 'self' scripts, styles and fonts are allowed; script-src has no 'unsafe-inline'/'unsafe-eval'"

# The static server root is only needed by the assertions above.
rm -rf "$root"

# ── live: the settings above are in effect, not merely present ─────────────────
# A directive in the wrong context, or one a future nginx quietly stops honouring, still greps.
# These ask the running server instead.

# `Server: nginx` with no version — what server_tokens off buys.
server_hdr=$(curl -ksSI "$base/" | tr -d '\r' | awk -F': ' 'tolower($1)=="server"{print $2}')
case "$server_hdr" in
  nginx) echo "server_tokens ok: the Server header is a bare '$server_hdr'" ;;
  nginx/*)
    echo "nginx-check FAILED: 'Server: $server_hdr' discloses the version — server_tokens off is not in effect" >&2
    exit 1 ;;
  *)
    echo "nginx-check FAILED: unexpected Server header '${server_hdr:-(absent)}'" >&2
    exit 1 ;;
esac

# What an actual handshake negotiates. `New, TLSv1.2, Cipher is …` is s_client's summary line.
# `|| true` twice over, and deliberately: a refused handshake is a *result* here, not an error, and
# under `set -e` with `pipefail` either openssl's non-zero exit or the empty pipeline would
# otherwise abort the script exactly when it is about to assert the refusal.
negotiated() { # <openssl protocol flag>
  { openssl s_client -connect "127.0.0.1:$port" -servername localhost "$1" </dev/null 2>/dev/null ||
    true; } | sed -n 's/^New, \(TLSv[0-9.]*\), Cipher is \(.*\)$/\1 \2/p' | head -1
}

tls12=$(negotiated -tls1_2 || true)
case "$tls12" in
  "TLSv1.2 ECDHE-"*-GCM-*|"TLSv1.2 ECDHE-"*-CHACHA20-POLY1305)
    echo "TLS 1.2 ok: negotiated $tls12" ;;
  '')
    echo "nginx-check FAILED: no TLS 1.2 handshake succeeded — ssl_protocols/ssl_ciphers reject every suite a client offers" >&2
    exit 1 ;;
  *)
    echo "nginx-check FAILED: TLS 1.2 negotiated '$tls12', which is not one of the ECDHE AEAD suites ssl_ciphers lists" >&2
    exit 1 ;;
esac

tls13=$(negotiated -tls1_3 || true)
case "$tls13" in
  "TLSv1.3 TLS_"*) echo "TLS 1.3 ok: negotiated $tls13" ;;
  '')
    echo "nginx-check FAILED: no TLS 1.3 handshake succeeded, though ssl_protocols lists it" >&2
    exit 1 ;;
  *)
    echo "nginx-check FAILED: TLS 1.3 negotiated unexpected '$tls13'" >&2
    exit 1 ;;
esac

# …and nothing below 1.2. (A client-side refusal counts: either way no such connection is made.
# Only a *successful* TLS 1.1 handshake is a failure here.)
for old in -tls1 -tls1_1; do
  got=$(negotiated "$old" || true)
  if [ -n "$got" ]; then
    echo "nginx-check FAILED: a ${old#-} handshake succeeded ($got) — ssl_protocols is not limiting the protocol" >&2
    exit 1
  fi
done
echo "TLS 1.0/1.1 ok: refused"
