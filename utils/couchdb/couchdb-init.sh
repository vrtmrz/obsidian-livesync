#!/bin/bash
set -euo pipefail

if ! command -v deno >/dev/null 2>&1; then
    echo "ERROR: Deno is required to run the Commonlib-backed CouchDB provisioning tool." >&2
    exit 1
fi

script_url="${provision_script_url:-https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/couchdb/provision.ts}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
deno_dependency_options=()
if [[ -n "$script_dir" && -f "$script_dir/provision.ts" ]]; then
    script_url="$script_dir/provision.ts"
    lockfile="$script_dir/../flyio/deno.lock"
    deno_config="$script_dir/../flyio/deno.jsonc"
    if [[ -f "$lockfile" && -f "$deno_config" ]]; then
        deno_dependency_options+=("--config=$deno_config" --frozen "--lock=$lockfile")
    fi
fi

exec deno run \
    --minimum-dependency-age=0 \
    "${deno_dependency_options[@]}" \
    --allow-env \
    --allow-net \
    "$script_url"
