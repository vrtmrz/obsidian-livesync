#!/bin/bash
docker run -d --name relay-test -p 4000:8080 scsibug/nostr-rs-relay:latest
