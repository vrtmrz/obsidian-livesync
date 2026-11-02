#!/usr/bin/env sh
set -eu

case "${BENCH_COMMAND:-cases}" in
  cases)
    exec node run-task.ts bench:cases
    ;;
  latency-sweep)
    exec node run-task.ts bench:latency-sweep
    ;;
  compression)
    exec node run-task.ts bench:compression
    ;;
  p2p-split-node)
    exec node run-task.ts bench:p2p-split-node
    ;;
  *)
    echo "Unknown BENCH_COMMAND: ${BENCH_COMMAND}" >&2
    echo "Expected one of: cases, latency-sweep, compression, p2p-split-node" >&2
    exit 2
    ;;
esac
