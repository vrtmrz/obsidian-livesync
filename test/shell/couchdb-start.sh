#!/bin/bash
set -e
docker run -d --name couchdb-test -p 5989:5984 -e COUCHDB_USER=$username -e COUCHDB_PASSWORD=$password couchdb:3.5.0