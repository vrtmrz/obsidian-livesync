#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-1}"
VERBOSE_TEST_LOGGING="${VERBOSE_TEST_LOGGING:-0}"

RELAY="${RELAY:-ws://localhost:4000/}"
USE_INTERNAL_RELAY="${USE_INTERNAL_RELAY:-1}"
APP_ID="${APP_ID:-self-hosted-livesync-cli-tests}"
PEERS_TIMEOUT="${PEERS_TIMEOUT:-20}"
SYNC_TIMEOUT="${SYNC_TIMEOUT:-240}"

ROOM_ID="p2p-room-$(date +%s)-$RANDOM-$RANDOM"
PASSPHRASE="p2p-pass-$(date +%s)-$RANDOM-$RANDOM"

HOST_PEER_NAME="p2p-cli-host"
UPLOAD_PEER_NAME="p2p-cli-upload-$(date +%s)-$RANDOM"
DOWNLOAD_PEER_NAME="p2p-cli-download-$(date +%s)-$RANDOM"

cli_test_init_cli_cmd

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-p2p-upload-download.XXXXXX")"
VAULT_HOST="$WORK_DIR/vault-host"
VAULT_UP="$WORK_DIR/vault-up"
VAULT_DOWN="$WORK_DIR/vault-down"
SETTINGS_HOST="$WORK_DIR/settings-host.json"
SETTINGS_UP="$WORK_DIR/settings-up.json"
SETTINGS_DOWN="$WORK_DIR/settings-down.json"
HOST_LOG="$WORK_DIR/p2p-host.log"
mkdir -p "$VAULT_HOST" "$VAULT_UP" "$VAULT_DOWN"

cleanup() {
    local exit_code=$?
    if [[ -n "${HOST_PID:-}" ]] && kill -0 "$HOST_PID" >/dev/null 2>&1; then
        kill -TERM "$HOST_PID" >/dev/null 2>&1 || true
        wait "$HOST_PID" >/dev/null 2>&1 || true
    fi
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

run_cli_host() {
    run_cli "$VAULT_HOST" --settings "$SETTINGS_HOST" "$@"
}

run_cli_up() {
    run_cli "$VAULT_UP" --settings "$SETTINGS_UP" "$@"
}

run_cli_down() {
    run_cli "$VAULT_DOWN" --settings "$SETTINGS_DOWN" "$@"
}

apply_p2p_test_tweaks() {
    local settings_file="$1"
    local device_name="$2"
    SETTINGS_FILE="$settings_file" DEVICE_NAME="$device_name" PASSPHRASE_VAL="$PASSPHRASE" node <<'NODE'
const fs = require("node:fs");
const settingsPath = process.env.SETTINGS_FILE;
const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

data.remoteType = "ONLY_P2P";
data.encrypt = true;
data.passphrase = process.env.PASSPHRASE_VAL;
data.usePathObfuscation = true;
data.handleFilenameCaseSensitive = false;
data.customChunkSize = 50;
data.usePluginSyncV2 = true;
data.doNotUseFixedRevisionForChunks = false;
data.P2P_DevicePeerName = process.env.DEVICE_NAME;
data.isConfigured = true;

fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
NODE
}

discover_peer_id() {
    local side="$1"
    local output
    local peer_id
    if [[ "$side" == "up" ]]; then
        output="$(run_cli_up p2p-peers "$PEERS_TIMEOUT")"
    else
        output="$(run_cli_down p2p-peers "$PEERS_TIMEOUT")"
    fi
    peer_id="$(awk -F $'\t' 'NF>=3 && $1=="[peer]" {print $2; exit}' <<< "$output")"
    if [[ -z "$peer_id" ]]; then
        echo "[FAIL] ${side} could not discover any peer" >&2
        echo "[FAIL] peers output:" >&2
        echo "$output" >&2
        return 1
    fi
    echo "$peer_id"
}

echo "[INFO] preparing settings"
echo "[INFO] relay=$RELAY room=$ROOM_ID app=$APP_ID"
cli_test_init_settings_file "$SETTINGS_HOST"
cli_test_init_settings_file "$SETTINGS_UP"
cli_test_init_settings_file "$SETTINGS_DOWN"
cli_test_apply_p2p_settings "$SETTINGS_HOST" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY" "~.*"
cli_test_apply_p2p_settings "$SETTINGS_UP" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY" "~.*"
cli_test_apply_p2p_settings "$SETTINGS_DOWN" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY" "~.*"
apply_p2p_test_tweaks "$SETTINGS_HOST" "$HOST_PEER_NAME"
apply_p2p_test_tweaks "$SETTINGS_UP" "$UPLOAD_PEER_NAME"
apply_p2p_test_tweaks "$SETTINGS_DOWN" "$DOWNLOAD_PEER_NAME"

echo "[CASE] start p2p-host"
run_cli_host p2p-host >"$HOST_LOG" 2>&1 &
HOST_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if grep -Fq "P2P host is running" "$HOST_LOG"; then
        break
    fi
    sleep 1
done
if ! grep -Fq "P2P host is running" "$HOST_LOG"; then
    echo "[FAIL] p2p-host did not become ready" >&2
    cat "$HOST_LOG" >&2
    exit 1
fi
echo "[PASS] p2p-host started"

echo "[CASE] upload peer discovers host"
HOST_PEER_ID_FOR_UP="$(discover_peer_id up)"
echo "[PASS] upload peer discovered host: $HOST_PEER_ID_FOR_UP"

echo "[CASE] upload phase writes source files"
STORE_TEXT="$WORK_DIR/store-file.md"
DIFF_A_TEXT="$WORK_DIR/test-diff-1.md"
DIFF_B_TEXT="$WORK_DIR/test-diff-2.md"
DIFF_C_TEXT="$WORK_DIR/test-diff-3.md"
printf 'Hello, World!\n' > "$STORE_TEXT"
printf 'Content A\n' > "$DIFF_A_TEXT"
printf 'Content B\n' > "$DIFF_B_TEXT"
printf 'Content C\n' > "$DIFF_C_TEXT"
run_cli_up push "$STORE_TEXT" p2p/store-file.md >/dev/null
run_cli_up push "$DIFF_A_TEXT" p2p/test-diff-1.md >/dev/null
run_cli_up push "$DIFF_B_TEXT" p2p/test-diff-2.md >/dev/null
run_cli_up push "$DIFF_C_TEXT" p2p/test-diff-3.md >/dev/null

LARGE_TXT_100K="$WORK_DIR/large-100k.txt"
LARGE_TXT_1M="$WORK_DIR/large-1m.txt"
head -c 100000 /dev/zero | tr '\0' 'a' > "$LARGE_TXT_100K"
head -c 1000000 /dev/zero | tr '\0' 'b' > "$LARGE_TXT_1M"
run_cli_up push "$LARGE_TXT_100K" p2p/large-100000.md >/dev/null
run_cli_up push "$LARGE_TXT_1M" p2p/large-1000000.md >/dev/null

BINARY_100K="$WORK_DIR/binary-100k.bin"
BINARY_5M="$WORK_DIR/binary-5m.bin"
head -c 100000 /dev/urandom > "$BINARY_100K"
head -c 5000000 /dev/urandom > "$BINARY_5M"
run_cli_up push "$BINARY_100K" p2p/binary-100000.bin >/dev/null
run_cli_up push "$BINARY_5M" p2p/binary-5000000.bin >/dev/null
echo "[PASS] upload source files prepared"

echo "[CASE] upload phase syncs to host"
run_cli_up p2p-sync "$HOST_PEER_ID_FOR_UP" "$SYNC_TIMEOUT" >/dev/null
run_cli_up p2p-sync "$HOST_PEER_ID_FOR_UP" "$SYNC_TIMEOUT" >/dev/null
echo "[PASS] upload phase synced"

echo "[CASE] download peer discovers host"
HOST_PEER_ID_FOR_DOWN="$(discover_peer_id down)"
echo "[PASS] download peer discovered host: $HOST_PEER_ID_FOR_DOWN"

echo "[CASE] download phase syncs from host"
run_cli_down p2p-sync "$HOST_PEER_ID_FOR_DOWN" "$SYNC_TIMEOUT" >/dev/null
run_cli_down p2p-sync "$HOST_PEER_ID_FOR_DOWN" "$SYNC_TIMEOUT" >/dev/null
echo "[PASS] download phase synced"

echo "[CASE] verify text files on download peer"
DOWN_STORE_TEXT="$WORK_DIR/down-store-file.md"
DOWN_DIFF_A_TEXT="$WORK_DIR/down-test-diff-1.md"
DOWN_DIFF_B_TEXT="$WORK_DIR/down-test-diff-2.md"
DOWN_DIFF_C_TEXT="$WORK_DIR/down-test-diff-3.md"
run_cli_down pull p2p/store-file.md "$DOWN_STORE_TEXT" >/dev/null
run_cli_down pull p2p/test-diff-1.md "$DOWN_DIFF_A_TEXT" >/dev/null
run_cli_down pull p2p/test-diff-2.md "$DOWN_DIFF_B_TEXT" >/dev/null
run_cli_down pull p2p/test-diff-3.md "$DOWN_DIFF_C_TEXT" >/dev/null
cmp -s "$STORE_TEXT" "$DOWN_STORE_TEXT" || { echo "[FAIL] store-file mismatch" >&2; exit 1; }
cmp -s "$DIFF_A_TEXT" "$DOWN_DIFF_A_TEXT" || { echo "[FAIL] test-diff-1 mismatch" >&2; exit 1; }
cmp -s "$DIFF_B_TEXT" "$DOWN_DIFF_B_TEXT" || { echo "[FAIL] test-diff-2 mismatch" >&2; exit 1; }
cmp -s "$DIFF_C_TEXT" "$DOWN_DIFF_C_TEXT" || { echo "[FAIL] test-diff-3 mismatch" >&2; exit 1; }

echo "[CASE] verify pushed files on download peer"
DOWN_LARGE_100K="$WORK_DIR/down-large-100k.txt"
DOWN_LARGE_1M="$WORK_DIR/down-large-1m.txt"
DOWN_BINARY_100K="$WORK_DIR/down-binary-100k.bin"
DOWN_BINARY_5M="$WORK_DIR/down-binary-5m.bin"
run_cli_down pull p2p/large-100000.md "$DOWN_LARGE_100K" >/dev/null
run_cli_down pull p2p/large-1000000.md "$DOWN_LARGE_1M" >/dev/null
run_cli_down pull p2p/binary-100000.bin "$DOWN_BINARY_100K" >/dev/null
run_cli_down pull p2p/binary-5000000.bin "$DOWN_BINARY_5M" >/dev/null
cmp -s "$LARGE_TXT_100K" "$DOWN_LARGE_100K" || { echo "[FAIL] large-100000 mismatch" >&2; exit 1; }
cmp -s "$LARGE_TXT_1M" "$DOWN_LARGE_1M" || { echo "[FAIL] large-1000000 mismatch" >&2; exit 1; }
cmp -s "$BINARY_100K" "$DOWN_BINARY_100K" || { echo "[FAIL] binary-100000 mismatch" >&2; exit 1; }
cmp -s "$BINARY_5M" "$DOWN_BINARY_5M" || { echo "[FAIL] binary-5000000 mismatch" >&2; exit 1; }

echo "[PASS] CLI P2P upload/download reproduction scenario completed"
