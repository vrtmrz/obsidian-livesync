#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

REMOTE_TYPE="${REMOTE_TYPE:-COUCHDB}" \
ENCRYPT="${ENCRYPT:-0}" \
TEST_LABEL="${TEST_LABEL:-${REMOTE_TYPE}-enc${ENCRYPT}}" \
bash "$SCRIPT_DIR/test-e2e-two-vaults-common.sh"