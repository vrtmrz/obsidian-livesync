#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
REMOTE_PATH="${REMOTE_PATH:-test/push-pull-decoupled.txt}"
cli_test_init_cli_cmd

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livesync-cli-test.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

SETTINGS_FILE="${1:-$WORK_DIR/data.json}"

if [[ "$RUN_BUILD" == "1" ]]; then
    echo "[INFO] building CLI..."
    npm run build
fi

echo "[INFO] generating settings from DEFAULT_SETTINGS -> $SETTINGS_FILE"
cli_test_init_settings_file "$SETTINGS_FILE"

if [[ -n "${COUCHDB_URI:-}" && -n "${COUCHDB_USER:-}" && -n "${COUCHDB_PASSWORD:-}" && -n "${COUCHDB_DBNAME:-}" ]]; then
    echo "[INFO] applying CouchDB env vars to generated settings"
    cli_test_apply_couchdb_settings "$SETTINGS_FILE" "$COUCHDB_URI" "$COUCHDB_USER" "$COUCHDB_PASSWORD" "$COUCHDB_DBNAME"
else
    echo "[WARN] CouchDB env vars are not fully set. push/pull may fail unless generated settings are updated."
    cli_test_mark_settings_configured "$SETTINGS_FILE"
fi

VAULT_DIR="$WORK_DIR/vault"
DB_DIR="$WORK_DIR/db"
mkdir -p "$VAULT_DIR/test"
mkdir -p "$DB_DIR"

SRC_FILE="$WORK_DIR/push-source.txt"
PULLED_FILE="$WORK_DIR/pull-result.txt"
printf 'push-pull-decoupled-test %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SRC_FILE"

# 1. Test push command with decoupled vault directory
echo "[INFO] push with decoupled vault -> $REMOTE_PATH"
run_cli "$DB_DIR" --vault "$VAULT_DIR" --settings "$SETTINGS_FILE" push "$SRC_FILE" "$REMOTE_PATH"

# 2. Test pull command with decoupled vault directory
echo "[INFO] pull with decoupled vault <- $REMOTE_PATH"
run_cli "$DB_DIR" --vault "$VAULT_DIR" --settings "$SETTINGS_FILE" pull "$REMOTE_PATH" "$PULLED_FILE"

if cmp -s "$SRC_FILE" "$PULLED_FILE"; then
    echo "[PASS] push/pull roundtrip with decoupled vault matched"
else
    echo "[FAIL] push/pull roundtrip with decoupled vault mismatch" >&2
    echo "--- source ---" >&2
    cat "$SRC_FILE" >&2
    echo "--- pulled ---" >&2
    cat "$PULLED_FILE" >&2
    exit 1
fi

# 3. Clean up pulled file and vault test directory to verify mirror
rm -f "$PULLED_FILE"
rm -rf "$VAULT_DIR/test"

# 4. Test mirror command with decoupled vault directory
echo "[INFO] mirror with decoupled vault"
run_cli "$DB_DIR" --vault "$VAULT_DIR" --settings "$SETTINGS_FILE" mirror

RESTORED_FILE="$VAULT_DIR/$REMOTE_PATH"
if cmp -s "$SRC_FILE" "$RESTORED_FILE"; then
    echo "[PASS] mirror with decoupled vault matched"
else
    echo "[FAIL] mirror with decoupled vault mismatch" >&2
    echo "--- source ---" >&2
    cat "$SRC_FILE" >&2
    echo "--- mirrored/restored ---" >&2
    cat "$RESTORED_FILE" 2>/dev/null || echo "<none>" >&2
    exit 1
fi

echo "[PASS] decoupled database/vault E2E tests successfully completed"
