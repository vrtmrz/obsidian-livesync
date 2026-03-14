#!/usr/bin/env bash
# Test: mirror command — storage <-> local database synchronisation
#
# Covered cases:
#   1. Storage-only file   → synced into DB           (UPDATE DATABASE)
#   2. DB-only file        → restored to storage      (UPDATE STORAGE)
#   3. DB-deleted file     → NOT restored to storage  (UPDATE STORAGE skip)
#   4. Both, storage newer → DB updated               (SYNC: STORAGE → DB)
#   5. Both, DB newer      → storage updated          (SYNC: DB → STORAGE)
#
# Not covered (require precise mtime control or artificial conflict injection):
#   - Both, equal mtime → no-op  (EVEN)
#   - Conflicted entry  → skipped
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
cli_test_init_cli_cmd

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-test.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

SETTINGS_FILE="$WORK_DIR/data.json"
VAULT_DIR="$WORK_DIR/vault"
mkdir -p "$VAULT_DIR/test"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi

echo "[INFO] generating settings -> $SETTINGS_FILE"
cli_test_init_settings_file "$SETTINGS_FILE"

# isConfigured=true is required for mirror (canProceedScan checks this)
cli_test_mark_settings_configured "$SETTINGS_FILE"

PASS=0
FAIL=0

assert_pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
assert_fail() { echo "[FAIL] $1" >&2; FAIL=$((FAIL + 1)); }

# Return timestamp for touch -t in YYYYMMDDHHMM format.
# Accepts offsets such as "+1 hour" or "-1 hour".
portable_touch_timestamp() {
    local offset="$1"
    if command -v gdate >/dev/null 2>&1; then
        gdate -d "$offset" +%Y%m%d%H%M
        return
    fi
    if date -d "$offset" +%Y%m%d%H%M >/dev/null 2>&1; then
        date -d "$offset" +%Y%m%d%H%M
        return
    fi

    case "$offset" in
        "+1 hour")
            date -v+1H +%Y%m%d%H%M
            ;;
        "-1 hour")
            date -v-1H +%Y%m%d%H%M
            ;;
        *)
            echo "[FAIL] Unsupported date offset on this platform: $offset" >&2
            exit 1
            ;;
    esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Case 1: File exists only in storage → should be synced into DB after mirror
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 1: storage-only → DB ==="

printf 'storage-only content\n' > "$VAULT_DIR/test/storage-only.md"

run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

RESULT_FILE="$WORK_DIR/case1-cat.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" pull test/storage-only.md "$RESULT_FILE"

if cmp -s "$VAULT_DIR/test/storage-only.md" "$RESULT_FILE"; then
    assert_pass "storage-only file was synced into DB"
else
    assert_fail "storage-only file NOT synced into DB"
    echo "--- storage ---" >&2; cat "$VAULT_DIR/test/storage-only.md" >&2
    echo "--- cat ---" >&2;     cat "$RESULT_FILE" >&2
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 2: File exists only in DB → should be restored to storage after mirror
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 2: DB-only → storage ==="

printf 'db-only content\n' | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put test/db-only.md

if [[ -f "$VAULT_DIR/test/db-only.md" ]]; then
    assert_fail "db-only.md unexpectedly exists in storage before mirror"
else
    echo "[INFO] confirmed: test/db-only.md not in storage before mirror"
fi

run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

if [[ -f "$VAULT_DIR/test/db-only.md" ]]; then
    STORAGE_CONTENT="$(cat "$VAULT_DIR/test/db-only.md")"
    if [[ "$STORAGE_CONTENT" == "db-only content" ]]; then
        assert_pass "DB-only file was restored to storage"
    else
        assert_fail "DB-only file restored but content mismatch (got: '${STORAGE_CONTENT}')"
    fi
else
    assert_fail "DB-only file was NOT restored to storage"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 3: File deleted in DB → should NOT be created in storage
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 3: DB-deleted → storage untouched ==="

printf 'to-be-deleted\n' | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put test/deleted.md
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" rm test/deleted.md

run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

if [[ ! -f "$VAULT_DIR/test/deleted.md" ]]; then
    assert_pass "deleted DB entry was not restored to storage"
else
    assert_fail "deleted DB entry was incorrectly restored to storage"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 4: Both exist, storage is newer → DB should be updated
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 4: storage newer → DB updated ==="

# Seed DB with old content (mtime ≈ now)
printf 'old content\n' | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put test/sync-storage-newer.md

# Write new content to storage with a timestamp 1 hour in the future
printf 'new content\n' > "$VAULT_DIR/test/sync-storage-newer.md"
touch -t "$(portable_touch_timestamp '+1 hour')" "$VAULT_DIR/test/sync-storage-newer.md"

run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

DB_RESULT_FILE="$WORK_DIR/case4-pull.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" pull test/sync-storage-newer.md "$DB_RESULT_FILE"
if cmp -s "$VAULT_DIR/test/sync-storage-newer.md" "$DB_RESULT_FILE"; then
    assert_pass "DB updated to match newer storage file"
else
    assert_fail "DB NOT updated to match newer storage file"
    echo "--- expected(storage) ---" >&2; cat "$VAULT_DIR/test/sync-storage-newer.md" >&2
    echo "--- pulled(from db) ---" >&2;  cat "$DB_RESULT_FILE" >&2
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 5: Both exist, DB is newer → storage should be updated
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 5: DB newer → storage updated ==="

# Write old content to storage with a timestamp 1 hour in the past
printf 'old storage content\n' > "$VAULT_DIR/test/sync-db-newer.md"
touch -t "$(portable_touch_timestamp '-1 hour')" "$VAULT_DIR/test/sync-db-newer.md"

# Write new content to DB only (mtime ≈ now, newer than the storage file)
printf 'new db content\n' | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put test/sync-db-newer.md

run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

STORAGE_CONTENT="$(cat "$VAULT_DIR/test/sync-db-newer.md")"
if [[ "$STORAGE_CONTENT" == "new db content" ]]; then
    assert_pass "storage updated to match newer DB entry"
else
    assert_fail "storage NOT updated to match newer DB entry (got: '${STORAGE_CONTENT}')"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
