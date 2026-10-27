# Self-hosted LiveSync — Docker Setup

A fully self-hosted CouchDB stack for the [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) plugin.  
**No fly.io. No IBM Cloudant. No cloud accounts required for basic use.**

The optional [Coturn Compose starter](coturn/README.md) is a separate Linux-only service for P2P connectivity. It is not part of the CouchDB stack below.

> ✅ **Tested on Docker Desktop for Windows (Docker 29.2, Compose v5, WSL2 backend)** — full init, CORS, auth, and idempotent restart verified.

---

## Architecture

```
Obsidian (desktop / iOS / Android)
        │  CouchDB Replication Protocol (HTTPS)
        ▼
[ Reverse Proxy / Tunnel ]  ◄── Choose ONE profile below
        │
        ▼
[ CouchDB container ]  ◄── The only required service
        │  initialized once by couchdb-init container
        ▼
[ Named Docker Volume ]  ◄── All vault data stored here
```

---

## Quick Start

### 1. Prerequisites

- [Docker Desktop](https://docs.docker.com/desktop/) (Windows/Mac/Linux) or Docker Engine + Compose plugin
- A machine that Obsidian devices can reach over HTTPS (see profiles below)

### 2. Configure

```bash
cd docker/
cp .env.example .env
# Edit .env — at minimum set COUCHDB_USER and a strong COUCHDB_PASSWORD
```

### 3. Launch

```bash
# Default: CouchDB only (LAN / localhost, no TLS)
docker compose up -d

# With Caddy (public domain + auto Let's Encrypt)
docker compose --profile caddy up -d

# With Tailscale (no domain needed, private mesh or public Funnel)
docker compose --profile tailscale up -d

# With Cloudflare Tunnel (Cloudflare account required)
docker compose --profile cloudflare up -d
```

### 4. Verify

```bash
# Should return {"status":"ok"}
curl -u '<COUCHDB_USER>:<COUCHDB_PASSWORD>' http://localhost:5984/_up

# Check CORS headers
curl -v -H "Origin: app://obsidian.md" \
     -u '<COUCHDB_USER>:<COUCHDB_PASSWORD>' \
     http://localhost:5984/
```

### 5. Connect Obsidian

In the Obsidian plugin settings (**Self-hosted LiveSync**):

| Field | Value |
|---|---|
| URI | `https://your-domain-or-ts-hostname` for an HTTPS profile, or `http://localhost:5984` for local HTTP |
| Username | value of `COUCHDB_USER` |
| Password | value of `COUCHDB_PASSWORD` |
| Database name | value of `COUCHDB_DATABASE` (default: `obsidiannotes`) |
| End-to-end passphrase | *your own chosen passphrase — never stored server-side* |

---

## Profile Details

<a id="default-no-profile--lan--localhost-only"></a>

### Default (no profile) — Host HTTP access

The Compose file publishes CouchDB on host port 5984 by default, on all host interfaces. Its reachability depends on the host firewall and network; selecting an HTTPS profile does not close that direct HTTP port. Restrict the host port to the intended network, bind it to loopback, or remove the mapping when all access uses the proxy.

Desktop Obsidian can use HTTP. Use HTTPS for mobile clients and connections outside a trusted local network. The supplied HTTPS profiles use port 443, so their client URL normally has no `:5984` suffix.

### `--profile caddy` — Public Domain + Auto TLS

**Requires**:
- A domain with an A record pointing to this server's public IP
- Ports 80 and 443 open in your firewall/router

**Set in `.env`**:
```
COUCHDB_DOMAIN=couchdb.yourdomain.com
ACME_EMAIL=you@example.com
```

Caddy automatically issues a Let's Encrypt certificate. No manual cert management.

<a id="--profile-tailscale--no-domain-required--recommended-for-privacy"></a>

### `--profile tailscale` — Tailnet or public HTTPS

**Requires**:
- A [Tailscale account](https://login.tailscale.com/).
- The Tailscale app on devices using private tailnet access.
- An authentication key for `TS_AUTHKEY`. Follow the [Docker authentication parameters](https://tailscale.com/docs/features/containers/docker/docker-params#ts_authkey) if using an OAuth client instead.

**Set in `.env`**:
```
TS_AUTHKEY=tskey-auth-...
TS_HOSTNAME=livesync
```

Choose the exposure before starting the profile. The bundled `config/ts-serve.json` sets `AllowFunnel` to `true`, requesting public HTTPS when the tailnet permits Funnel. It is not a private-only default.

- For private tailnet access, set that entry to `false` and verify the effective Serve configuration.
- For public Funnel access, retain `true` and configure the required tailnet permissions. See the [Tailscale Docker guide](https://tailscale.com/blog/docker-tailscale-guide) for the distinction between Serve and Funnel.

The bundled service expects `/dev/net/tun`. On hosts without that device, follow Tailscale's userspace-networking instructions and adjust the device mount as well as `TS_USERSPACE`; changing the environment variable alone leaves the required bind mount in place.

### `--profile cloudflare` — Cloudflare Tunnel

**Requires**:
- A [Cloudflare account](https://www.cloudflare.com/).
- A domain whose DNS is managed by Cloudflare.

#### Step 1: Create a Cloudflare Tunnel

Create a remotely managed tunnel using the current [Cloudflare Tunnel setup instructions](https://developers.cloudflare.com/tunnel/get-started/). Copy its connector token into `CF_TUNNEL_TOKEN` below. This Compose profile runs the connector; a separate host installation of `cloudflared` is unnecessary for this profile.

#### Step 2: Configure Environment

Edit `docker/.env`:
```env
CF_TUNNEL_TOKEN=eyJhIjoiZX...   # Paste the full token from Step 1
COUCHDB_DOMAIN=sync.yourdomain.com   # Must be a domain managed by Cloudflare
```

#### Step 3: Add Public Hostname Route

Configure the route in the Cloudflare dashboard for this remotely managed tunnel. The local `config/cloudflared.yml` is not the routing source for the token-managed profile.

1. Open the tunnel under **Networking → Tunnels**.
2. Under **Routes**, add a **Published application**.
3. Choose the public hostname, for example `sync.yourdomain.com`.
4. Set the service URL to `http://couchdb:5984` and save the route.

The `cloudflared` and `couchdb` services share a Docker network. The service name reaches CouchDB; `localhost` would address the `cloudflared` container itself. The local connection is HTTP, while the public client URL is HTTPS. Keep TLS certificate verification enabled for any HTTPS origin you configure later. The [current setup guide](https://developers.cloudflare.com/tunnel/get-started/) describes the dashboard flow.

#### Step 4: Start the Stack

```bash
cd docker/
docker compose --profile cloudflare up -d
```

Verify containers are running:
```bash
docker ps --filter "name=livesync"
```

You should see:
- `livesync-couchdb` — Status: Up (healthy)
- `livesync-cloudflared` — Status: Up
- `livesync-init` — Status: Exited (0)

#### Step 5: Test the Connection

```bash
# Should return 401 Unauthorized (proves CouchDB auth is working)
curl -I https://sync.yourdomain.com

# Should return {"couchdb":"Welcome",...}
curl -u '<COUCHDB_USER>:<COUCHDB_PASSWORD>' https://sync.yourdomain.com
```

If you get **404**, see Troubleshooting below.

#### Step 6: Configure Obsidian Plugin

In Obsidian → Settings → **Self-hosted LiveSync**:

| Field | Value |
|---|---|
| URI | `https://sync.yourdomain.com` |
| Username | value of `COUCHDB_USER` from `.env` |
| Password | value of `COUCHDB_PASSWORD` from `.env` |
| Database name | value of `COUCHDB_DATABASE` from `.env` (default: `obsidiannotes`) |
| End-to-end passphrase | *Choose your own* — never stored server-side |

If browser requests encounter a CORS failure, consult [Use Request API](../docs/settings.md#use-request-api-to-avoid-inevitable-cors-problem). That setting selects Obsidian's HTTP request adapter. It does not select the synchronisation mode or remove Cloudflare's proxy limits.

---

#### 🔧 Troubleshooting Cloudflare Tunnel

**Problem: 404 Error / Cloud flare Generic Error Page**

**Diagnosis**:
```bash
# Check if cloudflared is running
docker logs livesync-cloudflared --tail 20

# Look for: "Registered tunnel connection"
# If you see the connector ID, the tunnel is connected but routing is wrong
```

**Fix**: The public hostname rule is missing or incorrect.

1. Open the tunnel's published application routes in the Cloudflare dashboard.
2. Verify that the requested hostname maps to `http://couchdb:5984`.
3. Add or correct the route if required, then retry after the configuration has propagated.

A connected tunnel alone does not establish that the hostname route or origin is correct.

**Problem: Connection immediately closes / 502 Bad Gateway**

**Diagnosis**: CouchDB is not healthy or not on the same Docker network as cloudflared.

```bash
docker ps --filter "name=livesync-couchdb"
# Status should be: Up (healthy)

docker inspect livesync-couchdb -f '{{.NetworkSettings.Networks}}'
# Both services should list the same Compose network.

docker inspect livesync-cloudflared -f '{{.NetworkSettings.Networks}}'
# Compare with the CouchDB network above.
```

**Fix**: If CouchDB is unhealthy, check logs:
```bash
docker logs livesync-couchdb --tail 50
```

**Problem: 524 Timeout Errors During Sync**

A `524` can indicate that the origin did not respond or accept request data within Cloudflare's proxy timeout. Inspect the failing request, CouchDB response times, and connector logs before selecting a remedy. See [Cloudflare's current 524 guidance](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/) for the applicable limits and diagnostic steps.

**Use Request API** changes the HTTP adapter; it does not turn LiveSync mode into short polling or guarantee that a request completes within a proxy timeout. Review the actual synchronisation mode and [heartbeat/timeout setting](../docs/settings.md#use-timeouts-instead-of-heartbeats), then verify transfers on the intended devices. If the required traffic does not fit the proxy limits, consider an appropriately secured direct HTTPS route through Caddy or private Tailscale access.

---

## Data & Backup

The server database files live in the `couchdb-data` Docker named volume. Keep Vault backups, encryption passphrases, and ID recovery information separately. Back up the Compose configuration and CouchDB configuration as well; the database volume alone does not contain all of them.

The following example creates an archive while CouchDB is stopped. Verify the volume name before running it, especially if you have overridden the Compose project name:

```bash
docker volume inspect obsidian-livesync_couchdb-data
mkdir -p backup
docker compose stop couchdb
docker run --rm --network none -v obsidian-livesync_couchdb-data:/data:ro \
  -v "$(pwd)/backup:/backup" alpine \
  tar czf "/backup/couchdb-backup-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .
docker compose start couchdb
```

Before restoration, preserve the existing database volume. Restore and verify the archive in a separate recovery volume with a compatible CouchDB installation before replacing the active data. Do not extract an archive over a running database. See [Backing up CouchDB](https://docs.couchdb.org/en/stable/maintenance/backups.html) for database, configuration, and replication-based backup options.

---

## Security Notes

- The init service enables authenticated CouchDB access through the REST API. Verify that protected database endpoints reject unauthenticated requests before exposing the service.
- Enable **End-to-End Encryption** passphrase in the Obsidian plugin — vault data is  
  encrypted before it ever leaves your device
- The init container runs once and exits — it has no persistent access
- Never expose CouchDB's admin interface (`/_utils`) to the public internet;  
  use a firewall rule or the path-based obfuscation trick from  
  [self-hosted-livesync-server](https://github.com/vrtmrz/self-hosted-livesync-server)

---

## Useful Commands

```bash
# View logs
docker compose logs -f couchdb
docker compose logs couchdb-init

# Re-run init (e.g. after changing credentials)
docker compose restart couchdb-init

# Stop without removing data
docker compose down

# Stop AND remove all data volumes (DESTRUCTIVE)
docker compose down -v

# Open CouchDB admin UI (Fauxton) in browser
open http://localhost:5984/_utils
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Init container keeps restarting | CouchDB not healthy yet — wait 30s, check `docker compose logs couchdb` |
| `curl: (52) Empty reply` | CouchDB not fully started — the healthcheck should gate this |
| Mobile can't connect | Needs HTTPS — use tailscale or caddy profile |
| 524 errors with Cloudflare | Inspect the failing request and origin response time; follow the timeout guidance above. |
| `Permission denied` on volumes | Preserve the volume, inspect the CouchDB logs and mount ownership, and correct the specific permission problem. `docker compose down -v` deletes the database volume and is not a repair step. |
| CORS errors in browser | Confirm CouchDB headers: `curl -v -H "Origin: app://obsidian.md" http://localhost:5984/` |
| CouchDB exits immediately, zero logs (Windows) | **Do not add `:ro`** to the `livesync.ini` volume mount. CouchDB's entrypoint runs `chmod 0644` on all files in `/opt/couchdb/etc` — read-only bind mounts cause a silent EPERM crash on Docker Desktop for Windows (WSL2). The compose file is already correct; do not modify it. |
| Settings in `livesync.ini` seem ignored | Settings requiring restart (e.g. bind_address) load at start. Runtime-only settings (require_valid_user, enable_cors) are set by the init container via REST API and take effect immediately without restart. |
