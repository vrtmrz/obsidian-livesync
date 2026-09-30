#!/usr/bin/env bash
# Test: mirror command — storage <-> local database synchronisation
#
# Covered cases:
#   1. Storage-only file   → synced into DB           (UPDATE DATABASE)
#   2. DB-only file        → restored to storage      (UPDATE STORAGE)
#   3. DB-deleted file     → NOT restored to storage  (UPDATE STORAGE skip)
#   4. Both, storage newer → DB updated               (SYNC: STORAGE → DB)
#   5. Both, DB newer      → storage updated          (SYNC: DB → STORAGE)
#   6. Compatibility mode → omitted vault-path works
#   7. Unknown local origin → conflict preserved, deduplicated, and resolved
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
DB_DIR="$WORK_DIR/db"
mkdir -p "$VAULT_DIR/test"
mkdir -p "$DB_DIR"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi

echo "[INFO] generating settings -> $SETTINGS_FILE"
cli_test_init_settings_file "$SETTINGS_FILE"

# isConfigured=true is required for mirror (canProceedScan checks this)
cli_test_mark_settings_configured "$SETTINGS_FILE"

# Allow incoming DB content to be reflected when conflicts exist (Case 5).
# This does not resolve conflicts or authorise overwriting DB content.
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf-8"));
data.writeDocumentsIfConflicted = true;
fs.writeFileSync(file, JSON.stringify(data, null, 2));
' "$SETTINGS_FILE"

# Preparation: Sync settings and files logic
DB_SETTINGS="$DB_DIR/settings.json"
cp "$SETTINGS_FILE" "$DB_SETTINGS"

# Helper for standard run (Separated paths)
run_mirror_test() {
    run_cli "$DB_DIR" --settings "$DB_SETTINGS" mirror "$VAULT_DIR"
}

# Helper for compatibility run (Same path)
run_mirror_compat() {
    run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror
}

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
echo "=== Case 1: storage-only → DB (Separated Paths) ==="

printf 'storage-only content\n' > "$VAULT_DIR/test/storage-only.md"

echo "[DEBUG] DB_DIR: $DB_DIR"
echo "[DEBUG] VAULT_DIR: $VAULT_DIR"

run_mirror_test

RESULT_FILE="$WORK_DIR/case1-cat.txt"
# Try 'ls' first to see what's in the DB
echo "--- DB contents ---"
run_cli "$DB_DIR" --settings "$DB_SETTINGS" ls
echo "-------------------"

run_cli "$DB_DIR" --settings "$DB_SETTINGS" pull test/storage-only.md "$RESULT_FILE"

if cmp -s "$VAULT_DIR/test/storage-only.md" "$RESULT_FILE"; then
    assert_pass "storage-only file was synced into DB using separated paths"
else
    assert_fail "storage-only file NOT synced into DB with separated paths"
    echo "--- storage ---" >&2; cat "$VAULT_DIR/test/storage-only.md" >&2
    echo "--- cat ---" >&2;     cat "$RESULT_FILE" >&2
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 2: File exists only in DB → should be restored to storage after mirror
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 2: DB-only → storage (Separated Paths) ==="

printf 'db-only content\n' | run_cli "$DB_DIR" --settings "$DB_SETTINGS" put test/db-only.md

if [[ -f "$VAULT_DIR/test/db-only.md" ]]; then
    assert_fail "db-only.md unexpectedly exists in storage before mirror"
else
    echo "[INFO] confirmed: test/db-only.md not in storage before mirror"
fi

run_mirror_test

if [[ -f "$VAULT_DIR/test/db-only.md" ]]; then
    STORAGE_CONTENT="$(cat "$VAULT_DIR/test/db-only.md")"
    if [[ "$STORAGE_CONTENT" == "db-only content" ]]; then
        assert_pass "DB-only file was restored to storage"
    else
        assert_fail "DB-only file restored but content mismatch (got: '${STORAGE_CONTENT}')"
    fi
else
    assert_fail "DB-only file NOT restored to storage after mirror"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 3: File deleted in DB → should NOT be created in storage
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 3: DB-deleted → storage untouched (Separated Paths) ==="

printf 'to-be-deleted\n' | run_cli "$DB_DIR" --settings "$DB_SETTINGS" put test/deleted.md
run_cli "$DB_DIR" --settings "$DB_SETTINGS" rm test/deleted.md

run_mirror_test

if [[ ! -f "$VAULT_DIR/test/deleted.md" ]]; then
    assert_pass "deleted DB entry was not restored to storage"
else
    assert_fail "deleted DB entry was incorrectly restored to storage"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 4: Both exist, storage is newer → DB should be updated
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 4: storage newer → DB updated (Separated Paths) ==="

# Seed DB with old content (mtime ≈ now)
printf 'old content\n' | run_cli "$DB_DIR" --settings "$DB_SETTINGS" put test/sync-storage-newer.md

# Establish the file's recorded base before making an ordinary local edit.
# A direct put followed by unrelated local content has unknown provenance.
run_mirror_test
cli_test_assert_equal "old content" "$(cat "$VAULT_DIR/test/sync-storage-newer.md")" "Case 4 base was not reflected"

# Write new content to storage with a timestamp 1 hour in the future
printf 'new content\n' > "$VAULT_DIR/test/sync-storage-newer.md"
touch -t "$(portable_touch_timestamp '+1 hour')" "$VAULT_DIR/test/sync-storage-newer.md"

run_mirror_test

DB_RESULT_FILE="$WORK_DIR/case4-pull.txt"
CASE4_INFO="$(run_cli "$DB_DIR" --settings "$DB_SETTINGS" info test/sync-storage-newer.md)"
cli_test_assert_equal "N/A" "$(printf '%s' "$CASE4_INFO" | cli_test_json_string_field_from_stdin conflicts)" "Ordinary local edit unexpectedly created a conflict"
run_cli "$DB_DIR" --settings "$DB_SETTINGS" pull test/sync-storage-newer.md "$DB_RESULT_FILE"
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
echo "=== Case 5: DB newer → storage updated (Separated Paths) ==="

# Write old content to storage with a timestamp 1 hour in the past
printf 'old storage content\n' > "$VAULT_DIR/test/sync-db-newer.md"
touch -t "$(portable_touch_timestamp '-1 hour')" "$VAULT_DIR/test/sync-db-newer.md"

# Write new content to DB only (mtime ≈ now, newer than the storage file)
printf 'new db content\n' | run_cli "$DB_DIR" --settings "$DB_SETTINGS" put test/sync-db-newer.md

run_mirror_test

STORAGE_CONTENT="$(cat "$VAULT_DIR/test/sync-db-newer.md")"
if [[ "$STORAGE_CONTENT" == "new db content" ]]; then
    assert_pass "storage updated to match newer DB entry"
else
    assert_fail "storage NOT updated to match newer DB entry (got: '${STORAGE_CONTENT}')"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 6: Compatibility test - omitted vault-path
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 6: omitted vault-path (Compatibility Mode) ==="

# We use VAULT_DIR as the "main" database path for this part.
printf 'compat-content\n' > "$VAULT_DIR/compat.md"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

# In compat mode, it should find it in the DB at root
CAT_RESULT="$WORK_DIR/compat-cat.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" pull compat.md "$CAT_RESULT"
if [[ "$(cat "$CAT_RESULT")" == "compat-content" ]]; then
    assert_pass "Compatibility mode works (omitted vault-path)"
else
    assert_fail "Compatibility mode failed to sync file into DB"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 7: Unknown local origin must preserve both contents, regardless of mtime
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 7: unknown local origin → preserve and resolve conflict ==="

UNKNOWN_PATH="test/unknown-origin.md"
printf 'original DB content\n' | run_cli "$DB_DIR" --settings "$DB_SETTINGS" put "$UNKNOWN_PATH"
printf 'unrelated local content\n' > "$VAULT_DIR/$UNKNOWN_PATH"
touch -t "$(portable_touch_timestamp '+1 hour')" "$VAULT_DIR/$UNKNOWN_PATH"
run_mirror_test

UNKNOWN_INFO="$(run_cli "$DB_DIR" --settings "$DB_SETTINGS" info "$UNKNOWN_PATH")"
WINNER="$(printf '%s' "$UNKNOWN_INFO" | cli_test_json_string_field_from_stdin revision)"
CONFLICT="$(printf '%s' "$UNKNOWN_INFO" | cli_test_json_string_field_from_stdin conflicts)"
if [[ ! "$WINNER" =~ ^1-[[:xdigit:]]+$ || ! "$CONFLICT" =~ ^1-[[:xdigit:]]+$ || "$WINNER" == "$CONFLICT" ]]; then
    echo "[FAIL] Expected two independent non-deleted root revisions: $UNKNOWN_INFO" >&2
    exit 1
fi

# Do not assume which randomly identified root PouchDB selects as the winner.
LOCAL_REV=""
DB_REV=""
for revision in "$WINNER" "$CONFLICT"; do
    CONTENT="$(run_cli "$DB_DIR" --settings "$DB_SETTINGS" cat-rev "$UNKNOWN_PATH" "$revision" | cli_test_sanitise_cat_stdout)"
    case "$CONTENT" in
        'unrelated local content') LOCAL_REV="$revision" ;;
        'original DB content') DB_REV="$revision" ;;
        *) echo "[FAIL] Unexpected content for $revision: $CONTENT" >&2; exit 1 ;;
    esac
done
[[ -n "$LOCAL_REV" && -n "$DB_REV" ]] || { echo "[FAIL] Both contents must remain readable" >&2; exit 1; }

# Force another ordinary save of the same unknown bytes, even if incoming
# reflection replaced the file under writeDocumentsIfConflicted.
printf 'unrelated local content\n' > "$VAULT_DIR/$UNKNOWN_PATH"
touch -t "$(portable_touch_timestamp '+1 hour')" "$VAULT_DIR/$UNKNOWN_PATH"
run_mirror_test
REPEATED_INFO="$(run_cli "$DB_DIR" --settings "$DB_SETTINGS" info "$UNKNOWN_PATH")"
cli_test_assert_equal "$WINNER" "$(printf '%s' "$REPEATED_INFO" | cli_test_json_string_field_from_stdin revision)" "Repeated mirror changed the winning revision"
cli_test_assert_equal "$CONFLICT" "$(printf '%s' "$REPEATED_INFO" | cli_test_json_string_field_from_stdin conflicts)" "Repeated mirror created another conflict"

run_cli "$DB_DIR" --vault "$VAULT_DIR" --settings "$DB_SETTINGS" resolve "$UNKNOWN_PATH" "$LOCAL_REV"
RESOLVED_INFO="$(run_cli "$DB_DIR" --settings "$DB_SETTINGS" info "$UNKNOWN_PATH")"
cli_test_assert_equal "N/A" "$(printf '%s' "$RESOLVED_INFO" | cli_test_json_string_field_from_stdin conflicts)" "CLI resolve left a conflict"
cli_test_assert_equal "$LOCAL_REV" "$(printf '%s' "$RESOLVED_INFO" | cli_test_json_string_field_from_stdin revision)" "CLI resolve selected the wrong revision"
cli_test_assert_equal "unrelated local content" "$(cat "$VAULT_DIR/$UNKNOWN_PATH")" "CLI resolve did not reflect the selected content"
assert_pass "Unknown local content was preserved, deduplicated, and resolved through the CLI"

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
