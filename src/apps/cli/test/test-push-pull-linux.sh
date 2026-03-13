#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CLI_DIR"
source "$SCRIPT_DIR/test-helpers.sh"
display_test_info

RUN_BUILD="${RUN_BUILD:-1}"
REMOTE_PATH="${REMOTE_PATH:-test/push-pull.txt}"
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
fi

VAULT_DIR="$WORK_DIR/vault"
mkdir -p "$VAULT_DIR/test"

SRC_FILE="$WORK_DIR/push-source.txt"
PULLED_FILE="$WORK_DIR/pull-result.txt"
printf 'push-pull-test %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SRC_FILE"

echo "[INFO] push -> $REMOTE_PATH"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" push "$SRC_FILE" "$REMOTE_PATH"

echo "[INFO] pull <- $REMOTE_PATH"
run_cli "$VAULT_DIR" --settings "$SETTINGS_FILE" pull "$REMOTE_PATH" "$PULLED_FILE"

if cmp -s "$SRC_FILE" "$PULLED_FILE"; then
    echo "[PASS] push/pull roundtrip matched"
else
    echo "[FAIL] push/pull roundtrip mismatch" >&2
    echo "--- source ---" >&2
    cat "$SRC_FILE" >&2
    echo "--- pulled ---" >&2
    cat "$PULLED_FILE" >&2
    exit 1
fi
