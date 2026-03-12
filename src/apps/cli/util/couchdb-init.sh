#!/bin/bash
set -euo pipefail

if [[ -z "${hostname:-}" ]]; then
    echo "ERROR: Hostname missing"
    exit 1
fi
if [[ -z "${username:-}" ]]; then
    echo "ERROR: Username missing"
    exit 1
fi

if [[ -z "${password:-}" ]]; then
    echo "ERROR: Password missing"
    exit 1
fi
if [[ -z "${node:-}" ]]; then
    echo "INFO: defaulting to _local"
    node=_local
fi

hostname="${hostname%/}"
# Podman environments often resolve localhost to ::1 while published ports are IPv4-only.
hostname="${hostname/localhost/127.0.0.1}"

curl_json() {
    curl -4 -sS --fail --connect-timeout 3 --max-time 15 "$@"
}

echo "-- Configuring CouchDB by REST APIs... -->"
echo "    Hostname: $hostname"
echo "    Username: $username"

until (curl_json -X POST "${hostname}/_cluster_setup" -H "Content-Type: application/json" -d "{\"action\":\"enable_single_node\",\"username\":\"${username}\",\"password\":\"${password}\",\"bind_address\":\"0.0.0.0\",\"port\":5984,\"singlenode\":true}" --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/chttpd/require_valid_user" -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/chttpd_auth/require_valid_user" -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/httpd/WWW-Authenticate" -H "Content-Type: application/json" -d '"Basic realm=\"couchdb\""' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/httpd/enable_cors" -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/chttpd/enable_cors" -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/chttpd/max_http_request_size" -H "Content-Type: application/json" -d '"4294967296"' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/couchdb/max_document_size" -H "Content-Type: application/json" -d '"50000000"' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/cors/credentials" -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}"); do sleep 5; done
until (curl_json -X PUT "${hostname}/_node/${node}/_config/cors/origins" -H "Content-Type: application/json" -d '"*"' --user "${username}:${password}"); do sleep 5; done

# Create test database  
until (curl_json -X PUT --user "${username}:${password}" "${hostname}/${dbname}" >/dev/null); do sleep 5; done
echo "<-- Configuring CouchDB by REST APIs Done!"
