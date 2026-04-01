#!/usr/bin/env bash
# Test: daemon-related ignore rules behaviour
#
# Tests that are runnable without a long-running daemon process are exercised
# here using the `mirror` command, which calls the same `isTargetFile` handler
# stack that the daemon uses.
#
# Covered cases:
#   1. .livesync/ignore with *.tmp pattern  → ignored file is NOT synced to DB
#   2. .livesync/ignore missing             → no error, normal sync continues
#   3. import: .gitignore directive         → patterns from .gitignore are merged
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
cli_test_init_cli_cmd

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-daemon-test.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

SETTINGS_FILE="$WORK_DIR/data.json"
VAULT_DIR="$WORK_DIR/vault"
mkdir -p "$VAULT_DIR/notes"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi

echo "[INFO] generating settings -> $SETTINGS_FILE"
cli_test_init_settings_file "$SETTINGS_FILE"
cli_test_mark_settings_configured "$SETTINGS_FILE"

PASS=0
FAIL=0

assert_pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
assert_fail() { echo "[FAIL] $1" >&2; FAIL=$((FAIL + 1)); }

# ─────────────────────────────────────────────────────────────────────────────
# Case 1: .livesync/ignore with *.tmp → matched file should NOT appear in DB
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 1: .livesync/ignore *.tmp → ignored file not synced to DB ==="

mkdir -p "$VAULT_DIR/.livesync"
printf '*.tmp\n' > "$VAULT_DIR/.livesync/ignore"

# Also write a normal file so we can confirm mirror ran at all.
printf 'normal content\n' > "$VAULT_DIR/notes/normal.md"
# Write the file that should be ignored.
printf 'tmp content\n' > "$VAULT_DIR/notes/scratch.tmp"

run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

# The normal file should be in the DB.
RESULT_NORMAL="$WORK_DIR/case1-normal.txt"
if run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" pull notes/normal.md "$RESULT_NORMAL" 2>/dev/null; then
    if cmp -s "$VAULT_DIR/notes/normal.md" "$RESULT_NORMAL"; then
        assert_pass "normal.md was synced to DB"
    else
        assert_fail "normal.md content mismatch after mirror"
    fi
else
    assert_fail "normal.md was not found in DB after mirror"
fi

# The .tmp file should NOT be in the DB.
DB_LIST="$WORK_DIR/case1-ls.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" ls > "$DB_LIST"
if grep -q "scratch.tmp" "$DB_LIST"; then
    assert_fail "scratch.tmp (ignored) was unexpectedly synced to DB"
    echo "--- DB listing ---" >&2; cat "$DB_LIST" >&2
else
    assert_pass "scratch.tmp (*.tmp pattern) was NOT synced to DB"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 2: .livesync/ignore absent → no error, normal sync continues
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 2: .livesync/ignore absent → no error, sync continues ==="

VAULT_DIR2="$WORK_DIR/vault2"
mkdir -p "$VAULT_DIR2/notes"
SETTINGS_FILE2="$WORK_DIR/data2.json"
cli_test_init_settings_file "$SETTINGS_FILE2"
cli_test_mark_settings_configured "$SETTINGS_FILE2"

# No .livesync directory at all.
printf 'hello\n' > "$VAULT_DIR2/notes/hello.md"

# mirror should succeed without error.
set +e
MIRROR_OUTPUT="$WORK_DIR/case2-mirror.txt"
run_cli "$VAULT_DIR2" --settings "$SETTINGS_FILE2" mirror >"$MIRROR_OUTPUT" 2>&1
MIRROR_EXIT=$?
set -e

if [[ "$MIRROR_EXIT" -ne 0 ]]; then
    assert_fail "mirror exited non-zero ($MIRROR_EXIT) when .livesync/ignore is absent"
    cat "$MIRROR_OUTPUT" >&2
else
    assert_pass "mirror succeeded when .livesync/ignore is absent"
fi

# The normal file should have been synced.
RESULT_HELLO="$WORK_DIR/case2-hello.txt"
if run_cli "$VAULT_DIR2" --settings "$SETTINGS_FILE2" pull notes/hello.md "$RESULT_HELLO" 2>/dev/null; then
    assert_pass "file synced normally when .livesync/ignore is absent"
else
    assert_fail "file was not synced when .livesync/ignore is absent"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Case 3: import: .gitignore merges patterns
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== Case 3: import: .gitignore directive merges patterns ==="

VAULT_DIR3="$WORK_DIR/vault3"
mkdir -p "$VAULT_DIR3/notes"
SETTINGS_FILE3="$WORK_DIR/data3.json"
cli_test_init_settings_file "$SETTINGS_FILE3"
cli_test_mark_settings_configured "$SETTINGS_FILE3"

mkdir -p "$VAULT_DIR3/.livesync"
printf 'import: .gitignore\n' > "$VAULT_DIR3/.livesync/ignore"
printf '# gitignore comment\n*.log\nbuild/\n' > "$VAULT_DIR3/.gitignore"

printf 'regular note\n' > "$VAULT_DIR3/notes/regular.md"
printf 'log content\n' > "$VAULT_DIR3/notes/debug.log"

run_cli "$VAULT_DIR3" --settings "$SETTINGS_FILE3" mirror

DB_LIST3="$WORK_DIR/case3-ls.txt"
run_cli "$VAULT_DIR3" --settings "$SETTINGS_FILE3" ls > "$DB_LIST3"

if grep -q "debug.log" "$DB_LIST3"; then
    assert_fail "debug.log (ignored via .gitignore import) was unexpectedly synced to DB"
    echo "--- DB listing ---" >&2; cat "$DB_LIST3" >&2
else
    assert_pass "debug.log (*.log from imported .gitignore) was NOT synced to DB"
fi

# regular.md should still be present.
if grep -q "regular.md" "$DB_LIST3"; then
    assert_pass "regular.md was synced normally alongside .gitignore import rules"
else
    assert_fail "regular.md was NOT synced — .gitignore import may have been too broad"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
