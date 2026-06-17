#!/usr/bin/env bash
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


WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-two-db-test.XXXXXX")"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi
DB_SUFFIX="$(date +%s)-$RANDOM"

COUCHDB_URI="${hostname%/}"
COUCHDB_DBNAME="${dbname}-${DB_SUFFIX}"
COUCHDB_USER="${username:-}"
COUCHDB_PASSWORD="${password:-}"

if [[ -z "$COUCHDB_URI" || -z "$COUCHDB_USER" || -z "$COUCHDB_PASSWORD" ]]; then
    echo "[ERROR] COUCHDB_URI, COUCHDB_USER, COUCHDB_PASSWORD are required" >&2
    exit 1
fi


cleanup() {
    local exit_code=$?
    cli_test_stop_couchdb

    rm -rf "$WORK_DIR"

    # Note: we do not attempt to delete the test database, as it may cause issues if the test failed in a way that leaves the database in an inconsistent state. The test database is named with a unique suffix, so it should not interfere with other tests.
    echo "[INFO] test completed with exit code $exit_code. Test database '$COUCHDB_DBNAME' is not deleted for debugging purposes."
    exit "$exit_code"
}
trap cleanup EXIT


start_remote() {
    cli_test_start_couchdb "$COUCHDB_URI" "$COUCHDB_USER" "$COUCHDB_PASSWORD" "$COUCHDB_DBNAME"
}



echo "[INFO] using CouchDB database: $COUCHDB_DBNAME"
start_remote

VAULT_A="$WORK_DIR/vault-a"
VAULT_B="$WORK_DIR/vault-b"
SETTINGS_A="$WORK_DIR/a-settings.json"
SETTINGS_B="$WORK_DIR/b-settings.json"
mkdir -p "$VAULT_A" "$VAULT_B"

cli_test_init_settings_file "$SETTINGS_A"
cli_test_init_settings_file "$SETTINGS_B"

apply_settings() {
    local settings_file="$1"
    cli_test_apply_couchdb_settings "$settings_file" "$COUCHDB_URI" "$COUCHDB_USER" "$COUCHDB_PASSWORD" "$COUCHDB_DBNAME" 1
}

apply_settings "$SETTINGS_A"
apply_settings "$SETTINGS_B"

run_cli_a() {
    run_cli "$VAULT_A" --settings "$SETTINGS_A" "$@"
}

run_cli_b() {
    run_cli "$VAULT_B" --settings "$SETTINGS_B" "$@"
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

echo "[INFO] case1: A creates file, B can read after sync"
printf 'from-a\n' | run_cli_a put shared/from-a.txt >/dev/null
sync_a
sync_b
VALUE_FROM_B="$(cat_b shared/from-a.txt)"
cli_test_assert_equal "from-a" "$VALUE_FROM_B" "B could not read file created on A"
echo "[PASS] case1 passed"

echo "[INFO] case2: B creates file, A can read after sync"
printf 'from-b\n' | run_cli_b put shared/from-b.txt >/dev/null
sync_b
sync_a
VALUE_FROM_A="$(cat_a shared/from-b.txt)"
cli_test_assert_equal "from-b" "$VALUE_FROM_A" "A could not read file created on B"
echo "[PASS] case2 passed"

echo "[INFO] case3: concurrent edits create conflict"
printf 'base\n' | run_cli_a put shared/conflicted.txt >/dev/null
sync_a
sync_b

printf 'edit-from-a\n' | run_cli_a put shared/conflicted.txt >/dev/null
printf 'edit-from-b\n' | run_cli_b put shared/conflicted.txt >/dev/null

INFO_A="$WORK_DIR/info-a.txt"
INFO_B="$WORK_DIR/info-b.txt"
CONFLICT_DETECTED=0
for side in a b; do
    if [[ "$side" == "a" ]]; then
        sync_a
    else
        sync_b
    fi

    run_cli_a info shared/conflicted.txt > "$INFO_A"
    run_cli_b info shared/conflicted.txt > "$INFO_B"
    if ! cli_test_json_field_is_na "$INFO_A" conflicts || ! cli_test_json_field_is_na "$INFO_B" conflicts; then
        CONFLICT_DETECTED=1
        break
    fi
done

if [[ "$CONFLICT_DETECTED" != "1" ]]; then
    echo "[FAIL] expected conflict after concurrent edits, but both sides show N/A" >&2
    echo "--- A info ---" >&2
    cat "$INFO_A" >&2
    echo "--- B info ---" >&2
    cat "$INFO_B" >&2
    exit 1
fi
echo "[PASS] case3 conflict detected"

echo "[INFO] case4: resolve on A, sync, and verify B has no conflict"
INFO_A_AFTER="$WORK_DIR/info-a-after-resolve.txt"
INFO_B_AFTER="$WORK_DIR/info-b-after-resolve.txt"

# Ensure A sees the conflict before resolving; otherwise resolve may be a no-op.
for _ in 1 2 3 4 5; do
    run_cli_a info shared/conflicted.txt > "$INFO_A_AFTER"
    if ! cli_test_json_field_is_na "$INFO_A_AFTER" conflicts; then
        break
    fi
    sync_b
    sync_a
done

run_cli_a info shared/conflicted.txt > "$INFO_A_AFTER"
if cli_test_json_field_is_na "$INFO_A_AFTER" conflicts; then
    echo "[FAIL] A does not see conflict, cannot resolve from A only" >&2
    cat "$INFO_A_AFTER" >&2
    exit 1
fi

KEEP_REV="$(cli_test_json_string_field_from_file "$INFO_A_AFTER" revision)"
if [[ -z "$KEEP_REV" ]]; then
    echo "[FAIL] could not read revision from A info output" >&2
    cat "$INFO_A_AFTER" >&2
    exit 1
fi

run_cli_a resolve shared/conflicted.txt "$KEEP_REV" >/dev/null

RESOLVE_PROPAGATED=0
for _ in 1 2 3 4 5 6; do
    sync_a
    sync_b
    run_cli_a info shared/conflicted.txt > "$INFO_A_AFTER"
    run_cli_b info shared/conflicted.txt > "$INFO_B_AFTER"
    if cli_test_json_field_is_na "$INFO_A_AFTER" conflicts && cli_test_json_field_is_na "$INFO_B_AFTER" conflicts; then
        RESOLVE_PROPAGATED=1
        break
    fi

    # Retry resolve from A only when conflict remains due to eventual consistency.
    if ! cli_test_json_field_is_na "$INFO_A_AFTER" conflicts; then
        KEEP_REV_A="$(cli_test_json_string_field_from_file "$INFO_A_AFTER" revision)"
        if [[ -n "$KEEP_REV_A" ]]; then
            run_cli_a resolve shared/conflicted.txt "$KEEP_REV_A" >/dev/null || true
        fi
    fi
done

if [[ "$RESOLVE_PROPAGATED" != "1" ]]; then
    echo "[FAIL] conflicts should be resolved on both A and B" >&2
    echo "--- A info after resolve ---" >&2
    cat "$INFO_A_AFTER" >&2
    echo "--- B info after resolve ---" >&2
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
