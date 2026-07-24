#!/bin/bash
set -euo pipefail

fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT
cp "$(dirname "$0")/setenv.sh" "$(dirname "$0")/fly.template.toml" "$fixture_dir/"

(
    cd "$fixture_dir"
    appname=""
    username=""
    password=""
    database=""
    passphrase=""
    region=""
    source ./setenv.sh keep

    [[ "$password" =~ ^[A-Za-z0-9_-]{32}$ ]] || {
        echo "generated CouchDB password is not a 32-character base64url secret" >&2
        exit 1
    }
    [[ "$passphrase" =~ ^[A-Za-z0-9_-]{32}$ ]] || {
        echo "generated Vault encryption passphrase is not a 32-character base64url secret" >&2
        exit 1
    }
)
