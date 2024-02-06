#!/bin/bash
set -e
fly scale count 0 -y
fly apps destroy $(fly status -j | jq -r .Name) -y
