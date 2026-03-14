#!/usr/bin/env bash
set -euo pipefail
# This test should be run with P2P client, please refer to the test-p2p-three-nodes-conflict-linux.sh test for more details.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
VERBOSE_TEST_LOGGING="${VERBOSE_TEST_LOGGING:-0}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-0}"

RELAY="${RELAY:-ws://localhost:4000/}"
USE_INTERNAL_RELAY="${USE_INTERNAL_RELAY:-1}"
ROOM_ID="${ROOM_ID:-1}"
PASSPHRASE="${PASSPHRASE:-test}"
APP_ID="${APP_ID:-self-hosted-livesync-cli-tests}"

cli_test_init_cli_cmd

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-p2p-host.XXXXXX")"
VAULT="$WORK_DIR/vault-host"
SETTINGS="$WORK_DIR/settings-host.json"
mkdir -p "$VAULT"

cleanup() {
    local exit_code=$?
    if [[ "${P2P_RELAY_STARTED:-0}" == "1" ]]; then
        cli_test_stop_p2p_relay
    fi

    if [[ "$KEEP_TEST_DATA" != "1" ]]; then
        rm -rf "$WORK_DIR"
    else
        echo "[INFO] KEEP_TEST_DATA=1, preserving artefacts at $WORK_DIR"
    fi
    exit "$exit_code"
}
trap cleanup EXIT

if [[ "$USE_INTERNAL_RELAY" == "1" ]]; then
    if cli_test_is_local_p2p_relay "$RELAY"; then
        cli_test_start_p2p_relay
        P2P_RELAY_STARTED=1
    else
        echo "[INFO] USE_INTERNAL_RELAY=1 but RELAY is not local ($RELAY), skipping local relay startup"
    fi
fi

echo "[INFO] preparing settings"
echo "[INFO] relay=$RELAY room=$ROOM_ID app=$APP_ID"
cli_test_init_settings_file "$SETTINGS"
cli_test_apply_p2p_settings "$SETTINGS" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY"

echo "[CASE] start p2p-host"
echo "[INFO] press Ctrl+C to stop"
run_cli "$VAULT" --settings "$SETTINGS" p2p-host
