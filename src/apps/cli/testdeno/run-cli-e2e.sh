#!/usr/bin/env sh
set -eu

TASK="${CLI_E2E_TASK:-test:p2p-sync}"

case "$TASK" in
  test:p2p-host|test:p2p-peers|test:p2p-sync|test:p2p-three-nodes|test:p2p-upload-download)
    exec deno task "$TASK"
    ;;
  *)
    echo "Unknown CLI_E2E_TASK: $TASK" >&2
    echo "Expected one of: test:p2p-host, test:p2p-peers, test:p2p-sync, test:p2p-three-nodes, test:p2p-upload-download" >&2
    exit 2
    ;;
esac
