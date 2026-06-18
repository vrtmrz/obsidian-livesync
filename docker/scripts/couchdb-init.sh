#!/bin/sh
# Self-hosted LiveSync — CouchDB Initialization Script
# Runs once on first startup via the couchdb-init service.
# Configures single-node cluster, auth, CORS, and size limits.

set -e

hostname="${COUCHDB_INTERNAL_URL:-http://couchdb:5984}"
username="${COUCHDB_USER:?COUCHDB_USER is required}"
password="${COUCHDB_PASSWORD:?COUCHDB_PASSWORD is required}"
node="${COUCHDB_NODE:-_local}"

echo "==> Waiting for CouchDB at ${hostname} ..."
# _up is publicly accessible (no auth required) — safe pre-auth wait
until curl -sf "${hostname}/_up" 2>/dev/null | grep -q '"status":"ok"'; do
    printf '.'
    sleep 2
done
echo ""
echo "==> CouchDB is up. Initializing..."

# 1. Enable single-node cluster
curl -sf -X POST "${hostname}/_cluster_setup" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"enable_single_node\",\"username\":\"${username}\",\"password\":\"${password}\",\"bind_address\":\"0.0.0.0\",\"port\":5984,\"singlenode\":true}" \
    --user "${username}:${password}" && echo "[OK] cluster_setup"

# 2. Require valid user on both http interfaces
curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd/require_valid_user" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] chttpd/require_valid_user"

curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd_auth/require_valid_user" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] chttpd_auth/require_valid_user"

# 3. HTTP auth challenge header
curl -sf -X PUT "${hostname}/_node/${node}/_config/httpd/WWW-Authenticate" \
    -H "Content-Type: application/json" -d '"Basic realm=\"couchdb\""' --user "${username}:${password}" && echo "[OK] httpd/WWW-Authenticate"

# 4. Enable CORS on both http listeners
curl -sf -X PUT "${hostname}/_node/${node}/_config/httpd/enable_cors" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] httpd/enable_cors"

curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd/enable_cors" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] chttpd/enable_cors"

# 5. Increase size limits for large vaults
curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd/max_http_request_size" \
    -H "Content-Type: application/json" -d '"4294967296"' --user "${username}:${password}" && echo "[OK] chttpd/max_http_request_size"

curl -sf -X PUT "${hostname}/_node/${node}/_config/couchdb/max_document_size" \
    -H "Content-Type: application/json" -d '"50000000"' --user "${username}:${password}" && echo "[OK] couchdb/max_document_size"

# 6. CORS configuration — allow Obsidian app origins
curl -sf -X PUT "${hostname}/_node/${node}/_config/cors/credentials" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] cors/credentials"

curl -sf -X PUT "${hostname}/_node/${node}/_config/cors/origins" \
    -H "Content-Type: application/json" \
    -d '"app://obsidian.md,capacitor://localhost,http://localhost"' \
    --user "${username}:${password}" && echo "[OK] cors/origins"

# 7. Create the vault database if it doesn't exist
db="${COUCHDB_DATABASE:-obsidiannotes}"
set +e
status=$(curl -sf -o /dev/null -w "%{http_code}" --user "${username}:${password}" "${hostname}/${db}" 2>/dev/null)
curl_exit=$?
set -e

if [ "$status" = "200" ]; then
    echo "[OK] database '${db}' already exists"
else
    curl -sf -X PUT "${hostname}/${db}" --user "${username}:${password}" && echo "[OK] database '${db}' created" || echo "[WARN] database creation returned non-200 — may already exist"
fi

echo ""
echo "==> CouchDB initialization complete!"
echo "    URL      : ${hostname}"
echo "    Database : ${db}"
echo "    Username : ${username}"
