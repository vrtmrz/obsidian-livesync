# Coturn starter for LiveSync P2P

This optional Compose project runs a small, static-credential TURN service for LiveSync P2P. It uses the upstream `coturn/coturn` image directly; the repository does not maintain a separate Coturn Dockerfile.

The starter is deliberately limited to a Linux server with a public IPv4 address, TURN over UDP and TCP on port 3478, and UDP relay ports 49160–49200. It does not configure TLS, automatic certificate renewal, monitoring, quotas, or a managed credential endpoint.

## Before starting

Prepare:

- a Linux host with Docker Engine and the Compose plug-in;
- a public IPv4 address, either on the host or forwarded to it;
- a DNS name such as `turn.example.com`;
- firewall and NAT rules for TCP and UDP port 3478, and UDP ports 49160–49200; and
- enough bandwidth for every relayed P2P transfer.

Docker host networking is intentional. Coturn's upstream image recommends it because forwarding a large relay port range through Docker performs poorly. This starter therefore does not support Docker Desktop.

## Configure and start

From this directory:

```sh
cp .env.example .env
chmod 600 .env
```

Set every value in `.env`. Generate a high-entropy password, for example:

```sh
openssl rand -hex 32
```

Use a simple username without a colon. The static username and password are passed to Coturn as process arguments. They are visible to a local Docker administrator, who already controls the host. The `.env` file is excluded from Git and should remain private. The resolved output of `docker compose config` also contains the credential, so do not publish it.

Validate the resolved configuration, then start it:

```sh
docker compose config
docker compose up -d
docker compose logs -f coturn
```

The pinned image version is deliberate. Review the upstream Coturn release notes and update the pin explicitly rather than following `latest` automatically.

## Configure LiveSync

Enter both client paths in the P2P profile's TURN server list:

```text
turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
```

Use `TURN_USERNAME` and `TURN_PASSWORD` as the TURN username and credential. Keep the normal `Automatic` ICE policy unless a future LiveSync release offers `TURN relay only` and the direct path needs to be excluded deliberately.

Both synchronising devices must be able to reach the server. Prove an explicit two-way `Replicate now` round trip on the intended networks before relying on the configuration.

The repository check can validate Compose expansion and local TURN allocations. It cannot prove the public firewall, NAT, carrier, or client path for a particular deployment. Validate both UDP and TCP from outside the server network.

## TLS and port 443 are advanced extensions

This starter does not recommend putting Coturn on port 443. Coturn cannot bind to the same IP address and TCP port as Caddy or another HTTPS entry point. In particular, it conflicts with the bundled CouchDB Caddy profile when both use the same host address.

If a restrictive network requires TURN over TLS on port 443, prefer a separate TURN host or a separate public IP address. An outbound tunnel used for CouchDB may also leave the host's public port 443 available for Coturn, provided that TURN uses a separate DNS record which resolves directly to that host. The tunnel itself does not carry TURN traffic.

A single public IP can technically be shared when one layer-4 TLS router owns port 443 and routes separate CouchDB and TURN hostnames by Server Name Indication (SNI). This adds another certificate and connection-routing boundary, depends on every intended TURN client supplying usable SNI, and is outside this starter. The standard Caddy image used by the bundled CouchDB profile does not provide that layer-4 routing.

TURN over TLS is not HTTP. An ordinary HTTP reverse proxy or Cloudflare Tunnel route is not a substitute for a TURN listener. Follow Coturn's upstream configuration guidance for `tls-listening-port`, `cert`, and `pkey`, arrange renewal and restart behaviour, and test the resulting `turns:` URL from outside the server network.

This starter disables Coturn's TLS listener and does not add a TURN-over-DTLS path, so it cannot appear to provide a secure TURN port without those operator-owned prerequisites. This does not disable the end-to-end DTLS encryption used by the WebRTC peer connection carried through TURN.

## Security and operations

- Rotate the static credential if the Setup URI, `.env` file, or credential is exposed.
- Treat TURN as an internet-facing bandwidth service and monitor traffic and logs.
- Add appropriate allocation and bandwidth quotas for a shared or public deployment.
- Keep the private-address restrictions unless the TURN server is intentionally permitted to relay to those networks.
- Keep independent Vault backups. TURN improves connection reachability; it does not store a backup of Vault data.
- A TURN operator can observe endpoint addresses, timing, and traffic volume even though LiveSync content remains end-to-end encrypted.

The authoritative image and configuration references are the [Coturn Docker image guide](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md) and [Coturn server documentation](https://github.com/coturn/coturn/blob/master/README.turnserver).
