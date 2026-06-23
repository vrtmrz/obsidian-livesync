# Self-hosted LiveSync — Docker Setup

A fully self-hosted CouchDB stack for the [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) plugin.  
**No fly.io. No IBM Cloudant. No cloud accounts required for basic use.**

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
curl -u admin:yourpassword http://localhost:5984/_up

# Check CORS headers
curl -v -H "Origin: app://obsidian.md" \
     -u admin:yourpassword \
     http://localhost:5984/
```

### 5. Connect Obsidian

In the Obsidian plugin settings (**Self-hosted LiveSync**):

| Field | Value |
|---|---|
| URI | `https://your-domain-or-ts-hostname:5984` (or `http://localhost:5984` for LAN-only) |
| Username | value of `COUCHDB_USER` |
| Password | value of `COUCHDB_PASSWORD` |
| Database name | value of `COUCHDB_DATABASE` (default: `obsidiannotes`) |
| End-to-end passphrase | *your own chosen passphrase — never stored server-side* |

---

## Profile Details

### Default (no profile) — LAN / Localhost only

CouchDB is exposed on `http://localhost:5984` (or LAN IP).  
**Desktop Obsidian works over HTTP.** Mobile Obsidian requires HTTPS — use a tunnel profile.

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

### `--profile tailscale` — No Domain Required ✅ Recommended for privacy

**Requires**:
- Free [Tailscale account](https://login.tailscale.com/)
- Install the Tailscale app on all your Obsidian devices
- Generate an **OAuth key** at: https://login.tailscale.com/admin/settings/oauth  
  (Scopes: `devices:write`)

**Set in `.env`**:
```
TS_AUTHKEY=tskey-auth-...
TS_HOSTNAME=livesync
```

**Two sub-modes**:
- **VPN mode** (default): CouchDB accessible only to devices on your Tailnet at  
  `https://livesync.<tailnet>.ts.net` — completely private
- **Funnel mode**: public HTTPS at `https://livesync.<tailnet>.ts.net` — no domain purchase  
  Enable in your [Tailscale ACL](https://login.tailscale.com/admin/acls):
  ```json
  "nodeAttrs": [{"target": ["tag:container"], "attr": ["funnel"]}]
  ```

> **Note on Windows Docker Desktop**: If `/dev/net/tun` is unavailable, add `TS_USERSPACE=true`  
> to the tailscale service environment in `docker-compose.yml`.

### `--profile cloudflare` — Cloudflare Tunnel

**Requires**:
- Free [Cloudflare account](https://www.cloudflare.com/)
- A domain managed by Cloudflare DNS (can transfer existing domain for free)
- Cloudflare Zero Trust account (free)

#### Step 1: Create a Cloudflare Tunnel

1. Log in to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to **Networks → Tunnels**
3. Click **Create a tunnel**
4. Choose **Cloudflared** as tunnel type
5. Name your tunnel (e.g., `obsidian-livesync`)
6. Click **Save tunnel**
7. **Copy the tunnel token** — it looks like `eyJhIjoiZX...` (very long, ~400 characters)

#### Step 2: Configure Environment

Edit `docker/.env`:
```env
CF_TUNNEL_TOKEN=eyJhIjoiZX...   # Paste the full token from Step 1
COUCHDB_DOMAIN=sync.yourdomain.com   # Must be a domain managed by Cloudflare
```

#### Step 3: Add Public Hostname Route

🚨 **CRITICAL**: Token-based tunnels ignore the local `cloudflared.yml` config file. All routing is controlled from the dashboard.

Back in the Zero Trust dashboard, **in the same tunnel creation flow** (or edit your tunnel later):

1. Go to the **Public Hostname** tab
2. Click **Add a public hostname**
3. Configure:
   - **Subdomain**: `sync` (or your preferred subdomain)
   - **Domain**: Select your Cloudflare domain from dropdown
   - **Type**: `HTTP`
   - **URL**: `couchdb:5984` ← **Do NOT use `localhost`!**

**Why `couchdb:5984` not `localhost:5984`?**
- The `cloudflared` container runs inside Docker on the same network as `couchdb`
- Docker's internal DNS resolves `couchdb` to the correct container
- Using `localhost` would look inside the `cloudflared` container (nothing there)

4. Under **Additional application settings** (expand):
   - **No TLS Verify**: Leave **OFF** (CouchDB uses plain HTTP internally, that's fine)
   - Leave other settings at defaults
5. Click **Save hostname**

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
curl -u admin:yourpassword https://sync.yourdomain.com
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

Under **Remote Database Configuration → Advanced**:
- Enable: ✅ **Use Request API to avoid inevitable CORS problem**
  (See "Known Issue" below for why this is critical)

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

1. Go to Zero Trust → Networks → Tunnels → your tunnel → **Edit**
2. Click **Public Hostname** tab
3. Verify a hostname exists with:
   - Service Type: `HTTP`
   - URL: `couchdb:5984` (NOT `localhost:5984`)
4. If no hostname exists, add it (see Step 3 above)
5. Wait 30 seconds for changes to propagate, then test again

**Problem: Connection immediately closes / 502 Bad Gateway**

**Diagnosis**: CouchDB is not healthy or not on the same Docker network as cloudflared.

```bash
docker ps --filter "name=livesync-couchdb"
# Status should be: Up (healthy)

docker inspect livesync-couchdb -f '{{.NetworkSettings.Networks}}'
# Should show: livesync-net

docker inspect livesync-cloudflared -f '{{.NetworkSettings.Networks}}'
# Should also show: livesync-net
```

**Fix**: If CouchDB is unhealthy, check logs:
```bash
docker logs livesync-couchdb --tail 50
```

**Problem: 524 Timeout Errors During Sync**

**Root cause**: Cloudflare's proxy has a **100-second idle timeout**. CouchDB's replication protocol uses long-polling on the `_changes` feed, which can idle for longer during quiet periods.

**Fix**: Switch to short-polling mode in the Obsidian plugin:
1. Obsidian → Settings → Self-hosted LiveSync
2. **Remote Database Configuration → Advanced**
3. Enable: ✅ **Use Request API to avoid inevitable CORS problem**
4. Save and restart sync

This keeps all requests under 100 seconds.

**Alternative**: Use Tailscale or Caddy profiles instead — neither has aggressive timeouts.

---

## Data & Backup

All vault data lives in the `couchdb-data` Docker named volume.

```bash
# Backup
docker run --rm -v obsidian-livesync_couchdb-data:/data \
  -v $(pwd)/backup:/backup alpine \
  tar czf /backup/couchdb-backup-$(date +%Y%m%d).tar.gz -C /data .

# Restore
docker run --rm -v obsidian-livesync_couchdb-data:/data \
  -v $(pwd)/backup:/backup alpine \
  tar xzf /backup/couchdb-backup-20260218.tar.gz -C /data
```

---

## Security Notes

- CouchDB requires authentication for **all** requests (configured by `livesync.ini`)
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
| 524 errors with Cloudflare | Enable "Use Request API" toggle in Obsidian plugin |
| `Permission denied` on volumes | Run `docker compose down -v` and retry — first-run volume ownership issue |
| CORS errors in browser | Confirm CouchDB headers: `curl -v -H "Origin: app://obsidian.md" http://localhost:5984/` |
| CouchDB exits immediately, zero logs (Windows) | **Do not add `:ro`** to the `livesync.ini` volume mount. CouchDB's entrypoint runs `chmod 0644` on all files in `/opt/couchdb/etc` — read-only bind mounts cause a silent EPERM crash on Docker Desktop for Windows (WSL2). The compose file is already correct; do not modify it. |
| Settings in `livesync.ini` seem ignored | Settings requiring restart (e.g. bind_address) load at start. Runtime-only settings (require_valid_user, enable_cors) are set by the init container via REST API and take effect immediately without restart. |
