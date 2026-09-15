#!/usr/bin/env bash
# W-8: asserts that every service in deploy/docker-compose.yml caps its container log.
#
# Docker's json-file driver has no default `max-size`, so an uncapped container log grows until
# the partition is full — on a single-partition pilot VM that surfaces as Postgres refusing
# writes, hours after the actual cause. The fix is one `logging:` block per service; the failure
# mode of the fix is a *new* service that forgets it, which is silent until the disk goes.
#
# So this asks `docker compose config` rather than reading the file: that is the resolved,
# post-anchor, post-interpolation view the daemon is actually handed, so a `logging:` key that is
# present but mis-shaped, or an anchor that a service did not reference, fails here. Only the base
# file is checked — the ci/e2e overlays add short-lived stub containers whose logs die with the
# run, and holding them to a production retention policy would be noise.
set -euo pipefail
cd "$(dirname "$0")"

WANT_DRIVER=json-file
WANT_MAX_SIZE=20m
WANT_MAX_FILE=5

# `docker compose config` interpolates for real: an unset `${TLS_CERT_PATH}` produces a volume
# spec of `:/etc/nginx/certs/cert.pem:ro`, which is an error rather than a warning. These values
# are never used for anything — nothing is started — they exist so the file can be rendered.
export POSTGRES_PASSWORD=compose-check
export MODEL_NAME=compose-check
export EMBED_MODEL=compose-check
export TLS_CERT_PATH=./certs/cert.pem
export TLS_KEY_PATH=./certs/key.pem
export WEB_HTTPS_PORT=0
export WEB_HTTP_PORT=0

# The api service declares `env_file: .env`, and compose refuses to render a file whose env_file
# is missing. A fresh clone has no deploy/.env (it is gitignored, and INSTALL.md step 3 is what
# creates it), so stand one up for the length of the check — and only ever remove the one we made,
# because a running stack's .env must survive this script untouched.
created_env=
cleanup() { [ -n "$created_env" ] && rm -f .env || true; }
trap cleanup EXIT
if [ ! -f .env ]; then
  : > .env
  created_env=1
fi

rendered=$(docker compose -f docker-compose.yml config --format json)

# jq if it is there, node otherwise — this repo always has node, and a check that only runs on
# machines with jq installed is a check that does not run in half the places it matters.
# `COMPOSE_CHECK_NO_JQ=1` forces the second path, so the fallback can be exercised on a machine
# that has jq (a fallback nothing ever runs is a fallback that is broken).
if command -v jq >/dev/null 2>&1 && [ -z "${COMPOSE_CHECK_NO_JQ:-}" ]; then
  report=$(printf '%s' "$rendered" | jq -r --arg d "$WANT_DRIVER" --arg s "$WANT_MAX_SIZE" --arg f "$WANT_MAX_FILE" '
    .services
    | to_entries
    | map(
        .key as $name
        | .value.logging as $l
        | if $l == null then "MISSING \($name): no logging: block"
          elif $l.driver != $d then "WRONG   \($name): driver \($l.driver // "null"), want \($d)"
          elif ($l.options["max-size"] | tostring) != $s then "WRONG   \($name): max-size \($l.options["max-size"] // "null"), want \($s)"
          elif ($l.options["max-file"] | tostring) != $f then "WRONG   \($name): max-file \($l.options["max-file"] // "null"), want \($f)"
          else "OK      \($name)"
          end
      )
    | .[]')
else
  report=$(printf '%s' "$rendered" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const [d, s, f] = process.argv.slice(1);
      const services = JSON.parse(raw).services ?? {};
      for (const [name, svc] of Object.entries(services)) {
        const l = svc.logging;
        const o = (l && l.options) || {};
        if (!l) console.log(`MISSING ${name}: no logging: block`);
        else if (l.driver !== d) console.log(`WRONG   ${name}: driver ${l.driver}, want ${d}`);
        else if (String(o["max-size"]) !== s) console.log(`WRONG   ${name}: max-size ${o["max-size"]}, want ${s}`);
        else if (String(o["max-file"]) !== f) console.log(`WRONG   ${name}: max-file ${o["max-file"]}, want ${f}`);
        else console.log(`OK      ${name}`);
      }
    });
  ' "$WANT_DRIVER" "$WANT_MAX_SIZE" "$WANT_MAX_FILE")
fi

echo "$report"

# A rendered file with no services at all would otherwise pass every assertion above by having
# nothing to assert — the one way this check can go green while proving nothing.
count=$(printf '%s\n' "$report" | grep -c . || true)
[ "$count" -ge 6 ] || { echo "compose-check FAILED: only $count services rendered (expected at least 6)"; exit 1; }

if printf '%s\n' "$report" | grep -qv '^OK '; then
  echo "compose-check FAILED: a service in docker-compose.yml does not cap its log (W-8)"
  exit 1
fi
echo "logging ok: all $count services are ${WANT_DRIVER}, max-size ${WANT_MAX_SIZE}, max-file ${WANT_MAX_FILE}"
