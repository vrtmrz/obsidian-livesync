#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
VERBOSE_TEST_LOGGING="${VERBOSE_TEST_LOGGING:-0}"
cli_test_init_cli_cmd
RUN_BUILD="${RUN_BUILD:-1}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-0}"
TEST_ENV_FILE="${TEST_ENV_FILE:-$CLI_DIR/.test.env}"
REMOTE_TYPE="${REMOTE_TYPE:-COUCHDB}"
ENCRYPT="${ENCRYPT:-0}"
TEST_LABEL="${TEST_LABEL:-${REMOTE_TYPE}-enc${ENCRYPT}}"
E2E_PASSPHRASE="${E2E_PASSPHRASE:-e2e-passphrase}"

if [[ ! -f "$TEST_ENV_FILE" ]]; then
    echo "[ERROR] test env file not found: $TEST_ENV_FILE" >&2
    exit 1
fi

set -a
source "$TEST_ENV_FILE"
set +a

DB_SUFFIX="$(date +%s)-$RANDOM"

VAULT_ROOT="$CLI_DIR/.livesync"
VAULT_A="$VAULT_ROOT/testvault_a"
VAULT_B="$VAULT_ROOT/testvault_b"
SETTINGS_A="$VAULT_ROOT/test-settings-a.json"
SETTINGS_B="$VAULT_ROOT/test-settings-b.json"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-e2e.${TEST_LABEL}.XXXXXX")"

COUCHDB_URI=""
COUCHDB_DBNAME=""
MINIO_BUCKET=""

if [[ "$REMOTE_TYPE" == "COUCHDB" ]]; then
    cli_test_require_env hostname "$TEST_ENV_FILE"
    cli_test_require_env dbname "$TEST_ENV_FILE"
    cli_test_require_env username "$TEST_ENV_FILE"
    cli_test_require_env password "$TEST_ENV_FILE"
    COUCHDB_URI="${hostname%/}"
    COUCHDB_DBNAME="${dbname}-${DB_SUFFIX}"
    COUCHDB_USER="${username:-}"
    COUCHDB_PASSWORD="${password:-}"
elif [[ "$REMOTE_TYPE" == "MINIO" ]]; then
    cli_test_require_env accessKey "$TEST_ENV_FILE"
    cli_test_require_env secretKey "$TEST_ENV_FILE"
    cli_test_require_env minioEndpoint "$TEST_ENV_FILE"
    cli_test_require_env bucketName "$TEST_ENV_FILE"
    MINIO_BUCKET="${bucketName}-${DB_SUFFIX}"
    MINIO_ENDPOINT="${minioEndpoint:-}"
    MINIO_ACCESS_KEY="${accessKey:-}"
    MINIO_SECRET_KEY="${secretKey:-}"
else
    echo "[ERROR] unsupported REMOTE_TYPE: $REMOTE_TYPE (use COUCHDB or MINIO)" >&2
    exit 1
fi

cleanup() {
    local exit_code=$?
    if [[ "$REMOTE_TYPE" == "COUCHDB" ]]; then
        cli_test_stop_couchdb
    else
        cli_test_stop_minio
    fi

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

run_cli_a() {
    run_cli "$VAULT_A" --settings "$SETTINGS_A" "$@"
}

run_cli_b() {
    run_cli "$VAULT_B" --settings "$SETTINGS_B" "$@"
}

sync_both() {
    run_cli_a sync >/dev/null
    run_cli_b sync >/dev/null
}

configure_remote_settings() {
    local settings_file="$1"
    cli_test_apply_remote_sync_settings "$settings_file"
}

init_settings() {
    local settings_file="$1"
    cli_test_init_settings_file "$settings_file"
    configure_remote_settings "$settings_file"
    cat "$settings_file"
}

start_remote() {
    if [[ "$REMOTE_TYPE" == "COUCHDB" ]]; then
        cli_test_start_couchdb "$COUCHDB_URI" "$COUCHDB_USER" "$COUCHDB_PASSWORD" "$COUCHDB_DBNAME"
    else
        cli_test_start_minio "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" "$MINIO_BUCKET"
    fi
}

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI"
    npm run build
fi

echo "[INFO] e2e case: remote=$REMOTE_TYPE encrypt=$ENCRYPT label=$TEST_LABEL"
start_remote

echo "[INFO] preparing vaults and settings"
rm -rf "$VAULT_A" "$VAULT_B" "$SETTINGS_A" "$SETTINGS_B"
mkdir -p "$VAULT_A" "$VAULT_B"
init_settings "$SETTINGS_A"
init_settings "$SETTINGS_B"

if [[ "$REMOTE_TYPE" == "COUCHDB" ]]; then
    echo "[INFO] test remote DB: $COUCHDB_DBNAME"
else
    echo "[INFO] test remote bucket: $MINIO_BUCKET"
fi

TARGET_A_ONLY="e2e/a-only-info.md"
TARGET_SYNC="e2e/sync-info.md"
TARGET_PUSH="e2e/pushed-from-a.md"
TARGET_PUT="e2e/put-from-a.md"
TARGET_PUSH_BINARY="e2e/pushed-from-a.bin"
TARGET_CONFLICT="e2e/conflict.md"

echo "[CASE] A puts and A can get info"
printf 'alpha-from-a\n' | run_cli_a put "$TARGET_A_ONLY" >/dev/null
INFO_A_ONLY="$(run_cli_a info "$TARGET_A_ONLY")"
cli_test_assert_contains "$INFO_A_ONLY" "\"path\": \"$TARGET_A_ONLY\"" "A info should include path after put"
echo "[PASS] A put/info"

echo "[CASE] A puts, both sync, and B can get info"
printf 'visible-after-sync\n' | run_cli_a put "$TARGET_SYNC" >/dev/null
sync_both
INFO_B_SYNC="$(run_cli_b info "$TARGET_SYNC")"
cli_test_assert_contains "$INFO_B_SYNC" "\"path\": \"$TARGET_SYNC\"" "B info should include path after sync"
echo "[PASS] sync A->B and B info"

echo "[CASE] A pushes and puts, both sync, and B can pull and cat"
PUSH_SRC="$WORK_DIR/push-source.txt"
PULL_DST="$WORK_DIR/pull-destination.txt"
printf 'pushed-content-%s\n' "$DB_SUFFIX" > "$PUSH_SRC"
run_cli_a push "$PUSH_SRC" "$TARGET_PUSH" >/dev/null
printf 'put-content-%s\n' "$DB_SUFFIX" | run_cli_a put "$TARGET_PUT" >/dev/null
sync_both
run_cli_b pull "$TARGET_PUSH" "$PULL_DST" >/dev/null
cli_test_assert_files_equal "$PUSH_SRC" "$PULL_DST" "B pull result does not match pushed source"
CAT_B_PUT="$(run_cli_b cat "$TARGET_PUT" | cli_test_sanitise_cat_stdout)"
cli_test_assert_equal "put-content-$DB_SUFFIX" "$CAT_B_PUT" "B cat should return A put content"
echo "[PASS] push/pull and put/cat across vaults"

echo "[CASE] A pushes binary, both sync, and B can pull identical bytes"
PUSH_BINARY_SRC="$WORK_DIR/push-source.bin"
PULL_BINARY_DST="$WORK_DIR/pull-destination.bin"
head -c 4096 /dev/urandom > "$PUSH_BINARY_SRC"
run_cli_a push "$PUSH_BINARY_SRC" "$TARGET_PUSH_BINARY" >/dev/null
sync_both
run_cli_b pull "$TARGET_PUSH_BINARY" "$PULL_BINARY_DST" >/dev/null
cli_test_assert_files_equal "$PUSH_BINARY_SRC" "$PULL_BINARY_DST" "B pull result does not match pushed binary source"
echo "[PASS] binary push/pull across vaults"

echo "[CASE] A removes, both sync, and B can no longer cat"
run_cli_a rm "$TARGET_PUT" >/dev/null
sync_both
cli_test_assert_command_fails "B cat should fail after A removed the file and synced" "$WORK_DIR/failed-command.log" run_cli_b cat "$TARGET_PUT"
echo "[PASS] rm is replicated"

echo "[CASE] verify conflict detection"
printf 'conflict-base\n' | run_cli_a put "$TARGET_CONFLICT" >/dev/null
sync_both
INFO_B_BASE="$(run_cli_b info "$TARGET_CONFLICT")"
cli_test_assert_contains "$INFO_B_BASE" "\"path\": \"$TARGET_CONFLICT\"" "B should be able to info before creating conflict"

printf 'conflict-from-a-%s\n' "$DB_SUFFIX" | run_cli_a put "$TARGET_CONFLICT" >/dev/null
printf 'conflict-from-b-%s\n' "$DB_SUFFIX" | run_cli_b put "$TARGET_CONFLICT" >/dev/null

INFO_A_CONFLICT=""
INFO_B_CONFLICT=""
CONFLICT_DETECTED=0

for side in a b a; do
    if [[ "$side" == "a" ]]; then
        run_cli_a sync >/dev/null
    else
        run_cli_b sync >/dev/null
    fi

    INFO_A_CONFLICT="$(run_cli_a info "$TARGET_CONFLICT")"
    INFO_B_CONFLICT="$(run_cli_b info "$TARGET_CONFLICT")"
    if ! grep -qF '"conflicts": "N/A"' <<< "$INFO_A_CONFLICT" || ! grep -qF '"conflicts": "N/A"' <<< "$INFO_B_CONFLICT"; then
        CONFLICT_DETECTED=1
        break
    fi
done

if [[ "$CONFLICT_DETECTED" != "1" ]]; then
    echo "[FAIL] conflict was expected but both A and B show Conflicts: N/A" >&2
    echo "--- A info ---" >&2
    echo "$INFO_A_CONFLICT" >&2
    echo "--- B info ---" >&2
    echo "$INFO_B_CONFLICT" >&2
    exit 1
fi
echo "[PASS] conflict detected by info"

echo "[CASE] verify ls marks conflicted revisions"
LS_A_CONFLICT_LINE="$(run_cli_a ls "$TARGET_CONFLICT" | awk -F $'\t' -v p="$TARGET_CONFLICT" '$1==p {print; exit}')"
LS_B_CONFLICT_LINE="$(run_cli_b ls "$TARGET_CONFLICT" | awk -F $'\t' -v p="$TARGET_CONFLICT" '$1==p {print; exit}')"
if [[ -z "$LS_A_CONFLICT_LINE" || -z "$LS_B_CONFLICT_LINE" ]]; then
    echo "[FAIL] ls output did not include conflict target on one of the vaults" >&2
    echo "--- A ls ---" >&2
    run_cli_a ls "$TARGET_CONFLICT" >&2 || true
    echo "--- B ls ---" >&2
    run_cli_b ls "$TARGET_CONFLICT" >&2 || true
    exit 1
fi
LS_A_CONFLICT_REV="$(awk -F $'\t' '{print $4}' <<< "$LS_A_CONFLICT_LINE")"
LS_B_CONFLICT_REV="$(awk -F $'\t' '{print $4}' <<< "$LS_B_CONFLICT_LINE")"
if [[ "$LS_A_CONFLICT_REV" != *"*" && "$LS_B_CONFLICT_REV" != *"*" ]]; then
    echo "[FAIL] conflicted entry should be marked with '*' in ls revision column on at least one vault" >&2
    echo "A: $LS_A_CONFLICT_LINE" >&2
    echo "B: $LS_B_CONFLICT_LINE" >&2
    exit 1
fi
echo "[PASS] ls marks conflicts"

echo "[CASE] resolve conflict on A and verify both vaults are clean"
KEEP_REVISION="$(printf '%s' "$INFO_A_CONFLICT" | cli_test_json_string_field_from_stdin revision)"
if [[ -z "$KEEP_REVISION" ]]; then
    echo "[FAIL] could not extract current revision from A info output" >&2
    echo "$INFO_A_CONFLICT" >&2
    exit 1
fi

run_cli_a resolve "$TARGET_CONFLICT" "$KEEP_REVISION" >/dev/null

INFO_A_RESOLVED=""
INFO_B_RESOLVED=""
RESOLVE_PROPAGATED=0
for _ in 1 2 3 4 5 6; do
    sync_both
    INFO_A_RESOLVED="$(run_cli_a info "$TARGET_CONFLICT")"
    INFO_B_RESOLVED="$(run_cli_b info "$TARGET_CONFLICT")"
    if grep -qF '"conflicts": "N/A"' <<< "$INFO_A_RESOLVED" && grep -qF '"conflicts": "N/A"' <<< "$INFO_B_RESOLVED"; then
        RESOLVE_PROPAGATED=1
        break
    fi

    # Retry from A only when conflict remains due to eventual consistency.
    if ! grep -qF '"conflicts": "N/A"' <<< "$INFO_A_RESOLVED"; then
        KEEP_REVISION_A="$(printf '%s' "$INFO_A_RESOLVED" | cli_test_json_string_field_from_stdin revision)"
        if [[ -n "$KEEP_REVISION_A" ]]; then
            run_cli_a resolve "$TARGET_CONFLICT" "$KEEP_REVISION_A" >/dev/null || true
        fi
    fi
done

if [[ "$RESOLVE_PROPAGATED" != "1" ]]; then
    echo "[FAIL] conflicts should be resolved on both vaults" >&2
    echo "--- A info after resolve ---" >&2
    echo "$INFO_A_RESOLVED" >&2
    echo "--- B info after resolve ---" >&2
    echo "$INFO_B_RESOLVED" >&2
    exit 1
fi

LS_A_RESOLVED_LINE="$(run_cli_a ls "$TARGET_CONFLICT" | awk -F $'\t' -v p="$TARGET_CONFLICT" '$1==p {print; exit}')"
LS_B_RESOLVED_LINE="$(run_cli_b ls "$TARGET_CONFLICT" | awk -F $'\t' -v p="$TARGET_CONFLICT" '$1==p {print; exit}')"
LS_A_RESOLVED_REV="$(awk -F $'\t' '{print $4}' <<< "$LS_A_RESOLVED_LINE")"
LS_B_RESOLVED_REV="$(awk -F $'\t' '{print $4}' <<< "$LS_B_RESOLVED_LINE")"
if [[ "$LS_A_RESOLVED_REV" == *"*" || "$LS_B_RESOLVED_REV" == *"*" ]]; then
    echo "[FAIL] resolved entry should not be marked as conflicted in ls" >&2
    echo "A: $LS_A_RESOLVED_LINE" >&2
    echo "B: $LS_B_RESOLVED_LINE" >&2
    exit 1
fi

CAT_A_RESOLVED="$(run_cli_a cat "$TARGET_CONFLICT" | cli_test_sanitise_cat_stdout)"
CAT_B_RESOLVED="$(run_cli_b cat "$TARGET_CONFLICT" | cli_test_sanitise_cat_stdout)"
cli_test_assert_equal "$CAT_A_RESOLVED" "$CAT_B_RESOLVED" "resolved content should match across both vaults"
echo "[PASS] resolve is replicated and ls reflects resolved state"

echo "[PASS] all requested E2E scenarios completed (${TEST_LABEL})"
