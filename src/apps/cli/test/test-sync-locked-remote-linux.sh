#!/usr/bin/env bash
# Test: CLI sync behaviour against a locked remote database.
#
# Scenario:
#   1. Start CouchDB, create a test database, and perform an initial sync so that
#      the milestone document is created on the remote.
#   2. Unlock the milestone (locked=false, accepted_nodes=[]) and verify sync
#      succeeds without the locked error message.
#   3. Lock the milestone (locked=true, accepted_nodes=[]) and verify sync fails
#      with an actionable error message.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
TEST_ENV_FILE="${TEST_ENV_FILE:-$CLI_DIR/.test.env}"
cli_test_init_cli_cmd

if [[ ! -f "$TEST_ENV_FILE" ]]; then
    echo "[ERROR] test env file not found: $TEST_ENV_FILE" >&2
    exit 1
fi

set -a
source "$TEST_ENV_FILE"
set +a

DB_SUFFIX="$(date +%s)-$RANDOM"

COUCHDB_URI="${hostname%/}"
COUCHDB_DBNAME="${dbname}-locked-${DB_SUFFIX}"
COUCHDB_USER="${username:-}"
COUCHDB_PASSWORD="${password:-}"

if [[ -z "$COUCHDB_URI" || -z "$COUCHDB_USER" || -z "$COUCHDB_PASSWORD" ]]; then
    echo "[ERROR] COUCHDB_URI, COUCHDB_USER, COUCHDB_PASSWORD are required" >&2
    exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-locked-test.XXXXXX")"
VAULT_DIR="$WORK_DIR/vault"
SETTINGS_FILE="$WORK_DIR/settings.json"
mkdir -p "$VAULT_DIR"

cleanup() {
    local exit_code=$?
    cli_test_stop_couchdb
    rm -rf "$WORK_DIR"
    exit "$exit_code"
}
trap cleanup EXIT

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

echo "[INFO] starting CouchDB and creating test database: $COUCHDB_DBNAME"
cli_test_start_couchdb "$COUCHDB_URI" "$COUCHDB_USER" "$COUCHDB_PASSWORD" "$COUCHDB_DBNAME"

echo "[INFO] preparing settings"
cli_test_init_settings_file "$SETTINGS_FILE"
cli_test_apply_couchdb_settings "$SETTINGS_FILE" "$COUCHDB_URI" "$COUCHDB_USER" "$COUCHDB_PASSWORD" "$COUCHDB_DBNAME" 1

echo "[INFO] initial sync to create milestone document"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" sync >/dev/null

MILESTONE_ID="_local/obsydian_livesync_milestone"
MILESTONE_URL="${COUCHDB_URI}/${COUCHDB_DBNAME}/${MILESTONE_ID}"

update_milestone() {
    local locked="$1"
    local accepted_nodes="$2"
    local current
    current="$(cli_test_curl_json --user "${COUCHDB_USER}:${COUCHDB_PASSWORD}" "$MILESTONE_URL")"
    local updated
    updated="$(node -e '
const doc = JSON.parse(process.argv[1]);
doc.locked = process.argv[2] === "true";
doc.accepted_nodes = JSON.parse(process.argv[3]);
process.stdout.write(JSON.stringify(doc));
' "$current" "$locked" "$accepted_nodes")"
    cli_test_curl_json -X PUT \
        --user "${COUCHDB_USER}:${COUCHDB_PASSWORD}" \
        -H "Content-Type: application/json" \
        -d "$updated" \
        "$MILESTONE_URL" >/dev/null
}

SYNC_LOG="$WORK_DIR/sync.log"

echo "[CASE] sync should succeed when remote is not locked"
update_milestone "false" "[]"

set +e
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" sync >"$SYNC_LOG" 2>&1
SYNC_EXIT=$?
set -e

if [[ "$SYNC_EXIT" -ne 0 ]]; then
    echo "[FAIL] sync should succeed when remote is not locked" >&2
    cat "$SYNC_LOG" >&2
    exit 1
fi

if grep -Fq "The remote database is locked" "$SYNC_LOG"; then
    echo "[FAIL] locked error should not appear when remote is not locked" >&2
    cat "$SYNC_LOG" >&2
    exit 1
fi

echo "[PASS] unlocked remote DB syncs successfully"

echo "[CASE] sync should fail with actionable error when remote is locked"
update_milestone "true" "[]"

set +e
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" sync >"$SYNC_LOG" 2>&1
SYNC_EXIT=$?
set -e

if [[ "$SYNC_EXIT" -eq 0 ]]; then
    echo "[FAIL] sync should have exited with non-zero when remote is locked" >&2
    cat "$SYNC_LOG" >&2
    exit 1
fi

cli_test_assert_contains "$(cat "$SYNC_LOG")" \
    "The remote database is locked and this device is not yet accepted" \
    "sync output should contain the locked-remote error message"

echo "[PASS] locked remote DB produces actionable CLI error"
