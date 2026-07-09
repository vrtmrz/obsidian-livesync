#!/usr/bin/env sh
set -eu

case "${BENCH_COMMAND:-cases}" in
  cases)
    exec deno task bench:cases
    ;;
  latency-sweep)
    exec deno task bench:latency-sweep
    ;;
  p2p-split-node)
    exec deno task bench:p2p-split-node
    ;;
  cli-p2p-e2e)
    exec deno task "${CLI_P2P_E2E_TASK:-test:p2p-sync}"
    ;;
  *)
    echo "Unknown BENCH_COMMAND: ${BENCH_COMMAND}" >&2
    echo "Expected one of: cases, latency-sweep, p2p-split-node, cli-p2p-e2e" >&2
    exit 2
    ;;
esac
