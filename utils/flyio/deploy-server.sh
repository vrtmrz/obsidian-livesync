#!/bin/bash
## Script for deploy and automatic setup CouchDB onto fly.io.
## We need Deno for generating the Setup-URI.

source setenv.sh $@

export hostname="https://$appname.fly.dev"

echo "-- YOUR CONFIGURATION --"
echo "URL     : $hostname"
echo "Username: $username"
echo "Password: $password"
echo "Region  : $region"
echo ""
echo "-- START DEPLOYING --> "

set -e
fly launch --name=$appname --env="COUCHDB_USER=$username" --copy-config=true --detach --no-deploy --region ${region} --yes
fly secrets set COUCHDB_PASSWORD=$password
fly deploy

set +e
../couchdb/couchdb-init.sh
# flyctl deploy
echo "OK!"

if command -v deno >/dev/null 2>&1; then
    echo "Setup finished! You can automatically set up LiveSync using the Setup URI below."
    echo "The Setup URI passphrase will only be printed once. Keep it safe!"
    echo "--- Values ---"
    echo "Database       : ${database}"
    echo "E2EE passphrase: ${passphrase}"
    echo "--- Setup URI ---"
    deno run -A generate_setupuri.ts
else
    echo "Setup finished! Here are the configured values (reprise)!"
    echo "-- YOUR CONFIGURATION --"
    echo "URL     : $hostname"
    echo "Username: $username"
    echo "Password: $password"
    echo "-- YOUR CONFIGURATION --"
    echo "Deno was not installed, so the automatic Setup URI could not be generated."
    echo "The values above can be used to manually configure LiveSync."
fi
