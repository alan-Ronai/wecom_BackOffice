#!/usr/bin/env bash
# Exercises the half of `deploy/smoke.sh` that needs no stack: how it reads its argument (W-7).
# Found by an operator running the documented commands, and not coverable by the CI smoke run —
# that workflow always passes an origin it spells correctly.
#
# `SMOKE_LIB_ONLY=1` makes smoke.sh stop after its argument handling and its functions, so this
# calls them directly. `WECOM_E2E_RUNNER=1` because sourcing means the e2e-config refusal at the
# top of that file would `exit` this checker rather than return from it.
set -euo pipefail
cd "$(dirname "$0")"

fail=0
ok()  { echo "smoke-check ok: $1"; }
bad() { echo "smoke-check FAILED: $1" >&2; fail=1; }

# ── W-7: the argument is an origin, port included ─────────────────────────────────────────────
# The documented spelling used to be `https://<host>`, which on a deployment with WEB_HTTPS_PORT
# ≠ 443 talks to nothing and spends sixty retries saying `waiting for api`.
base_for() { # <argument…> → the $base smoke.sh settles on; a non-zero exit means it refused
  (
    export SMOKE_LIB_ONLY=1 WECOM_E2E_RUNNER=1
    # shellcheck disable=SC1091
    . ./smoke.sh "$@" 2>/dev/null
    printf '%s\n' "$base"
  )
}
expect_base() { # <what> <expected base, or FAILED if it must be refused> <argument…>
  local what=$1 want=$2 got
  shift 2
  # A refusal is an `exit 1` from the sourced file, which ends the subshell before it prints.
  got=$(base_for "$@") || got=FAILED
  if [ "$got" = "$want" ]; then ok "$what → $got"; else bad "$what: got '$got', expected '$want'"; fi
}

expect_base 'no argument defaults to https://localhost' 'https://localhost'
expect_base 'a host keeps its port' 'https://kb.wecom.local:9443' 'https://kb.wecom.local:9443'
expect_base 'http is respected' 'http://kb.wecom.local:9080' 'http://kb.wecom.local:9080'
expect_base 'a bare host:port is assumed https' 'https://kb.wecom.local:9443' 'kb.wecom.local:9443'
expect_base 'a trailing slash is dropped' 'https://kb.wecom.local:9443' 'https://kb.wecom.local:9443/'
expect_base 'an IPv4 host with a port' 'https://10.44.0.7:8443' 'https://10.44.0.7:8443'
# Refused rather than silently prefixing every request with the path — the failure would otherwise
# look exactly like a stack that is down.
expect_base 'a URL with a path is refused' 'FAILED' 'https://kb.wecom.local:9443/admin'

[ "$fail" = 0 ] || exit 1
echo "smoke.sh ok (origin parsing)"
