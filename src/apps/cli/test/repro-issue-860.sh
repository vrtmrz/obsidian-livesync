#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"

display_test_info "Test for Issue #860: Empty output from ls and mirror"

RUN_BUILD="${RUN_BUILD:-1}"
cli_test_init_cli_cmd

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-repro-860.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

SETTINGS_FILE="$WORK_DIR/data.json"
VAULT_DIR="$WORK_DIR/vault"
mkdir -p "$VAULT_DIR"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi

echo "[INFO] generating settings -> $SETTINGS_FILE"
cli_test_init_settings_file "$SETTINGS_FILE"

# 1. Test 'ls' on empty database
echo "[INFO] Testing 'ls' on empty database..."
LS_OUTPUT=$(run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" ls)
if [[ -z "$LS_OUTPUT" ]]; then
    echo "[REPRODUCED] 'ls' returned empty output for empty database."
else
    echo "[INFO] 'ls' output: $LS_OUTPUT"
fi

# 2. Test 'mirror' on empty vault
echo "[INFO] Testing 'mirror' on empty vault..."
MIRROR_OUTPUT=$(run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror 2>&1)
if [[ "$MIRROR_OUTPUT" == *"[Command] mirror"* ]] && [[ ! "$MIRROR_OUTPUT" == *"[Mirror]"* ]]; then
     # Note: currently it prints [Command] mirror to stderr.
     # Let's see if it prints anything else.
    echo "[REPRODUCED] 'mirror' produced no functional logs (only command header)."
else
    echo "[INFO] 'mirror' output: $MIRROR_OUTPUT"
fi

echo "[DONE] finished repro-860 test"
