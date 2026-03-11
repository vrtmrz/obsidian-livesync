#!/usr/bin/env bash
## TODO: test this script. I would love to go to my bed today (3a.m.) However, I am so excited about the new CLI that I want to at least get this skeleton in place. Delightful days!
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"

CLI_ENTRY="${CLI_ENTRY:-$CLI_DIR/dist/index.cjs}"
RUN_BUILD="${RUN_BUILD:-1}"
COUCHDB_URI="${COUCHDB_URI:-}"
COUCHDB_USER="${COUCHDB_USER:-}"
COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-}"
COUCHDB_DBNAME_BASE="${COUCHDB_DBNAME:-livesync-cli-e2e}"

if [[ -z "$COUCHDB_URI" || -z "$COUCHDB_USER" || -z "$COUCHDB_PASSWORD" ]]; then
    echo "[ERROR] COUCHDB_URI, COUCHDB_USER, COUCHDB_PASSWORD are required" >&2
    exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-two-db-test.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi

if [[ ! -f "$CLI_ENTRY" ]]; then
    echo "[ERROR] CLI entry not found: $CLI_ENTRY" >&2
    exit 1
fi

DB_SUFFIX="$(date +%s)-$RANDOM"
COUCHDB_DBNAME="${COUCHDB_DBNAME_BASE}-${DB_SUFFIX}"

echo "[INFO] using CouchDB database: $COUCHDB_DBNAME"

VAULT_A="$WORK_DIR/vault-a"
VAULT_B="$WORK_DIR/vault-b"
SETTINGS_A="$WORK_DIR/a-settings.json"
SETTINGS_B="$WORK_DIR/b-settings.json"
mkdir -p "$VAULT_A" "$VAULT_B"

node "$CLI_ENTRY" init-settings --force "$SETTINGS_A" >/dev/null
node "$CLI_ENTRY" init-settings --force "$SETTINGS_B" >/dev/null

apply_settings() {
    local settings_file="$1"
    SETTINGS_FILE="$settings_file" \
    COUCHDB_URI="$COUCHDB_URI" \
    COUCHDB_USER="$COUCHDB_USER" \
    COUCHDB_PASSWORD="$COUCHDB_PASSWORD" \
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
}

apply_settings "$SETTINGS_A"
apply_settings "$SETTINGS_B"

run_cli_a() {
    node "$CLI_ENTRY" "$VAULT_A" --settings "$SETTINGS_A" "$@"
}

run_cli_b() {
    node "$CLI_ENTRY" "$VAULT_B" --settings "$SETTINGS_B" "$@"
}

sync_a() {
    run_cli_a sync >/dev/null
}

sync_b() {
    run_cli_b sync >/dev/null
}

cat_a() {
    run_cli_a cat "$1"
}

cat_b() {
    run_cli_b cat "$1"
}

assert_equal() {
    local expected="$1"
    local actual="$2"
    local message="$3"
    if [[ "$expected" != "$actual" ]]; then
        echo "[FAIL] $message" >&2
        echo "expected: $expected" >&2
        echo "actual:   $actual" >&2
        exit 1
    fi
}

echo "[INFO] case1: A creates file, B can read after sync"
printf 'from-a\n' | run_cli_a put shared/from-a.txt >/dev/null
sync_a
sync_b
VALUE_FROM_B="$(cat_b shared/from-a.txt)"
assert_equal "from-a" "$VALUE_FROM_B" "B could not read file created on A"
echo "[PASS] case1 passed"

echo "[INFO] case2: B creates file, A can read after sync"
printf 'from-b\n' | run_cli_b put shared/from-b.txt >/dev/null
sync_b
sync_a
VALUE_FROM_A="$(cat_a shared/from-b.txt)"
assert_equal "from-b" "$VALUE_FROM_A" "A could not read file created on B"
echo "[PASS] case2 passed"

echo "[INFO] case3: concurrent edits create conflict"
printf 'base\n' | run_cli_a put shared/conflicted.txt >/dev/null
sync_a
sync_b

printf 'edit-from-a\n' | run_cli_a put shared/conflicted.txt >/dev/null
printf 'edit-from-b\n' | run_cli_b put shared/conflicted.txt >/dev/null

sync_a
sync_b

INFO_A="$WORK_DIR/info-a.txt"
INFO_B="$WORK_DIR/info-b.txt"
run_cli_a info shared/conflicted.txt > "$INFO_A"
run_cli_b info shared/conflicted.txt > "$INFO_B"

if grep -q '^Conflicts: N/A$' "$INFO_A" && grep -q '^Conflicts: N/A$' "$INFO_B"; then
    echo "[FAIL] expected conflict after concurrent edits, but both sides show N/A" >&2
    echo "--- A info ---" >&2
    cat "$INFO_A" >&2
    echo "--- B info ---" >&2
    cat "$INFO_B" >&2
    exit 1
fi
echo "[PASS] case3 conflict detected"

echo "[INFO] case4: resolve on A, sync, and verify B has no conflict"
KEEP_REV="$(sed -n 's/^Revision:[[:space:]]*//p' "$INFO_A" | head -n 1)"
if [[ -z "$KEEP_REV" ]]; then
    echo "[FAIL] could not read Revision from A info output" >&2
    cat "$INFO_A" >&2
    exit 1
fi

run_cli_a resolve shared/conflicted.txt "$KEEP_REV" >/dev/null
sync_a
sync_b

INFO_B_AFTER="$WORK_DIR/info-b-after-resolve.txt"
run_cli_b info shared/conflicted.txt > "$INFO_B_AFTER"
if ! grep -q '^Conflicts: N/A$' "$INFO_B_AFTER"; then
    echo "[FAIL] B still has conflicts after resolving on A and syncing" >&2
    cat "$INFO_B_AFTER" >&2
    exit 1
fi

CONTENT_A="$WORK_DIR/conflicted-a.txt"
CONTENT_B="$WORK_DIR/conflicted-b.txt"
cat_a shared/conflicted.txt > "$CONTENT_A"
cat_b shared/conflicted.txt > "$CONTENT_B"
if ! cmp -s "$CONTENT_A" "$CONTENT_B"; then
    echo "[FAIL] resolved content mismatch between A and B" >&2
    echo "--- A ---" >&2
    cat "$CONTENT_A" >&2
    echo "--- B ---" >&2
    cat "$CONTENT_B" >&2
    exit 1
fi

echo "[PASS] case4 passed"
echo "[PASS] all sync/resolve scenarios passed"
