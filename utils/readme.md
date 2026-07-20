# Utilities

These utilities support self-hosted CouchDB provisioning and Setup URI generation. They consume the immutable `@vrtmrz/livesync-commonlib@0.1.0-rc.4` registry package directly; the utility lockfile records its resolved package integrity.

## CouchDB provisioning

`couchdb/couchdb-init.sh` is a Bash wrapper for the Deno provisioning tool. Deno 2 is required. The tool configures single-node CouchDB, authenticated access, CORS for Obsidian, and the request and document size limits used by Self-hosted LiveSync.

Set `database` to create a database as part of provisioning. The tool then uses Commonlib's database negotiation contract to initialise and verify the LiveSync database version. If `database` is omitted, only the CouchDB server is configured and the first LiveSync client remains responsible for creating its database.

```sh
export hostname=http://localhost:5984
export username=couchdb-admin-username
export password=couchdb-admin-password
export database=obsidiannotes
./couchdb/couchdb-init.sh
```

Optional variables are:

- `node`, which defaults to `_local`;
- `origins`, which defaults to the supported Obsidian desktop, mobile, and local origins;
- `retry_count`, which defaults to `12`; and
- `retry_delay_ms`, which defaults to `5000`.

Authentication and other non-retryable HTTP failures stop immediately. Network and server failures are retried within the configured bound.

## Setup URI generation

`setup/generate_setup_uri.ts` creates current CouchDB, Object Storage, and P2P configurations from Commonlib's new-Vault and remote-specific presets. It stores the connection as the selected remote profile and encodes the result with Commonlib's Setup URI contract. Set `remote_type` to `couchdb`, `s3`, or `p2p`; CouchDB is the default.

The existing `flyio/generate_setupuri.ts` path remains a CouchDB-only compatibility wrapper for the Fly.io deployment script.

### CouchDB

```sh
export hostname=https://couch.example.com
export username=couchdb-admin-username
export password=couchdb-admin-password
export database=obsidiannotes
export passphrase=a-strong-vault-encryption-passphrase
export uri_passphrase=a-separate-setup-uri-passphrase # Optional
deno run --minimum-dependency-age=0 --config=./flyio/deno.jsonc --frozen --lock=./flyio/deno.lock --allow-env ./setup/generate_setup_uri.ts
```

If `uri_passphrase` is omitted, the tool generates and prints a cryptographically random one. Store the Setup URI and its passphrase separately. The `passphrase` value protects synchronised Vault data and must also be stored safely.

### Object Storage

```sh
export remote_type=s3
export endpoint=https://objects.example.com
export access_key=<ACCESS KEY>
export secret_key=<SECRET KEY>
export bucket=vault-data
export region=auto
export bucket_prefix=team-a # Optional
export passphrase=<A STRONG VAULT ENCRYPTION PASSPHRASE>
deno run --minimum-dependency-age=0 --config=./flyio/deno.jsonc --frozen --lock=./flyio/deno.lock --allow-env ./setup/generate_setup_uri.ts
```

Optional Object Storage variables are `use_custom_request_handler`, `force_path_style`, and `bucket_custom_headers`.

### P2P

```sh
export remote_type=p2p
export passphrase=<A STRONG VAULT ENCRYPTION PASSPHRASE>
deno run --minimum-dependency-age=0 --config=./flyio/deno.jsonc --frozen --lock=./flyio/deno.lock --allow-env ./setup/generate_setup_uri.ts
```

If `p2p_room_id` or `p2p_passphrase` is omitted, the tool generates it with Commonlib's room-ID contract or cryptographically secure randomness. Optional variables are `p2p_relays`, `p2p_app_id`, `p2p_auto_start`, and `p2p_auto_broadcast`. Auto-start and auto-broadcast retain Commonlib's disabled defaults unless explicitly enabled. A peer name is deliberately absent because it identifies one device and must not be copied to another device through a Setup URI.

## Fly.io deployment

`flyio/deploy-server.sh` deploys CouchDB through `flyctl`, provisions the selected database through the tool above, and prints a Commonlib-generated Setup URI. Both `flyctl` and Deno 2 are required.

```sh
export region=nrt # Choose a nearby Fly.io region.
cd flyio
./deploy-server.sh
```

Set `appname`, `username`, `password`, `database`, `passphrase`, or `region` before running the script to override its generated values. Use `delete-server.sh` to remove the Fly.io application described by the generated `fly.toml`.
