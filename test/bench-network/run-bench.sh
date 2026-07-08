#!/usr/bin/env sh
set -eu

case "${BENCH_COMMAND:-cases}" in
  cases)
    exec deno task bench:cases
    ;;
  latency-sweep)
    exec deno task bench:latency-sweep
    ;;
  *)
    echo "Unknown BENCH_COMMAND: ${BENCH_COMMAND}" >&2
    echo "Expected one of: cases, latency-sweep" >&2
    exit 2
    ;;
esac
