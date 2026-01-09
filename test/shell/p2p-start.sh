#!/bin/bash
set -e
script_dir=$(dirname "$0")
webpeer_dir=$script_dir/../../src/lib/apps/webpeer

docker run -d --name relay-test -p 4000:8080 scsibug/nostr-rs-relay:latest
npm run --prefix $webpeer_dir build
docker run -d --name webpeer-test -p 8081:8043 -v $webpeer_dir/dist:/srv/http pierrezemb/gostatic