#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_ROOT="${SCRIPT_DIR}/bench-results"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${RESULTS_ROOT}/${TIMESTAMP}"

mkdir -p "${OUT_DIR}"

echo "[bench-wrapper] output directory: ${OUT_DIR}"

echo "[bench-wrapper] running p2p benchmark"
(
  cd "${SCRIPT_DIR}"
  BENCH_RESULT_JSON="${OUT_DIR}/p2p.json" deno task bench:p2p
)

echo "[bench-wrapper] running couchdb benchmark with RTT ${BENCH_COUCHDB_RTT_MS:-default} ms (emulating HTTP network latency)"
(
  cd "${SCRIPT_DIR}"
  BENCH_RESULT_JSON="${OUT_DIR}/couchdb.json" deno task bench:couchdb
)

cat > "${OUT_DIR}/README.txt" <<EOF
Bench wrapper result set

Generated at: ${TIMESTAMP}
Directory: ${OUT_DIR}

Files:
- p2p.json
- couchdb.json
EOF

echo "[bench-wrapper] verify outputs by cat"
echo "========== ${OUT_DIR}/README.txt =========="
cat "${OUT_DIR}/README.txt"
echo "========== ${OUT_DIR}/p2p.json =========="
cat "${OUT_DIR}/p2p.json"
echo "========== ${OUT_DIR}/couchdb.json =========="
cat "${OUT_DIR}/couchdb.json"

echo "[bench-wrapper] done"
echo "[bench-wrapper] result directory: ${OUT_DIR}"
