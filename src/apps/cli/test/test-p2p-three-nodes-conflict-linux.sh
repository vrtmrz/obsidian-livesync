#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-0}"
VERBOSE_TEST_LOGGING="${VERBOSE_TEST_LOGGING:-0}"

RELAY="${RELAY:-ws://localhost:4000/}"
USE_INTERNAL_RELAY="${USE_INTERNAL_RELAY:-1}"
ROOM_ID_PREFIX="${ROOM_ID_PREFIX:-p2p-room}"
PASSPHRASE_PREFIX="${PASSPHRASE_PREFIX:-p2p-pass}"
APP_ID="${APP_ID:-self-hosted-livesync-cli-tests}"
PEERS_TIMEOUT="${PEERS_TIMEOUT:-10}"
SYNC_TIMEOUT="${SYNC_TIMEOUT:-15}"

ROOM_ID="${ROOM_ID_PREFIX}-$(date +%s)-$RANDOM-$RANDOM"
PASSPHRASE="${PASSPHRASE_PREFIX}-$(date +%s)-$RANDOM-$RANDOM"

cli_test_init_cli_cmd

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-p2p-3nodes.XXXXXX")"
VAULT_A="$WORK_DIR/vault-a"
VAULT_B="$WORK_DIR/vault-b"
VAULT_C="$WORK_DIR/vault-c"
SETTINGS_A="$WORK_DIR/settings-a.json"
SETTINGS_B="$WORK_DIR/settings-b.json"
SETTINGS_C="$WORK_DIR/settings-c.json"
HOST_LOG="$WORK_DIR/p2p-host.log"

mkdir -p "$VAULT_A" "$VAULT_B" "$VAULT_C"

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

run_cli_a() {
    run_cli "$VAULT_A" --settings "$SETTINGS_A" "$@"
}

run_cli_b() {
    run_cli "$VAULT_B" --settings "$SETTINGS_B" "$@"
}

run_cli_c() {
    run_cli "$VAULT_C" --settings "$SETTINGS_C" "$@"
}

echo "[INFO] preparing settings"
echo "[INFO] relay=$RELAY room=$ROOM_ID app=$APP_ID"
cli_test_init_settings_file "$SETTINGS_A"
cli_test_init_settings_file "$SETTINGS_B"
cli_test_init_settings_file "$SETTINGS_C"
cli_test_apply_p2p_settings "$SETTINGS_A" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY"
cli_test_apply_p2p_settings "$SETTINGS_B" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY"
cli_test_apply_p2p_settings "$SETTINGS_C" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY"

echo "[CASE] start p2p-host on A"
run_cli_a p2p-host >"$HOST_LOG" 2>&1 &
HOST_PID=$!

for _ in 1 2 3 4 5 6 7 8 9 10; do
    echo "[INFO] waiting for p2p-host to start..."
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

echo "[CASE] discover host peer from B"
PEERS_FROM_B="$(run_cli_b p2p-peers "$PEERS_TIMEOUT")"
HOST_PEER_ID="$(awk -F $'\t' 'NF>=3 && $1=="[peer]" {print $2; exit}' <<< "$PEERS_FROM_B")"
if [[ -z "$HOST_PEER_ID" ]]; then
    echo "[FAIL] B could not find host peer" >&2
    echo "$PEERS_FROM_B" >&2
    exit 1
fi
echo "[PASS] B discovered host peer: $HOST_PEER_ID"

echo "[CASE] discover host peer from C"
PEERS_FROM_C="$(run_cli_c p2p-peers "$PEERS_TIMEOUT")"
HOST_PEER_ID_FROM_C="$(awk -F $'\t' 'NF>=3 && $1=="[peer]" {print $2; exit}' <<< "$PEERS_FROM_C")"
if [[ -z "$HOST_PEER_ID_FROM_C" ]]; then
    echo "[FAIL] C could not find host peer" >&2
    echo "$PEERS_FROM_C" >&2
    exit 1
fi
echo "[PASS] C discovered host peer: $HOST_PEER_ID_FROM_C"

TARGET_PATH="p2p/conflicted-from-two-clients.txt"

echo "[CASE] B creates file and syncs"
printf 'from-client-b-v1\n' | run_cli_b put "$TARGET_PATH" >/dev/null
run_cli_b p2p-sync "$HOST_PEER_ID" "$SYNC_TIMEOUT" >/dev/null

echo "[CASE] C syncs and can see B file"
run_cli_c p2p-sync "$HOST_PEER_ID_FROM_C" "$SYNC_TIMEOUT" >/dev/null
VISIBLE_ON_C=""
for _ in 1 2 3 4 5; do
    if VISIBLE_ON_C="$(run_cli_c cat "$TARGET_PATH" 2>/dev/null | cli_test_sanitise_cat_stdout)"; then
        if [[ "$VISIBLE_ON_C" == "from-client-b-v1" ]]; then
            break
        fi
    fi
    run_cli_c p2p-sync "$HOST_PEER_ID_FROM_C" "$SYNC_TIMEOUT" >/dev/null
    sleep 1
done
cli_test_assert_equal "from-client-b-v1" "$VISIBLE_ON_C" "C should see file created by B"

echo "[CASE] B and C modify file independently"
printf 'from-client-b-v2\n' | run_cli_b put "$TARGET_PATH" >/dev/null
printf 'from-client-c-v2\n' | run_cli_c put "$TARGET_PATH" >/dev/null

echo "[CASE] B and C sync to host concurrently"
set +e
run_cli_b p2p-sync "$HOST_PEER_ID" "$SYNC_TIMEOUT" >/dev/null &
SYNC_B_PID=$!
run_cli_c p2p-sync "$HOST_PEER_ID_FROM_C" "$SYNC_TIMEOUT" >/dev/null &
SYNC_C_PID=$!
wait "$SYNC_B_PID"
SYNC_B_EXIT=$?
wait "$SYNC_C_PID"
SYNC_C_EXIT=$?
set -e
if [[ "$SYNC_B_EXIT" -ne 0 || "$SYNC_C_EXIT" -ne 0 ]]; then
    echo "[FAIL] concurrent sync failed: B=$SYNC_B_EXIT C=$SYNC_C_EXIT" >&2
    exit 1
fi

echo "[CASE] sync back to clients"
run_cli_b p2p-sync "$HOST_PEER_ID" "$SYNC_TIMEOUT" >/dev/null
run_cli_c p2p-sync "$HOST_PEER_ID_FROM_C" "$SYNC_TIMEOUT" >/dev/null

echo "[CASE] B info shows conflict"
INFO_JSON_B_BEFORE="$(run_cli_b info "$TARGET_PATH")"
CONFLICTS_B_BEFORE="$(printf '%s' "$INFO_JSON_B_BEFORE" | cli_test_json_string_field_from_stdin conflicts)"
KEEP_REV_B="$(printf '%s' "$INFO_JSON_B_BEFORE" | cli_test_json_string_field_from_stdin revision)"
if [[ "$CONFLICTS_B_BEFORE" == "N/A" || -z "$CONFLICTS_B_BEFORE" ]]; then
    echo "[FAIL] expected conflicts on B after two-client sync" >&2
    echo "$INFO_JSON_B_BEFORE" >&2
    exit 1
fi
if [[ -z "$KEEP_REV_B" ]]; then
    echo "[FAIL] could not read current revision on B for resolve" >&2
    echo "$INFO_JSON_B_BEFORE" >&2
    exit 1
fi
echo "[PASS] conflict detected on B"

echo "[CASE] C info shows conflict"
INFO_JSON_C_BEFORE="$(run_cli_c info "$TARGET_PATH")"
CONFLICTS_C_BEFORE="$(printf '%s' "$INFO_JSON_C_BEFORE" | cli_test_json_string_field_from_stdin conflicts)"
KEEP_REV_C="$(printf '%s' "$INFO_JSON_C_BEFORE" | cli_test_json_string_field_from_stdin revision)"
if [[ "$CONFLICTS_C_BEFORE" == "N/A" || -z "$CONFLICTS_C_BEFORE" ]]; then
    echo "[FAIL] expected conflicts on C after two-client sync" >&2
    echo "$INFO_JSON_C_BEFORE" >&2
    exit 1
fi
if [[ -z "$KEEP_REV_C" ]]; then
    echo "[FAIL] could not read current revision on C for resolve" >&2
    echo "$INFO_JSON_C_BEFORE" >&2
    exit 1
fi
echo "[PASS] conflict detected on C"

echo "[CASE] resolve conflict on B and C"
run_cli_b resolve "$TARGET_PATH" "$KEEP_REV_B" >/dev/null
run_cli_c resolve "$TARGET_PATH" "$KEEP_REV_C" >/dev/null

INFO_JSON_B_AFTER="$(run_cli_b info "$TARGET_PATH")"
CONFLICTS_B_AFTER="$(printf '%s' "$INFO_JSON_B_AFTER" | cli_test_json_string_field_from_stdin conflicts)"
if [[ "$CONFLICTS_B_AFTER" != "N/A" ]]; then
    echo "[FAIL] conflict still remains on B after resolve" >&2
    echo "$INFO_JSON_B_AFTER" >&2
    exit 1
fi

INFO_JSON_C_AFTER="$(run_cli_c info "$TARGET_PATH")"
CONFLICTS_C_AFTER="$(printf '%s' "$INFO_JSON_C_AFTER" | cli_test_json_string_field_from_stdin conflicts)"
if [[ "$CONFLICTS_C_AFTER" != "N/A" ]]; then
    echo "[FAIL] conflict still remains on C after resolve" >&2
    echo "$INFO_JSON_C_AFTER" >&2
    exit 1
fi

FINAL_CONTENT_B="$(run_cli_b cat "$TARGET_PATH" | cli_test_sanitise_cat_stdout)"
FINAL_CONTENT_C="$(run_cli_c cat "$TARGET_PATH" | cli_test_sanitise_cat_stdout)"
if [[ "$FINAL_CONTENT_B" != "from-client-b-v2" && "$FINAL_CONTENT_B" != "from-client-c-v2" ]]; then
    echo "[FAIL] unexpected final content on B after resolve" >&2
    echo "[FAIL] final content on B: $FINAL_CONTENT_B" >&2
    exit 1
fi
if [[ "$FINAL_CONTENT_C" != "from-client-b-v2" && "$FINAL_CONTENT_C" != "from-client-c-v2" ]]; then
    echo "[FAIL] unexpected final content on C after resolve" >&2
    echo "[FAIL] final content on C: $FINAL_CONTENT_C" >&2
    exit 1
fi

echo "[PASS] conflicts resolved on B and C"
echo "[PASS] all 3-node P2P conflict scenarios passed"
