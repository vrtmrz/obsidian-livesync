#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"

source "$SCRIPT_DIR/test-helpers.sh"

RUN_BUILD="${RUN_BUILD:-0}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-0}"
RELAY="${RELAY:-ws://localhost:7777}"
ROOM_ID="${ROOM_ID:-1}"
PASSPHRASE="${PASSPHRASE:-test}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"
DEBUG_FLAG="${DEBUG_FLAG:--d}"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-p2p-peers-local-relay.XXXXXX")"
VAULT="$WORK_DIR/vault"
SETTINGS="$WORK_DIR/settings.json"
mkdir -p "$VAULT"

cleanup() {
    local exit_code=$?
    if [[ "$KEEP_TEST_DATA" != "1" ]]; then
        rm -rf "$WORK_DIR"
    else
        echo "[INFO] KEEP_TEST_DATA=1, preserving artefacts at $WORK_DIR"
    fi
    exit "$exit_code"
}
trap cleanup EXIT

cli_test_init_cli_cmd

echo "[INFO] creating settings at $SETTINGS"
run_cli init-settings --force "$SETTINGS" >/dev/null

SETTINGS_FILE="$SETTINGS" \
P2P_ROOM_ID="$ROOM_ID" \
P2P_PASSPHRASE="$PASSPHRASE" \
P2P_RELAYS="$RELAY" \
node <<'NODE'
const fs = require("node:fs");
const settingsPath = process.env.SETTINGS_FILE;
const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

data.P2P_Enabled = true;
data.P2P_AutoStart = false;
data.P2P_AutoBroadcast = false;
data.P2P_roomID = process.env.P2P_ROOM_ID;
data.P2P_passphrase = process.env.P2P_PASSPHRASE;
data.P2P_relays = process.env.P2P_RELAYS;
data.P2P_AutoAcceptingPeers = "~.*";
data.P2P_AutoDenyingPeers = "";
data.P2P_IsHeadless = true;
data.isConfigured = true;

fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
NODE

echo "[INFO] relay=$RELAY room=$ROOM_ID timeout=${TIMEOUT_SECONDS}s"
echo "[INFO] running p2p-peers"

set +e
OUTPUT="$(run_cli "$DEBUG_FLAG" "$VAULT" --settings "$SETTINGS" p2p-peers "$TIMEOUT_SECONDS" 2>&1)"
EXIT_CODE=$?
set -e

echo "$OUTPUT"

if [[ "$EXIT_CODE" -ne 0 ]]; then
    echo "[FAIL] p2p-peers exited with code $EXIT_CODE" >&2
    exit "$EXIT_CODE"
fi

if [[ -z "$OUTPUT" ]]; then
    echo "[WARN] command completed but output was empty"
fi

echo "[PASS] p2p-peers finished"
