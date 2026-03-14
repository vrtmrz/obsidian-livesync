#!/usr/bin/env bash
# This test should be run with P2P client, please refer to the test-p2p-three-nodes-conflict-linux.sh test for more details.

set -euo pipefail

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
PEERS_TIMEOUT="${PEERS_TIMEOUT:-12}"
SYNC_TIMEOUT="${SYNC_TIMEOUT:-15}"
TARGET_PEER="${TARGET_PEER:-}"

cli_test_init_cli_cmd

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-p2p-sync.XXXXXX")"
VAULT="$WORK_DIR/vault-sync"
SETTINGS="$WORK_DIR/settings-sync.json"
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

echo "[CASE] discover peers"
PEER_LINES="$(run_cli "$VAULT" --settings "$SETTINGS" p2p-peers "$PEERS_TIMEOUT")"
if [[ -z "$PEER_LINES" ]]; then
    echo "[FAIL] p2p-peers returned empty output" >&2
    exit 1
fi

if ! awk -F $'\t' 'NF>=3 && $1=="[peer]" { found=1 } END { exit(found ? 0 : 1) }' <<< "$PEER_LINES"; then
    echo "[FAIL] p2p-peers output must include [peer]<TAB><peer-id><TAB><peer-name>" >&2
    echo "$PEER_LINES" >&2
    exit 1
fi

SELECTED_PEER_ID=""
SELECTED_PEER_NAME=""

if [[ -n "$TARGET_PEER" ]]; then
    while IFS=$'\t' read -r marker peer_id peer_name _; do
        if [[ "$marker" != "[peer]" ]]; then
            continue
        fi
        if [[ "$peer_id" == "$TARGET_PEER" || "$peer_name" == "$TARGET_PEER" ]]; then
            SELECTED_PEER_ID="$peer_id"
            SELECTED_PEER_NAME="$peer_name"
            break
        fi
    done <<< "$PEER_LINES"

    if [[ -z "$SELECTED_PEER_ID" ]]; then
        echo "[FAIL] TARGET_PEER=$TARGET_PEER was not found" >&2
        echo "$PEER_LINES" >&2
        exit 1
    fi
else
    SELECTED_PEER_ID="$(awk -F $'\t' 'NF>=3 && $1=="[peer]" {print $2; exit}' <<< "$PEER_LINES")"
    SELECTED_PEER_NAME="$(awk -F $'\t' 'NF>=3 && $1=="[peer]" {print $3; exit}' <<< "$PEER_LINES")"
fi

if [[ -z "$SELECTED_PEER_ID" ]]; then
    echo "[FAIL] could not extract peer-id from p2p-peers output" >&2
    echo "$PEER_LINES" >&2
    exit 1
fi

echo "[PASS] selected peer: ${SELECTED_PEER_ID} (${SELECTED_PEER_NAME:-unknown})"

echo "[CASE] run p2p-sync"
run_cli "$VAULT" --settings "$SETTINGS" p2p-sync "$SELECTED_PEER_ID" "$SYNC_TIMEOUT" >/dev/null

echo "[PASS] p2p-sync completed"
