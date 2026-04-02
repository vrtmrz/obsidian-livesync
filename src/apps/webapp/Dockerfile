# syntax=docker/dockerfile:1
#
# Self-hosted LiveSync WebApp — Docker image
# Browser-based vault sync using the FileSystem API, served by nginx.
#
# Build (from the repository root):
#   docker build -f src/apps/webapp/Dockerfile -t livesync-webapp .
#
# Run:
#   docker run --rm -p 8080:80 livesync-webapp
#   Then open http://localhost:8080/webapp.html in Chrome/Edge 86+.
#
# Notes:
# - This image serves purely static files; no server-side code is involved.
# - The FileSystem API is a browser feature and requires Chrome/Edge 86+ or
#   Safari 15.2+ (limited). Firefox is not supported.
# - CouchDB / S3 connections are made directly from the browser; the container
#   only serves HTML/JS/CSS assets.

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 1 — builder
#  Full Node.js environment to install dependencies and build the Vite bundle.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /build

# Install workspace dependencies (all apps share the root package.json)
COPY package.json ./
RUN npm install

# Copy the full source tree and build the WebApp bundle
COPY . .
RUN cd src/apps/webapp && npm run build

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 2 — runtime
#  Minimal nginx image that serves the static build output.
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:stable-alpine

# Remove the default nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy the built static assets
COPY --from=builder /build/src/apps/webapp/dist /usr/share/nginx/html

# Redirect the root to webapp.html so the app loads on first visit
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index webapp.html;\n\
    location / {\n\
        try_files $uri $uri/ =404;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
