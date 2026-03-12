#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"

# verbose
CLI_CMD=(npm run cli -- -v )
RUN_BUILD="${RUN_BUILD:-1}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-0}"
TEST_ENV_FILE="${TEST_ENV_FILE:-$CLI_DIR/.test.env}"

if [[ ! -f "$TEST_ENV_FILE" ]]; then
    echo "[ERROR] test env file not found: $TEST_ENV_FILE" >&2
    exit 1
fi

set -a
source "$TEST_ENV_FILE"
set +a

for var in hostname dbname username password; do
    if [[ -z "${!var:-}" ]]; then
        echo "[ERROR] required variable '$var' is missing in $TEST_ENV_FILE" >&2
        exit 1
    fi
done

COUCHDB_URI="${hostname%/}"
DB_SUFFIX="$(date +%s)-$RANDOM"
COUCHDB_DBNAME="${dbname}-${DB_SUFFIX}"

VAULT_ROOT="$CLI_DIR/.livesync"
VAULT_A="$VAULT_ROOT/testvault_a"
VAULT_B="$VAULT_ROOT/testvault_b"
SETTINGS_A="$VAULT_ROOT/test-settings-a.json"
SETTINGS_B="$VAULT_ROOT/test-settings-b.json"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-e2e.XXXXXX")"

cleanup() {
    local exit_code=$?
    bash "$CLI_DIR/util/couchdb-stop.sh" >/dev/null 2>&1 || true
    if [[ "$KEEP_TEST_DATA" != "1" ]]; then
        rm -rf "$VAULT_A" "$VAULT_B" "$SETTINGS_A" "$SETTINGS_B" "$WORK_DIR"
    else
        echo "[INFO] KEEP_TEST_DATA=1, preserving test artefacts"
        echo "       vault a: $VAULT_A"
        echo "       vault b: $VAULT_B"
        echo "       settings: $SETTINGS_A, $SETTINGS_B"
        echo "       work dir: $WORK_DIR"
    fi
    exit "$exit_code"
}
trap cleanup EXIT

run_cli() {
    "${CLI_CMD[@]}" "$@"
}

run_cli_a() {
    run_cli "$VAULT_A" --settings "$SETTINGS_A" "$@"
}

run_cli_b() {
    run_cli "$VAULT_B" --settings "$SETTINGS_B" "$@"
}

assert_contains() {
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

assert_equal() {
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

assert_command_fails() {
    local message="$1"
    shift
    set +e
    "$@" >"$WORK_DIR/failed-command.log" 2>&1
    local exit_code=$?
    set -e
    if [[ "$exit_code" -eq 0 ]]; then
        echo "[FAIL] $message" >&2
        cat "$WORK_DIR/failed-command.log" >&2
        exit 1
    fi
}

sanitise_cat_stdout() {
    sed '/^\[CLIWatchAdapter\] File watching is not enabled in CLI version$/d'
}

sync_both() {
    run_cli_a sync >/dev/null
    run_cli_b sync >/dev/null
}

curl_json() {
    curl -4 -sS --fail --connect-timeout 3 --max-time 15 "$@"
}

init_settings() {
    local settings_file="$1"
    run_cli init-settings --force "$settings_file" >/dev/null
    SETTINGS_FILE="$settings_file" \
    COUCHDB_URI="$COUCHDB_URI" \
    COUCHDB_USER="$username" \
    COUCHDB_PASSWORD="$password" \
    COUCHDB_DBNAME="$COUCHDB_DBNAME" \
    node <<'NODE'
const fs = require("node:fs");
const settingsPath = process.env.SETTINGS_FILE;
const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

data.couchDB_URI = process.env.COUCHDB_URI;
data.couchDB_USER = process.env.COUCHDB_USER;
data.couchDB_PASSWORD = process.env.COUCHDB_PASSWORD;
data.couchDB_DBNAME = process.env.COUCHDB_DBNAME;
data.liveSync = true;
data.syncOnStart = false;
data.syncOnSave = false;
data.usePluginSync = false;
data.isConfigured = true;

fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
NODE
cat "$settings_file"
}

echo "[INFO] stopping leftover CouchDB container if present"
bash "$CLI_DIR/util/couchdb-stop.sh" >/dev/null 2>&1 || true

echo "[INFO] starting CouchDB test container"
bash "$CLI_DIR/util/couchdb-start.sh"

echo "status"
docker ps --filter "name=couchdb-test" 

echo "[INFO] initialising CouchDB test container"
bash "$CLI_DIR/util/couchdb-init.sh"

echo "[INFO] CouchDB create test database: $COUCHDB_DBNAME"
until (curl_json -X PUT --user "${username}:${password}" "${hostname}/${COUCHDB_DBNAME}" ); do sleep 5; done

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

echo "[INFO] preparing vaults and settings"
rm -rf "$VAULT_A" "$VAULT_B" "$SETTINGS_A" "$SETTINGS_B"
mkdir -p "$VAULT_A" "$VAULT_B"
init_settings "$SETTINGS_A"
init_settings "$SETTINGS_B"

echo "[INFO] test DB: $COUCHDB_DBNAME"

TARGET_A_ONLY="e2e/a-only-info.md"
TARGET_SYNC="e2e/sync-info.md"
TARGET_PUSH="e2e/pushed-from-a.md"
TARGET_PUT="e2e/put-from-a.md"
TARGET_CONFLICT="e2e/conflict.md"

echo "[CASE] A puts and A can get info"
printf 'alpha-from-a\n' | run_cli_a put "$TARGET_A_ONLY" >/dev/null
INFO_A_ONLY="$(run_cli_a info "$TARGET_A_ONLY")"
assert_contains "$INFO_A_ONLY" "\"path\": \"$TARGET_A_ONLY\"" "A info should include path after put"
echo "[PASS] A put/info"

echo "[CASE] A puts, both sync, and B can get info"
printf 'visible-after-sync\n' | run_cli_a put "$TARGET_SYNC" >/dev/null
sync_both
INFO_B_SYNC="$(run_cli_b info "$TARGET_SYNC")"
assert_contains "$INFO_B_SYNC" "\"path\": \"$TARGET_SYNC\"" "B info should include path after sync"
echo "[PASS] sync A->B and B info"

echo "[CASE] A pushes and puts, both sync, and B can pull and cat"
PUSH_SRC="$WORK_DIR/push-source.txt"
PULL_DST="$WORK_DIR/pull-destination.txt"
printf 'pushed-content-%s\n' "$DB_SUFFIX" > "$PUSH_SRC"
run_cli_a push "$PUSH_SRC" "$TARGET_PUSH" >/dev/null
printf 'put-content-%s\n' "$DB_SUFFIX" | run_cli_a put "$TARGET_PUT" >/dev/null
sync_both
run_cli_b pull "$TARGET_PUSH" "$PULL_DST" >/dev/null
if ! cmp -s "$PUSH_SRC" "$PULL_DST"; then
    echo "[FAIL] B pull result does not match pushed source" >&2
    echo "--- source ---" >&2
    cat "$PUSH_SRC" >&2
    echo "--- pulled ---" >&2
    cat "$PULL_DST" >&2
    exit 1
fi
CAT_B_PUT="$(run_cli_b cat "$TARGET_PUT" | sanitise_cat_stdout)"
assert_equal "put-content-$DB_SUFFIX" "$CAT_B_PUT" "B cat should return A put content"
echo "[PASS] push/pull and put/cat across vaults"

echo "[CASE] A removes, both sync, and B can no longer cat"
run_cli_a rm "$TARGET_PUT" >/dev/null
sync_both
assert_command_fails "B cat should fail after A removed the file and synced" run_cli_b cat "$TARGET_PUT"
echo "[PASS] rm is replicated"

echo "[CASE] verify conflict detection"
printf 'conflict-base\n' | run_cli_a put "$TARGET_CONFLICT" >/dev/null
sync_both
INFO_B_BASE="$(run_cli_b info "$TARGET_CONFLICT")"
assert_contains "$INFO_B_BASE" "\"path\": \"$TARGET_CONFLICT\"" "B should be able to info before creating conflict"

printf 'conflict-from-a-%s\n' "$DB_SUFFIX" | run_cli_a put "$TARGET_CONFLICT" >/dev/null
printf 'conflict-from-b-%s\n' "$DB_SUFFIX" | run_cli_b put "$TARGET_CONFLICT" >/dev/null

run_cli_a sync >/dev/null
run_cli_b sync >/dev/null
run_cli_a sync >/dev/null

INFO_A_CONFLICT="$(run_cli_a info "$TARGET_CONFLICT")"
INFO_B_CONFLICT="$(run_cli_b info "$TARGET_CONFLICT")"
if grep -qF '"conflicts": "N/A"' <<< "$INFO_A_CONFLICT" && grep -qF '"conflicts": "N/A"' <<< "$INFO_B_CONFLICT"; then
    echo "[FAIL] conflict was expected but both A and B show Conflicts: N/A" >&2
    echo "--- A info ---" >&2
    echo "$INFO_A_CONFLICT" >&2
    echo "--- B info ---" >&2
    echo "$INFO_B_CONFLICT" >&2
    exit 1
fi
echo "[PASS] conflict detected by info"

echo "[PASS] all requested E2E scenarios completed"