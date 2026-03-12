#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$CLI_DIR/../../.." && pwd)"
cd "$CLI_DIR"

CLI_CMD=(npm run cli --)
RUN_BUILD="${RUN_BUILD:-1}"
REMOTE_PATH="${REMOTE_PATH:-test/setup-put-cat.txt}"
SETUP_PASSPHRASE="${SETUP_PASSPHRASE:-setup-passphrase}"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-test.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

SETTINGS_FILE="${1:-$WORK_DIR/data.json}"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi

run_cli() {
    "${CLI_CMD[@]}" "$@"
}

echo "[INFO] generating settings from DEFAULT_SETTINGS -> $SETTINGS_FILE"
run_cli init-settings --force "$SETTINGS_FILE"

echo "[INFO] creating setup URI from settings"
SETUP_URI="$(
    REPO_ROOT="$REPO_ROOT" SETTINGS_FILE="$SETTINGS_FILE" SETUP_PASSPHRASE="$SETUP_PASSPHRASE" npx tsx -e '
import fs from "node:fs";
(async () => {
    const { encodeSettingsToSetupURI } = await import(process.env.REPO_ROOT + "/src/lib/src/API/processSetting.ts");
    const settingsPath = process.env.SETTINGS_FILE;
    const setupPassphrase = process.env.SETUP_PASSPHRASE;
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    settings.couchDB_DBNAME = "setup-put-cat-db";
    settings.couchDB_URI = "http://127.0.0.1:5999";
    settings.couchDB_USER = "dummy";
    settings.couchDB_PASSWORD = "dummy";
    settings.liveSync = false;
    settings.syncOnStart = false;
    settings.syncOnSave = false;
    const uri = await encodeSettingsToSetupURI(settings, setupPassphrase);
    process.stdout.write(uri.trim());
})();
'
)"

VAULT_DIR="$WORK_DIR/vault"
mkdir -p "$VAULT_DIR/test"

echo "[INFO] applying setup URI"
SETUP_LOG="$WORK_DIR/setup-output.log"
set +e
printf '%s\n' "$SETUP_PASSPHRASE" | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" setup "$SETUP_URI" \
    >"$SETUP_LOG" 2>&1
SETUP_EXIT=$?
set -e
cat "$SETUP_LOG"
if [[ "$SETUP_EXIT" -ne 0 ]]; then
    echo "[FAIL] setup command exited with $SETUP_EXIT" >&2
    exit 1
fi

if grep -Fq "[Command] setup ->" "$SETUP_LOG"; then
    echo "[PASS] setup command executed"
else
    echo "[FAIL] setup command did not execute expected code path" >&2
    exit 1
fi

SRC_FILE="$WORK_DIR/put-source.txt"
printf 'setup-put-cat-test %s\nline-2\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SRC_FILE"

echo "[INFO] put -> $REMOTE_PATH"
cat "$SRC_FILE" | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put "$REMOTE_PATH"

echo "[INFO] cat <- $REMOTE_PATH"
CAT_OUTPUT="$WORK_DIR/cat-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" cat "$REMOTE_PATH" > "$CAT_OUTPUT"

CAT_OUTPUT_CLEAN="$WORK_DIR/cat-output-clean.txt"
grep -v '^\[CLIWatchAdapter\] File watching is not enabled in CLI version$' "$CAT_OUTPUT" > "$CAT_OUTPUT_CLEAN" || true

if cmp -s "$SRC_FILE" "$CAT_OUTPUT_CLEAN"; then
    echo "[PASS] setup/put/cat roundtrip matched"
else
    echo "[FAIL] setup/put/cat roundtrip mismatch" >&2
    echo "--- source ---" >&2
    cat "$SRC_FILE" >&2
    echo "--- cat-output ---" >&2
    cat "$CAT_OUTPUT_CLEAN" >&2
    exit 1
fi

echo "[INFO] ls $REMOTE_PATH"
LS_OUTPUT="$WORK_DIR/ls-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" ls "$REMOTE_PATH" > "$LS_OUTPUT"

LS_LINE="$(grep -F "$REMOTE_PATH" "$LS_OUTPUT" | head -n 1 || true)"
if [[ -z "$LS_LINE" ]]; then
    echo "[FAIL] ls output did not include target path" >&2
    cat "$LS_OUTPUT" >&2
    exit 1
fi

IFS=$'\t' read -r LS_PATH LS_SIZE LS_MTIME LS_REV <<< "$LS_LINE"
if [[ "$LS_PATH" != "$REMOTE_PATH" ]]; then
    echo "[FAIL] ls path column mismatch: $LS_PATH" >&2
    exit 1
fi
if [[ ! "$LS_SIZE" =~ ^[0-9]+$ ]]; then
    echo "[FAIL] ls size column is not numeric: $LS_SIZE" >&2
    exit 1
fi
if [[ ! "$LS_MTIME" =~ ^[0-9]+$ ]]; then
    echo "[FAIL] ls mtime column is not numeric: $LS_MTIME" >&2
    exit 1
fi
if [[ -z "$LS_REV" ]]; then
    echo "[FAIL] ls revision column is empty" >&2
    exit 1
fi
echo "[PASS] ls output format matched"

echo "[INFO] adding more files for ls test cases"
printf 'file-a\n' | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put test/a-first.txt >/dev/null
printf 'file-z\n' | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put test/z-last.txt >/dev/null

echo "[INFO] ls test/ (prefix filter and sorting)"
LS_PREFIX_OUTPUT="$WORK_DIR/ls-prefix-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" ls test/ > "$LS_PREFIX_OUTPUT"

if [[ "$(wc -l < "$LS_PREFIX_OUTPUT")" -lt 3 ]]; then
    echo "[FAIL] ls prefix output expected at least 3 rows" >&2
    cat "$LS_PREFIX_OUTPUT" >&2
    exit 1
fi

FIRST_PATH="$(cut -f1 "$LS_PREFIX_OUTPUT" | sed -n '1p')"
SECOND_PATH="$(cut -f1 "$LS_PREFIX_OUTPUT" | sed -n '2p')"
if [[ "$FIRST_PATH" > "$SECOND_PATH" ]]; then
    echo "[FAIL] ls output is not sorted by path" >&2
    cat "$LS_PREFIX_OUTPUT" >&2
    exit 1
fi

if ! grep -Fq $'test/a-first.txt\t' "$LS_PREFIX_OUTPUT"; then
    echo "[FAIL] ls prefix output missing test/a-first.txt" >&2
    cat "$LS_PREFIX_OUTPUT" >&2
    exit 1
fi
if ! grep -Fq $'test/z-last.txt\t' "$LS_PREFIX_OUTPUT"; then
    echo "[FAIL] ls prefix output missing test/z-last.txt" >&2
    cat "$LS_PREFIX_OUTPUT" >&2
    exit 1
fi
echo "[PASS] ls prefix and sorting matched"

echo "[INFO] ls no-match prefix"
LS_EMPTY_OUTPUT="$WORK_DIR/ls-empty-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" ls no-such-prefix/ > "$LS_EMPTY_OUTPUT"
if [[ -s "$LS_EMPTY_OUTPUT" ]]; then
    echo "[FAIL] ls no-match prefix should produce empty output" >&2
    cat "$LS_EMPTY_OUTPUT" >&2
    exit 1
fi
echo "[PASS] ls no-match prefix matched"

echo "[INFO] info $REMOTE_PATH"
INFO_OUTPUT="$WORK_DIR/info-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" info "$REMOTE_PATH" > "$INFO_OUTPUT"

# Check required label lines
for label in "ID:" "Revision:" "Conflicts:" "Filename:" "Path:" "Size:" "Chunks:"; do
    if ! grep -q "^$label" "$INFO_OUTPUT"; then
        echo "[FAIL] info output missing label: $label" >&2
        cat "$INFO_OUTPUT" >&2
        exit 1
    fi
done

# Path value must match
INFO_PATH="$(grep '^Path:' "$INFO_OUTPUT" | sed 's/^Path:[[:space:]]*//')"
if [[ "$INFO_PATH" != "$REMOTE_PATH" ]]; then
    echo "[FAIL] info Path mismatch: $INFO_PATH" >&2
    exit 1
fi

# Filename must be the basename
INFO_FILENAME="$(grep '^Filename:' "$INFO_OUTPUT" | sed 's/^Filename:[[:space:]]*//')"
EXPECTED_FILENAME="$(basename "$REMOTE_PATH")"
if [[ "$INFO_FILENAME" != "$EXPECTED_FILENAME" ]]; then
    echo "[FAIL] info Filename mismatch: $INFO_FILENAME != $EXPECTED_FILENAME" >&2
    exit 1
fi

# Size must be numeric
INFO_SIZE="$(grep '^Size:' "$INFO_OUTPUT" | sed 's/^Size:[[:space:]]*//')"
if [[ ! "$INFO_SIZE" =~ ^[0-9]+$ ]]; then
    echo "[FAIL] info Size is not numeric: $INFO_SIZE" >&2
    exit 1
fi

# Chunks count must be numeric and ≥1
INFO_CHUNKS="$(grep '^Chunks:' "$INFO_OUTPUT" | sed 's/^Chunks:[[:space:]]*//')"
if [[ ! "$INFO_CHUNKS" =~ ^[0-9]+$ ]] || [[ "$INFO_CHUNKS" -lt 1 ]]; then
    echo "[FAIL] info Chunks is not a positive integer: $INFO_CHUNKS" >&2
    exit 1
fi

# Conflicts should be N/A (no live CouchDB)
INFO_CONFLICTS="$(grep '^Conflicts:' "$INFO_OUTPUT" | sed 's/^Conflicts:[[:space:]]*//')"
if [[ "$INFO_CONFLICTS" != "N/A" ]]; then
    echo "[FAIL] info Conflicts expected N/A, got: $INFO_CONFLICTS" >&2
    exit 1
fi

echo "[PASS] info output format matched"

echo "[INFO] info non-existent path"
INFO_MISSING_EXIT=0
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" info no-such-file.md > /dev/null || INFO_MISSING_EXIT=$?
if [[ "$INFO_MISSING_EXIT" -eq 0 ]]; then
    echo "[FAIL] info on non-existent file should exit non-zero" >&2
    exit 1
fi
echo "[PASS] info non-existent path returns non-zero"

echo "[INFO] rm test/z-last.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" rm test/z-last.txt > /dev/null

RM_CAT_EXIT=0
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" cat test/z-last.txt > /dev/null || RM_CAT_EXIT=$?
if [[ "$RM_CAT_EXIT" -eq 0 ]]; then
    echo "[FAIL] rm target should not be readable by cat" >&2
    exit 1
fi

LS_AFTER_RM="$WORK_DIR/ls-after-rm.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" ls test/ > "$LS_AFTER_RM"
if grep -Fq $'test/z-last.txt\t' "$LS_AFTER_RM"; then
    echo "[FAIL] rm target should not appear in ls output" >&2
    cat "$LS_AFTER_RM" >&2
    exit 1
fi
echo "[PASS] rm removed target from visible entries"

echo "[INFO] resolve test/a-first.txt using current revision"
RESOLVE_LS_LINE="$(run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" ls test/a-first.txt | head -n 1)"
if [[ -z "$RESOLVE_LS_LINE" ]]; then
    echo "[FAIL] could not fetch revision for resolve test" >&2
    exit 1
fi
IFS=$'\t' read -r _ _ _ RESOLVE_REV <<< "$RESOLVE_LS_LINE"
if [[ -z "$RESOLVE_REV" ]]; then
    echo "[FAIL] revision was empty for resolve test" >&2
    exit 1
fi

run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" resolve test/a-first.txt "$RESOLVE_REV" > /dev/null
echo "[PASS] resolve accepted current revision"

echo "[INFO] resolve with non-existent revision"
RESOLVE_BAD_EXIT=0
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" resolve test/a-first.txt 9-no-such-rev > /dev/null || RESOLVE_BAD_EXIT=$?
if [[ "$RESOLVE_BAD_EXIT" -eq 0 ]]; then
    echo "[FAIL] resolve with non-existent revision should exit non-zero" >&2
    exit 1
fi
echo "[PASS] resolve non-existent revision returns non-zero"

echo "[INFO] preparing revision history for cat-rev test"
REV_PATH="test/revision-history.txt"
REV_V1_FILE="$WORK_DIR/rev-v1.txt"
REV_V2_FILE="$WORK_DIR/rev-v2.txt"
REV_V3_FILE="$WORK_DIR/rev-v3.txt"

printf 'revision-v1\n' > "$REV_V1_FILE"
printf 'revision-v2\n' > "$REV_V2_FILE"
printf 'revision-v3\n' > "$REV_V3_FILE"

cat "$REV_V1_FILE" | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put "$REV_PATH" > /dev/null
cat "$REV_V2_FILE" | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put "$REV_PATH" > /dev/null
cat "$REV_V3_FILE" | run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" put "$REV_PATH" > /dev/null

echo "[INFO] info $REV_PATH (past revisions)"
REV_INFO_OUTPUT="$WORK_DIR/rev-info-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" info "$REV_PATH" > "$REV_INFO_OUTPUT"

PAST_REV="$(grep '^  rev: ' "$REV_INFO_OUTPUT" | head -n 1 | sed 's/^  rev: //')"
if [[ -z "$PAST_REV" ]]; then
    echo "[FAIL] info output did not include any past revision" >&2
    cat "$REV_INFO_OUTPUT" >&2
    exit 1
fi

echo "[INFO] cat-rev $REV_PATH @ $PAST_REV"
REV_CAT_OUTPUT="$WORK_DIR/rev-cat-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" cat-rev "$REV_PATH" "$PAST_REV" > "$REV_CAT_OUTPUT"

if cmp -s "$REV_CAT_OUTPUT" "$REV_V1_FILE" || cmp -s "$REV_CAT_OUTPUT" "$REV_V2_FILE"; then
    echo "[PASS] cat-rev matched one of the past revisions from info"
else
    echo "[FAIL] cat-rev output did not match expected past revisions" >&2
    echo "--- info output ---" >&2
    cat "$REV_INFO_OUTPUT" >&2
    echo "--- cat-rev output ---" >&2
    cat "$REV_CAT_OUTPUT" >&2
    echo "--- expected v1 ---" >&2
    cat "$REV_V1_FILE" >&2
    echo "--- expected v2 ---" >&2
    cat "$REV_V2_FILE" >&2
    exit 1
fi

echo "[INFO] pull-rev $REV_PATH @ $PAST_REV"
REV_PULL_OUTPUT="$WORK_DIR/rev-pull-output.txt"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" pull-rev "$REV_PATH" "$REV_PULL_OUTPUT" "$PAST_REV" > /dev/null

if cmp -s "$REV_PULL_OUTPUT" "$REV_V1_FILE" || cmp -s "$REV_PULL_OUTPUT" "$REV_V2_FILE"; then
    echo "[PASS] pull-rev matched one of the past revisions from info"
else
    echo "[FAIL] pull-rev output did not match expected past revisions" >&2
    echo "--- info output ---" >&2
    cat "$REV_INFO_OUTPUT" >&2
    echo "--- pull-rev output ---" >&2
    cat "$REV_PULL_OUTPUT" >&2
    echo "--- expected v1 ---" >&2
    cat "$REV_V1_FILE" >&2
    echo "--- expected v2 ---" >&2
    cat "$REV_V2_FILE" >&2
    exit 1
fi
