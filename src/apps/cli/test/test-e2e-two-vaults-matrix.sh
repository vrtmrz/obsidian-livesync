#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

RUN_BUILD="${RUN_BUILD:-1}"
KEEP_TEST_DATA="${KEEP_TEST_DATA:-0}"
TEST_ENV_FILE="${TEST_ENV_FILE:-$(cd -- "$SCRIPT_DIR/.." && pwd)/.test.env}"

run_case() {
    local remote_type="$1"
    local encrypt="$2"
    local label="${remote_type}-enc${encrypt}"

    echo "[INFO] ===== CASE START: $label ====="
    REMOTE_TYPE="$remote_type" \
    ENCRYPT="$encrypt" \
    RUN_BUILD="$RUN_BUILD" \
    KEEP_TEST_DATA="$KEEP_TEST_DATA" \
    TEST_ENV_FILE="$TEST_ENV_FILE" \
    TEST_LABEL="$label" \
    bash "$SCRIPT_DIR/test-e2e-two-vaults-common.sh"
    echo "[INFO] ===== CASE PASS: $label ====="
}

run_case COUCHDB 0
run_case COUCHDB 1
run_case MINIO 0
run_case MINIO 1

echo "[PASS] all matrix cases completed"
