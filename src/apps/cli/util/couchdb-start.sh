#!/bin/bash
set -e
echo "username: $username"
docker run -d --name couchdb-test -p 5989:5984 -e COUCHDB_USER=$username -e COUCHDB_PASSWORD=$password -e COUCHDB_SINGLE_NODE=y couchdb:3.5.0