#!/usr/bin/env bash
# Test: CLI remote management commands: remote-status, unlock-remote, and mark-resolved.
#
# Scenario:
#   1. Start CouchDB, create a test database, and perform an initial sync.
#   2. Run remote-status and assert that the output contains the database name in JSON format.
#   3. Lock the remote database milestone manually using curl, verify status, and run unlock-remote.
#      Assert that the output of unlock-remote contains the unlocked verification status.
#   4. Run mark-resolved and verify it succeeds.
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
COUCHDB_DBNAME="${dbname}-remotes-${DB_SUFFIX}"
COUCHDB_USER="${username:-}"
COUCHDB_PASSWORD="${password:-}"

if [[ -z "$COUCHDB_URI" || -z "$COUCHDB_USER" || -z "$COUCHDB_PASSWORD" ]]; then
    echo "[ERROR] COUCHDB_URI, COUCHDB_USER, and COUCHDB_PASSWORD are required" >&2
    exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-remote-cmds.XXXXXX")"
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
echo ".."
cli_test_apply_couchdb_settings "$SETTINGS_FILE" "$COUCHDB_URI" "$COUCHDB_USER" "$COUCHDB_PASSWORD" "$COUCHDB_DBNAME" 1
echo "..."

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

CMD_LOG="$WORK_DIR/cmd.log"

echo "[CASE] remote-status outputs valid JSON with CouchDB details"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" remote-status >"$CMD_LOG" 2>&1

cli_test_assert_contains "$(cat "$CMD_LOG")" \
    "\"db_name\": \"$COUCHDB_DBNAME\"" \
    "remote-status should return JSON containing db_name"

echo "[PASS] remote-status verified"

echo "[CASE] lock-remote locks and verifies state"
# Run lock-remote and verify output contains verification message
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" lock-remote >"$CMD_LOG" 2>&1

cli_test_assert_contains "$(cat "$CMD_LOG")" \
    "[Verification] Remote Database: LOCKED" \
    "lock-remote output should show that the remote database is locked"

echo "[PASS] lock-remote verified"

echo "[CASE] unlock-remote unlocks and verifies state"
# Manually lock milestone
update_milestone "true" "[]"

# Run unlock-remote and verify output contains verification message
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" unlock-remote >"$CMD_LOG" 2>&1

cli_test_assert_contains "$(cat "$CMD_LOG")" \
    "[Verification] Remote Database: UNLOCKED" \
    "unlock-remote output should contain verification status"

echo "[PASS] unlock-remote verified"

echo "[CASE] mark-resolved resolves and verifies state"
# Manually lock milestone
update_milestone "true" "[]"

# Run mark-resolved and verify output contains verification message
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mark-resolved >"$CMD_LOG" 2>&1

cli_test_assert_contains "$(cat "$CMD_LOG")" \
    "[Verification] Remote Database: LOCKED" \
    "mark-resolved output should show that the remote database remains locked"

cli_test_assert_contains "$(cat "$CMD_LOG")" \
    "ACCEPTED" \
    "mark-resolved output should show that the current device node is accepted"

echo "[PASS] mark-resolved verified"

echo "[ALL PASS] All remote CLI commands verified successfully"
