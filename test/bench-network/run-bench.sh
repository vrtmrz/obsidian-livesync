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
  *)
    echo "Unknown BENCH_COMMAND: ${BENCH_COMMAND}" >&2
    echo "Expected one of: cases, latency-sweep, p2p-split-node" >&2
    exit 2
    ;;
esac
