# syntax=docker/dockerfile:1
#
# Self-hosted LiveSync WebPeer — Docker image
# Browser-based P2P peer daemon served by nginx.
#
# Build (from the repository root):
#   docker build -f src/apps/webpeer/Dockerfile -t livesync-webpeer .
#
# Run:
#   docker run --rm -p 8081:80 livesync-webpeer
#   Then open http://localhost:8081/ in any modern browser.
#
# What is WebPeer?
# WebPeer acts as a pseudo P2P peer that runs entirely in the browser.
# It can replace a CouchDB remote server by replying to sync requests from
# other Self-hosted LiveSync instances over the WebRTC P2P channel.
#
# P2P (WebRTC) networking notes
# ─────────────────────────────
# WebRTC connections are initiated by the *browser* visiting this page, not by
# the nginx container itself.  Therefore the Docker network mode of this
# container has NO effect on WebRTC connectivity.
# Simply publish port 80 (as above) and the browser handles all ICE/STUN/TURN
# negotiation on its own.
#
# If the browser is running inside another container or a restricted network,
# configuring a TURN server in the WebPeer settings is recommended.

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 1 — builder
#  Full Node.js environment to install dependencies and build the Vite bundle.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /build

# Install workspace dependencies (all apps share the root package.json)
COPY package.json ./
RUN npm install

# Copy the full source tree and build the WebPeer bundle
COPY . .
RUN cd src/apps/webpeer && npm run build

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 2 — runtime
#  Minimal nginx image that serves the static build output.
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:stable-alpine

# Remove the default nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy the built static assets
COPY --from=builder /build/src/apps/webpeer/dist /usr/share/nginx/html

EXPOSE 80
