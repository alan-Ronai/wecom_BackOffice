#!/usr/bin/env bash
# Exercises the half of `deploy/smoke.sh` that needs no stack: how it reads its argument (W-7) and
# how it reports the backup status (W-9). Both were found by an operator running the documented
# commands, and neither can be covered by the CI smoke run — that stack always passes an origin
# the workflow spells correctly, and always has the same backup state.
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

# ── W-9: the backup status a fresh install reports ────────────────────────────────────────────
# `system.backup-check` runs at API start-up, before any dump exists, so health answers
# `lastBackupOk:false, lastBackupAt:null` on a stack installed minutes ago. That is not a failure
# and must not read as one; a *stale* backup on a running pilot is a real problem and must not be
# swallowed. Both the shape health has today and the tri-state the app lane is landing are read.
# shellcheck disable=SC1091
SMOKE_LIB_ONLY=1 WECOM_E2E_RUNNER=1 . ./smoke.sh

expect_backup() { # <what> <health body> <substring the output must contain> <stream: out|err>
  local what=$1 body=$2 want=$3 stream=$4 got
  if [ "$stream" = err ]; then
    got=$(backup_check "$body" 2>&1 >/dev/null)
  else
    got=$(backup_check "$body" 2>/dev/null)
  fi
  case "$got" in
    *"$want"*) ok "$what" ;;
    *) bad "$what: $stream said '${got:-(nothing)}', expected it to contain '$want'" ;;
  esac
}

# Today's shape.
expect_backup 'a fresh install (lastBackupOk:false, lastBackupAt:null) is a note, not a failure' \
  '{"db":true,"lastBackupAt":null,"lastBackupOk":false}' 'backup: none yet' out
expect_backup 'a passing check is reported as ok' \
  '{"db":true,"lastBackupAt":"2026-09-15T02:00:00Z","lastBackupOk":true}' 'backup ok' out
expect_backup 'a dump exists and its check failed: a warning on stderr' \
  '{"db":true,"lastBackupAt":"2026-09-15T02:00:00Z","lastBackupOk":false}' 'smoke WARNING' err

# The tri-state, whichever way it is spelled.
expect_backup 'backup.status "never" is a note' \
  '{"db":true,"backup":{"status":"never","at":null}}' 'backup: none yet' out
expect_backup 'backup.status "pending" is the same note' \
  '{"db":true,"backup":{"status":"pending","at":null}}' 'backup: none yet' out
expect_backup 'backup.status "ok" is ok' \
  '{"db":true,"backup":{"status":"ok","at":"2026-09-15T02:00:00Z"}}' 'backup ok' out
expect_backup 'backup.status "stale" is a warning, not a failure' \
  '{"db":true,"backup":{"status":"stale","at":"2026-09-01T02:00:00Z"}}' 'stale' err
expect_backup 'a scalar "backup":"never" reads the same' \
  '{"db":true,"backup":"never"}' 'backup: none yet' out
# An unknown value is printed rather than guessed at, and still does not fail the run.
expect_backup 'an unrecognised status is reported, not judged' \
  '{"db":true,"backup":{"status":"quiescent"}}' 'unrecognised' out
# `status` is a common key. Reading it out of the wrong block would misreport the backup entirely.
expect_backup 'a status on another subsystem is not mistaken for the backup one' \
  '{"db":true,"queue":{"status":"stale"},"lastBackupAt":null,"lastBackupOk":false}' \
  'backup: none yet' out

[ "$fail" = 0 ] || exit 1
echo "smoke.sh ok (origin parsing, backup status)"
