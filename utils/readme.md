# Utilities

These utilities support self-hosted CouchDB provisioning and Setup URI generation. They consume an exact immutable `@vrtmrz/livesync-commonlib` registry version declared in `livesync-commonlib-version.ts`; the utility lockfile records its resolved package integrity. This selection is independent of the plug-in's runtime dependency and advances only when the utility behaviour is revalidated against a newer package. The setup-tool test keeps the domain-specific static npm specifiers aligned with that declaration. Update the declaration, the two facades, and the lockfile together when selecting a newer release.

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

The generator creates a fresh random ID key by default and includes it in the encrypted Setup URI. It prints a tagged `sls-id-v1:` recovery code. Set `id_recovery_code` to that code when generating another URI for the same Vault; a new run without it creates a different key. This restores only the ID key: reuse the original connection details too. For P2P, provide the original `p2p_room_id` and `p2p_passphrase` because omitted values are generated afresh. Set `id_mode=legacy` to generate a URI with the previous ID behaviour. `id_mode=legacy` and `id_recovery_code` cannot be combined. Keep the recovery code private and retain it if every device might be lost.

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

The generator defaults to `uri_mode=ephemeral`. The URI opens only during the current fixed seven-day UTC window, and the tool prints its exact end time. It may have less than seven days remaining when generated. For an indefinitely reusable URI, set `uri_mode=persistent` before running the command. Persistent uses the existing encrypted format, which older clients that already support that format can read. The time condition controls opening the URI; it does not revoke settings or credentials after import.

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
