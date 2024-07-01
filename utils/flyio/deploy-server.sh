#!/bin/bash
## Script for deploy and automatic setup CouchDB onto fly.io.
## We need Deno for generating the Setup-URI.

source setenv.sh $@

export hostname="https://$appname.fly.dev"

echo "-- YOUR CONFIGURATION --"
echo "URL     : $hostname"
echo "username: $username"
echo "password: $password"
echo "region  : $region"
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
    echo "Setup finished! Also, we can set up Self-hosted LiveSync instantly, by the following setup uri."
    echo "Passphrase of setup-uri will be printed only one time. Keep it safe!"
    echo "--- configured ---"
    echo "database       : ${database}"
    echo "E2EE passphrase: ${passphrase}"
    echo "--- setup uri  ---"
    deno run -A generate_setupuri.ts
else
    echo "Setup finished! Here is the configured values (reprise)!"
    echo "-- YOUR CONFIGURATION --"
    echo "URL     : $hostname"
    echo "username: $username"
    echo "password: $password"
    echo "-- YOUR CONFIGURATION --"
    echo "If we had Deno, we would got the setup uri directly!"
fi
