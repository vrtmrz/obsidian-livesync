#!/usr/bin/env bash

cli_test_init_cli_cmd() {
    if [[ "${VERBOSE_TEST_LOGGING:-0}" == "1" ]]; then
        CLI_CMD=(npm --silent run cli -- -v)
    else
        CLI_CMD=(npm --silent run cli --)
    fi
}

run_cli() {
    "${CLI_CMD[@]}" "$@"
}

cli_test_require_env() {
    local var_name="$1"
    local env_file="${2:-${TEST_ENV_FILE:-environment}}"
    if [[ -z "${!var_name:-}" ]]; then
        echo "[ERROR] required variable '$var_name' is missing in $env_file" >&2
        exit 1
    fi
}

cli_test_assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="$3"
    if ! grep -Fq "$needle" <<< "$haystack"; then
        echo "[FAIL] $message" >&2
        echo "[FAIL] expected to find: $needle" >&2
        echo "[FAIL] actual output:" >&2
        echo "$haystack" >&2
        exit 1
    fi
}

cli_test_assert_equal() {
    local expected="$1"
    local actual="$2"
    local message="$3"
    if [[ "$expected" != "$actual" ]]; then
        echo "[FAIL] $message" >&2
        echo "[FAIL] expected: $expected" >&2
        echo "[FAIL] actual:   $actual" >&2
        exit 1
    fi
}

cli_test_assert_command_fails() {
    local message="$1"
    local log_file="$2"
    shift 2
    set +e
    "$@" >"$log_file" 2>&1
    local exit_code=$?
    set -e
    if [[ "$exit_code" -eq 0 ]]; then
        echo "[FAIL] $message" >&2
        cat "$log_file" >&2
        exit 1
    fi
}

cli_test_assert_files_equal() {
    local expected_file="$1"
    local actual_file="$2"
    local message="$3"
    if ! cmp -s "$expected_file" "$actual_file"; then
        echo "[FAIL] $message" >&2
        echo "[FAIL] expected sha256: $(sha256sum "$expected_file" | awk '{print $1}')" >&2
        echo "[FAIL] actual   sha256: $(sha256sum "$actual_file" | awk '{print $1}')" >&2
        exit 1
    fi
}

cli_test_sanitise_cat_stdout() {
    sed '/^\[CLIWatchAdapter\] File watching is not enabled in CLI version$/d'
}

cli_test_json_string_field_from_stdin() {
    local field_name="$1"
    node -e '
const fs = require("node:fs");
const fieldName = process.argv[1];
const data = JSON.parse(fs.readFileSync(0, "utf-8"));
const value = data[fieldName];
if (typeof value === "string") {
    process.stdout.write(value);
}
' "$field_name"
}

cli_test_json_string_field_from_file() {
    local json_file="$1"
    local field_name="$2"
    node -e '
const fs = require("node:fs");
const jsonFile = process.argv[1];
const fieldName = process.argv[2];
const data = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
const value = data[fieldName];
if (typeof value === "string") {
    process.stdout.write(value);
}
' "$json_file" "$field_name"
}

cli_test_json_field_is_na() {
    local json_file="$1"
    local field_name="$2"
    [[ "$(cli_test_json_string_field_from_file "$json_file" "$field_name")" == "N/A" ]]
}

cli_test_curl_json() {
    curl -4 -sS --fail --connect-timeout 3 --max-time 15 "$@"
}

cli_test_init_settings_file() {
    local settings_file="$1"
    run_cli init-settings --force "$settings_file" >/dev/null
}

cli_test_mark_settings_configured() {
    local settings_file="$1"
    SETTINGS_FILE="$settings_file" node <<'NODE'
const fs = require("node:fs");
const settingsPath = process.env.SETTINGS_FILE;
const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
data.isConfigured = true;
fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
NODE
}

cli_test_apply_couchdb_settings() {
    local settings_file="$1"
    local couchdb_uri="$2"
    local couchdb_user="$3"
    local couchdb_password="$4"
    local couchdb_dbname="$5"
    local live_sync="${6:-0}"
    SETTINGS_FILE="$settings_file" \
    COUCHDB_URI="$couchdb_uri" \
    COUCHDB_USER="$couchdb_user" \
    COUCHDB_PASSWORD="$couchdb_password" \
    COUCHDB_DBNAME="$couchdb_dbname" \
    LIVE_SYNC="$live_sync" \
    node <<'NODE'
const fs = require("node:fs");
const settingsPath = process.env.SETTINGS_FILE;
const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
data.couchDB_URI = process.env.COUCHDB_URI;
data.couchDB_USER = process.env.COUCHDB_USER;
data.couchDB_PASSWORD = process.env.COUCHDB_PASSWORD;
data.couchDB_DBNAME = process.env.COUCHDB_DBNAME;
if (process.env.LIVE_SYNC === "1") {
    data.liveSync = true;
    data.syncOnStart = false;
    data.syncOnSave = false;
    data.usePluginSync = false;
}
data.isConfigured = true;
fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
NODE
}

cli_test_apply_remote_sync_settings() {
    local settings_file="$1"
    SETTINGS_FILE="$settings_file" \
    REMOTE_TYPE="$REMOTE_TYPE" \
    COUCHDB_URI="$COUCHDB_URI" \
    COUCHDB_USER="${COUCHDB_USER:-}" \
    COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-}" \
    COUCHDB_DBNAME="$COUCHDB_DBNAME" \
    MINIO_ENDPOINT="${MINIO_ENDPOINT:-}" \
    MINIO_BUCKET="$MINIO_BUCKET" \
    MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-}" \
    MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-}" \
    ENCRYPT="${ENCRYPT:-0}" \
    E2E_PASSPHRASE="${E2E_PASSPHRASE:-}" \
    node <<'NODE'
const fs = require("node:fs");
const settingsPath = process.env.SETTINGS_FILE;
const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

const remoteType = process.env.REMOTE_TYPE;
if (remoteType === "COUCHDB") {
    data.remoteType = "";
    data.couchDB_URI = process.env.COUCHDB_URI;
    data.couchDB_USER = process.env.COUCHDB_USER;
    data.couchDB_PASSWORD = process.env.COUCHDB_PASSWORD;
    data.couchDB_DBNAME = process.env.COUCHDB_DBNAME;
} else if (remoteType === "MINIO") {
    data.remoteType = "MINIO";
    data.bucket = process.env.MINIO_BUCKET;
    data.endpoint = process.env.MINIO_ENDPOINT;
    data.accessKey = process.env.MINIO_ACCESS_KEY;
    data.secretKey = process.env.MINIO_SECRET_KEY;
    data.region = "auto";
    data.forcePathStyle = true;
}

data.liveSync = true;
data.syncOnStart = false;
data.syncOnSave = false;
data.usePluginSync = false;
data.encrypt = process.env.ENCRYPT === "1";
data.passphrase = data.encrypt ? process.env.E2E_PASSPHRASE : "";
data.isConfigured = true;

fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
NODE
}

cli_test_apply_p2p_settings() {
    local settings_file="$1"
    local room_id="$2"
    local passphrase="$3"
    local app_id="${4:-self-hosted-livesync-cli-tests}"
    local relays="${5:-ws://localhost:4000/}"
    local auto_accept="${6:-~.*}"
    SETTINGS_FILE="$settings_file" \
    P2P_ROOM_ID="$room_id" \
    P2P_PASSPHRASE="$passphrase" \
    P2P_APP_ID="$app_id" \
    P2P_RELAYS="$relays" \
    P2P_AUTO_ACCEPT="$auto_accept" \
    node <<'NODE'
const fs = require("node:fs");
const settingsPath = process.env.SETTINGS_FILE;
const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

data.P2P_Enabled = true;
data.P2P_AutoStart = false;
data.P2P_AutoBroadcast = false;
data.P2P_AppID = process.env.P2P_APP_ID;
data.P2P_roomID = process.env.P2P_ROOM_ID;
data.P2P_passphrase = process.env.P2P_PASSPHRASE;
data.P2P_relays = process.env.P2P_RELAYS;
data.P2P_AutoAcceptingPeers = process.env.P2P_AUTO_ACCEPT;
data.P2P_AutoDenyingPeers = "";
data.P2P_IsHeadless = true;
data.isConfigured = true;

fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
NODE
}

cli_test_is_local_p2p_relay() {
    local relay_url="$1"
    [[ "$relay_url" == "ws://localhost:4000" || "$relay_url" == "ws://localhost:4000/" ]]
}

cli_test_stop_p2p_relay() {
    bash "$CLI_DIR/util/p2p-stop.sh" >/dev/null 2>&1 || true
}

cli_test_start_p2p_relay() {
    echo "[INFO] stopping leftover P2P relay container if present"
    cli_test_stop_p2p_relay

    echo "[INFO] starting local P2P relay container"
    bash "$CLI_DIR/util/p2p-start.sh"
}

cli_test_stop_couchdb() {
    bash "$CLI_DIR/util/couchdb-stop.sh" >/dev/null 2>&1 || true
}

cli_test_start_couchdb() {
    local couchdb_uri="$1"
    local couchdb_user="$2"
    local couchdb_password="$3"
    local couchdb_dbname="$4"
    echo "[INFO] stopping leftover CouchDB container if present"
    cli_test_stop_couchdb

    echo "[INFO] starting CouchDB test container"
    bash "$CLI_DIR/util/couchdb-start.sh"

    echo "[INFO] initialising CouchDB test container"
    bash "$CLI_DIR/util/couchdb-init.sh"

    echo "[INFO] CouchDB create test database: $couchdb_dbname"
    until (cli_test_curl_json -X PUT --user "${couchdb_user}:${couchdb_password}" "${couchdb_uri}/${couchdb_dbname}"); do sleep 5; done
}

cli_test_stop_minio() {
    bash "$CLI_DIR/util/minio-stop.sh" >/dev/null 2>&1 || true
}

cli_test_wait_for_minio_bucket() {
    local minio_endpoint="$1"
    local minio_access_key="$2"
    local minio_secret_key="$3"
    local minio_bucket="$4"
    local retries=30
    local delay_sec=2
    local i
    for ((i = 1; i <= retries; i++)); do
        if docker run --rm --network host --entrypoint=/bin/sh minio/mc -c "mc alias set myminio $minio_endpoint $minio_access_key $minio_secret_key >/dev/null 2>&1 && mc ls myminio/$minio_bucket >/dev/null 2>&1"; then
            return 0
        fi
        bucketName="$minio_bucket" bash "$CLI_DIR/util/minio-init.sh" >/dev/null 2>&1 || true
        sleep "$delay_sec"
    done
    return 1
}

cli_test_start_minio() {
    local minio_endpoint="$1"
    local minio_access_key="$2"
    local minio_secret_key="$3"
    local minio_bucket="$4"
    local minio_init_ok=0

    echo "[INFO] stopping leftover MinIO container if present"
    cli_test_stop_minio

    echo "[INFO] starting MinIO test container"
    bucketName="$minio_bucket" bash "$CLI_DIR/util/minio-start.sh"

    echo "[INFO] initialising MinIO test bucket: $minio_bucket"
    for _ in 1 2 3 4 5; do
        if bucketName="$minio_bucket" bash "$CLI_DIR/util/minio-init.sh"; then
            minio_init_ok=1
            break
        fi
        sleep 2
    done
    if [[ "$minio_init_ok" != "1" ]]; then
        echo "[FAIL] could not initialise MinIO bucket after retries: $minio_bucket" >&2
        exit 1
    fi
    if ! cli_test_wait_for_minio_bucket "$minio_endpoint" "$minio_access_key" "$minio_secret_key" "$minio_bucket"; then
        echo "[FAIL] MinIO bucket not ready: $minio_bucket" >&2
        exit 1
    fi
}

display_test_info(){
    echo "======================"
    echo "Script: ${BASH_SOURCE[1]:-$0}"
    echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Git commit: $(git -C "$SCRIPT_DIR/.." rev-parse --short HEAD 2>/dev/null || echo "N/A")"
    echo "======================"
}