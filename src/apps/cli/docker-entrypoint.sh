#!/bin/sh
# Entrypoint wrapper for the Self-hosted LiveSync CLI Docker image.
#
# By default, /data is used as the database-path (the vault mount point).
# Override this via the LIVESYNC_DB_PATH environment variable.
#
# Examples:
#   docker run -v /path/to/vault:/data livesync-cli sync
#   docker run -v /path/to/vault:/data livesync-cli --settings /data/.livesync/settings.json sync
#   docker run -v /path/to/vault:/data livesync-cli init-settings
#   docker run -e LIVESYNC_DB_PATH=/vault -v /path/to/vault:/vault livesync-cli sync

set -e

case "${1:-}" in
    init-settings | --help | -h | "")
        # Commands that do not require a leading database-path argument
        exec node /app/dist/index.cjs "$@"
        ;;
    *)
        # All other commands: prepend the database-path so users only need
        # to supply the command and its options.
        exec node /app/dist/index.cjs "${LIVESYNC_DB_PATH:-/data}" "$@"
        ;;
esac
