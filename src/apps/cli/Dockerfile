# syntax=docker/dockerfile:1
#
# Self-hosted LiveSync CLI — Docker image
#
# Build (from the repository root):
#   docker build -f src/apps/cli/Dockerfile -t livesync-cli .
#
# Run:
#   docker run --rm -v /path/to/your/vault:/data livesync-cli sync
#   docker run --rm -v /path/to/your/vault:/data livesync-cli ls
#   docker run --rm -v /path/to/your/vault:/data livesync-cli init-settings
#   docker run --rm -v /path/to/your/vault:/data livesync-cli --help
#
# The first positional argument (database-path) is automatically set to /data.
# Mount your vault at /data, or override with: -e LIVESYNC_DB_PATH=/other/path
#
# P2P (WebRTC) networking — important notes
# -----------------------------------------
# The P2P replicator (p2p-host / p2p-sync / p2p-peers) uses WebRTC, which
# generates ICE candidates of three kinds:
#
#   host   — the container's bridge IP (172.17.x.x).  Unreachable from outside
#             the Docker bridge, so LAN peers cannot connect via this candidate.
#   srflx  — the host's public IP, obtained via STUN reflection.  Works fine
#             over the internet even with the default bridge network.
#   relay  — traffic relayed through a TURN server.  Always reachable regardless
#             of network mode.
#
# Recommended network modes per use-case:
#
#   LAN P2P (Linux only)
#     docker run --network host ...
#     This exposes the real host IP as the 'host' candidate so LAN peers can
#     connect directly.  --network host is not available on Docker Desktop for
#     macOS or Windows.
#
#   LAN P2P (macOS / Windows Docker Desktop)
#     Configure a TURN server in settings (P2P_turnServers / P2P_turnUsername /
#     P2P_turnCredential).  All data is then relayed through the TURN server,
#     bypassing the bridge-network limitation.
#
#   Internet P2P
#     Default bridge network is sufficient; the srflx candidate carries the
#     host's public IP and peers can connect normally.
#
#   CouchDB sync only (no P2P)
#     Default bridge network.  No special configuration required.

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 1 — builder
#  Full Node.js environment to compile native modules and bundle the CLI.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Build tools required by native Node.js addons (mainly leveldown)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Install workspace dependencies first (layer-cache friendly)
COPY package.json ./
RUN npm install

# Copy the full source tree and build the CLI bundle
COPY . .
RUN cd src/apps/cli && npm run build

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 2 — runtime-deps
#  Install only the external (unbundled) packages that the CLI requires at
#  runtime.  Native addons are compiled here against the same base image that
#  the final runtime stage uses.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime-deps

# Build tools required to compile native addons
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /deps

# runtime-package.json lists only the packages that Vite leaves external
COPY src/apps/cli/runtime-package.json ./package.json
RUN npm install --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 3 — runtime
#  Minimal image: pre-compiled native modules + CLI bundle only.
#  No build tools are included, keeping the image small.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Copy pre-compiled external node_modules from runtime-deps stage
COPY --from=runtime-deps /deps/node_modules ./node_modules

# Copy the built CLI bundle from builder stage
COPY --from=builder /build/src/apps/cli/dist ./dist

# Install entrypoint wrapper
COPY src/apps/cli/docker-entrypoint.sh /usr/local/bin/livesync-cli
RUN chmod +x /usr/local/bin/livesync-cli

# Mount your vault / local database directory here
VOLUME ["/data"]

ENTRYPOINT ["livesync-cli"]
