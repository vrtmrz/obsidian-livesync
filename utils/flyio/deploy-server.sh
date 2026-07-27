#!/bin/bash
## Script for deploy and automatic setup CouchDB onto fly.io.
## Deno is used for Commonlib-backed provisioning and Setup URI generation.

set -euo pipefail

if ! command -v deno >/dev/null 2>&1; then
    echo "ERROR: Deno 2 is required for CouchDB provisioning and Setup URI generation." >&2
    exit 1
fi

source setenv.sh "$@"

export hostname="https://$appname.fly.dev"

echo "-- YOUR CONFIGURATION --"
echo "URL     : $hostname"
echo "username: $username"
echo "password: $password"
echo "region  : $region"
echo ""
echo "-- START DEPLOYING --> "

fly launch --name=$appname --env="COUCHDB_USER=$username" --copy-config=true --detach --no-deploy --region ${region} --yes
fly secrets set COUCHDB_PASSWORD=$password
fly deploy

../couchdb/couchdb-init.sh
echo "OK!"

echo "Setup finished. The Commonlib-generated Setup URI follows."
echo "Its passphrase is printed only once, so store it safely."
echo "--- configured ---"
echo "database: ${database}"
echo "--- setup URI ---"
deno run --minimum-dependency-age=0 --allow-env generate_setupuri.ts
