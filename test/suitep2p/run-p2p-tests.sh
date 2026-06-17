#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
CLI_DIR="$REPO_ROOT/src/apps/cli"
CLI_TEST_HELPERS="$CLI_DIR/test/test-helpers.sh"

source "$CLI_TEST_HELPERS"

RUN_BUILD="${RUN_BUILD:-1}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-1}"
VERBOSE_TEST_LOGGING="${VERBOSE_TEST_LOGGING:-1}"

RELAY="${RELAY:-ws://localhost:4000/}"
USE_INTERNAL_RELAY="${USE_INTERNAL_RELAY:-1}"
APP_ID="${APP_ID:-self-hosted-livesync-vitest-p2p}"
HOST_PEER_NAME="${HOST_PEER_NAME:-p2p-cli-host}"

ROOM_ID="p2p-room-$(date +%s)-$RANDOM-$RANDOM"
PASSPHRASE="p2p-pass-$(date +%s)-$RANDOM-$RANDOM"
UPLOAD_PEER_NAME="p2p-upload-$(date +%s)-$RANDOM"
DOWNLOAD_PEER_NAME="p2p-download-$(date +%s)-$RANDOM"
UPLOAD_VAULT_NAME="TestVaultUpload-$(date +%s)-$RANDOM"
DOWNLOAD_VAULT_NAME="TestVaultDownload-$(date +%s)-$RANDOM"

# ---- Build CLI ----
if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    (cd "$CLI_DIR" && npm run build)
fi

# ---- Temp directory ----
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-vitest-p2p.XXXXXX")"
VAULT_HOST="$WORK_DIR/vault-host"
SETTINGS_HOST="$WORK_DIR/settings-host.json"
HOST_LOG="$WORK_DIR/p2p-host.log"
# Handoff file: upload phase writes this; download phase reads it.
HANDOFF_FILE="$WORK_DIR/p2p-test-handoff.json"
mkdir -p "$VAULT_HOST"

# ---- Setup CLI command (uses npm run cli from CLI_DIR) ----
# Override run_cli to invoke the built binary directly from CLI_DIR
run_cli() {
    (cd "$CLI_DIR" && node dist/index.cjs "$@")
}

# ---- Create host settings ----
echo "[INFO] relay=$RELAY room=$ROOM_ID app=$APP_ID host=$HOST_PEER_NAME"
cli_test_init_settings_file "$SETTINGS_HOST"
cli_test_apply_p2p_settings "$SETTINGS_HOST" "$ROOM_ID" "$PASSPHRASE" "$APP_ID" "$RELAY" "~.*"

# Set host peer name
SETTINGS_HOST_FILE="$SETTINGS_HOST" HOST_PEER_NAME_VAL="$HOST_PEER_NAME" HOST_PASSPHRASE_VAL="$PASSPHRASE" node <<'NODE'
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.env.SETTINGS_HOST_FILE, "utf-8"));

// Keep tweak values aligned with browser-side P2P test settings.
data.remoteType = "ONLY_P2P";
data.encrypt = true;
data.passphrase = process.env.HOST_PASSPHRASE_VAL;
data.usePathObfuscation = true;
data.handleFilenameCaseSensitive = false;
data.customChunkSize = 50;
data.usePluginSyncV2 = true;
data.doNotUseFixedRevisionForChunks = false;

data.P2P_DevicePeerName = process.env.HOST_PEER_NAME_VAL;
fs.writeFileSync(process.env.SETTINGS_HOST_FILE, JSON.stringify(data, null, 2), "utf-8");
NODE

# ---- Cleanup trap ----
cleanup() {
    local exit_code=$?
    if [[ -n "${HOST_PID:-}" ]] && kill -0 "$HOST_PID" >/dev/null 2>&1; then
        echo "[INFO] stopping CLI host (PID=$HOST_PID)"
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

start_host() {
    local attempt=0
    while [[ "$attempt" -lt 5 ]]; do
        attempt=$((attempt + 1))
        echo "[INFO] starting CLI p2p-host (attempt $attempt/5)"
        : >"$HOST_LOG"
        (cd "$CLI_DIR" && node dist/index.cjs "$VAULT_HOST" --settings "$SETTINGS_HOST" -d p2p-host) >"$HOST_LOG" 2>&1 &
        HOST_PID=$!

        local host_ready=0
        local exited_early=0
        for i in $(seq 1 30); do
            if grep -qF "P2P host is running" "$HOST_LOG" 2>/dev/null; then
                host_ready=1
                break
            fi
            if ! kill -0 "$HOST_PID" >/dev/null 2>&1; then
                exited_early=1
                break
            fi
            echo "[INFO] waiting for p2p-host to be ready... ($i/30)"
            sleep 1
        done

        if [[ "$host_ready" == "1" ]]; then
            echo "[INFO] p2p-host is ready (PID=$HOST_PID)"
            return 0
        fi

        wait "$HOST_PID" >/dev/null 2>&1 || true
        HOST_PID=

        if grep -qF "Resource temporarily unavailable" "$HOST_LOG" 2>/dev/null; then
            echo "[INFO] p2p-host database lock is still being released, retrying..."
            sleep 2
            continue
        fi

        if [[ "$exited_early" == "1" ]]; then
            echo "[FAIL] CLI host process exited unexpectedly" >&2
        else
            echo "[FAIL] p2p-host did not become ready within 30 seconds" >&2
        fi
        cat "$HOST_LOG" >&2
        exit 1
    done

    echo "[FAIL] p2p-host could not be restarted after multiple attempts" >&2
    cat "$HOST_LOG" >&2
    exit 1
}

# ---- Start local relay if needed ----
if [[ "$USE_INTERNAL_RELAY" == "1" ]]; then
    if cli_test_is_local_p2p_relay "$RELAY"; then
        cli_test_start_p2p_relay
        P2P_RELAY_STARTED=1
    else
        echo "[INFO] USE_INTERNAL_RELAY=1 but RELAY is not local ($RELAY), skipping"
    fi
fi

start_host

# Common env vars passed to both vitest runs
P2P_ENV=(
    P2P_TEST_ROOM_ID="$ROOM_ID"
    P2P_TEST_PASSPHRASE="$PASSPHRASE"
    P2P_TEST_HOST_PEER_NAME="$HOST_PEER_NAME"
    P2P_TEST_RELAY="$RELAY"
    P2P_TEST_APP_ID="$APP_ID"
    P2P_TEST_HANDOFF_FILE="$HANDOFF_FILE"
    P2P_TEST_UPLOAD_PEER_NAME="$UPLOAD_PEER_NAME"
    P2P_TEST_DOWNLOAD_PEER_NAME="$DOWNLOAD_PEER_NAME"
    P2P_TEST_UPLOAD_VAULT_NAME="$UPLOAD_VAULT_NAME"
    P2P_TEST_DOWNLOAD_VAULT_NAME="$DOWNLOAD_VAULT_NAME"
)

cd "$REPO_ROOT"

# ---- Phase 1: Upload ----
# Each vitest run gets a fresh browser process, so Trystero's module-level
# global state (occupiedRooms, didInit, etc.) is clean for every phase.
echo "[INFO] running P2P vitest — upload phase"
env "${P2P_ENV[@]}" \
    npx dotenv-cli -e .env -e .test.env -- \
    vitest run --config vitest.config.p2p.ts test/suitep2p/syncp2p.p2p-up.test.ts
echo "[INFO] upload phase completed"

# ---- Phase 2: Download ----
# Keep the same host process alive so its database handle and relay presence stay stable.
echo "[INFO] waiting 5s before download phase..."
sleep 5
echo "[INFO] running P2P vitest — download phase"
env "${P2P_ENV[@]}" \
    npx dotenv-cli -e .env -e .test.env -- \
    vitest run --config vitest.config.p2p.ts test/suitep2p/syncp2p.p2p-down.test.ts
echo "[INFO] download phase completed"

echo "[INFO] P2P vitest suite completed"
