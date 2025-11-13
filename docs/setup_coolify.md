# Setup a CouchDB server on Coolify

## Table of Contents

- [Setup a CouchDB server on Coolify](#setup-a-couchdb-server-on-coolify)
  - [Table of Contents](#table-of-contents)
  - [1. Prepare CouchDB](#1-prepare-couchdb)
  - [2. Run couchdb-init.sh for initialise](#2-run-couchdb-initsh-for-initialise)
  - [3. Client Setup](#4-client-setup)
    - [1. Generate the setup URI on a desktop device or server](#1-generate-the-setup-uri-on-a-desktop-device-or-server)
    - [2. Setup Self-hosted LiveSync to Obsidian](#2-setup-self-hosted-livesync-to-obsidian)
---

## 1. Prepare CouchDB
Under your **Project**; create a **New Resource** based on a **Docker Compose Empty**
> Don't forget to replace 'obsidian-livesync.example.org' with your own domain
```
services:
  couchdb:
    image: 'couchdb:latest'
    environment:
      - 'COUCHDB_USER=${COUCHDB_USER:?admin}'
      - 'COUCHDB_PASSWORD=${COUCHDB_PASSWORD:?}'
    volumes:
      - 'couchdb_data:/opt/couchdb/data'
    healthcheck:
      test:
        - CMD-SHELL
        - 'curl --fail -s http://couchdb:5984/_up'
      interval: 30s
      timeout: 5s
      retries: 5
    labels:
      - "traefik.enable=true"
      # The Traefik Network
      - "traefik.docker.network=proxy"
      # Don't forget to replace 'obsidian-livesync.example.org' with your own domain
      - "traefik.http.routers.obsidian-livesync.rule=Host(`obsidian-livesync.example.org`)"
      # The 'websecure' entryPoint is basically your HTTPS entrypoint. Check the next code snippet if you are encountering problems only; you probably have a working traefik configuration if this is not your first container you are reverse proxying.
      - "traefik.http.routers.obsidian-livesync.entrypoints=websecure"
      - "traefik.http.routers.obsidian-livesync.service=obsidian-livesync"
      - "traefik.http.services.obsidian-livesync.loadbalancer.server.port=5984"
      - "traefik.http.routers.obsidian-livesync.tls=true"
      # Replace the string 'letsencrypt' with your own certificate resolver
      - "traefik.http.routers.obsidian-livesync.tls.certresolver=letsencrypt"
      - "traefik.http.routers.obsidian-livesync.middlewares=obsidiancors"
      # The part needed for CORS to work on Traefik 2.x starts here
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolallowmethods=GET,PUT,POST,HEAD,DELETE"
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolallowheaders=accept,authorization,content-type,origin,referer"
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolalloworiginlist=app://obsidian.md,capacitor://localhost,http://localhost"
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolmaxage=3600"
      - "traefik.http.middlewares.obsidiancors.headers.addvaryheader=true"
      - "traefik.http.middlewares.obsidiancors.headers.accessControlAllowCredentials=true"
```

## 2. Run couchdb-init.sh for initialise
```
curl -s https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/couchdb/couchdb-init.sh | bash
```

If it results like the following:
```
-- Configuring CouchDB by REST APIs... -->
{"ok":true}
""
""
""
""
""
""
""
""
""
<-- Configuring CouchDB by REST APIs Done!
```

Your CouchDB has been initialised successfully. If you want this manually, please read the script.

If you are using Docker Compose and the above command does not work or displays `ERROR: Hostname missing`, you can try running the following command, replacing the placeholders with your own values:
```
curl -s https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/couchdb/couchdb-init.sh | hostname=http://<YOUR SERVER IP>:5984 username=<INSERT USERNAME HERE> password=<INSERT PASSWORD HERE> bash
```

## 3. Client Setup
> [!TIP]
> Now manual configuration is not recommended for some reasons. However, if you want to do so, please use `Setup wizard`. The recommended extra configurations will be also set.

### 1. Generate the setup URI on a desktop device or server
```bash
export hostname=https://tiles-photograph-routine-groundwater.trycloudflare.com #Point to your vault
export database=obsidiannotes #Please change as you like
export passphrase=dfsapkdjaskdjasdas #Please change as you like
export username=johndoe
export password=abc123
deno run -A https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/flyio/generate_setupuri.ts
```

> [!TIP]
> What is the `passphrase`? Is it different from `uri_passphrase`?
> Yes, the `passphrase` we have exported now is for an End-to-End Encryption passphrase.
> And, `uri_passphrase` that used in the `generate_setupuri.ts` is a different one; for decrypting Set-up URI at using that.
> Why: I (vorotamoroz) think that the passphrase of the Setup-URI should be different from the E2EE passphrase to prevent exposure caused by operational errors or the possibility of evil in our environment. On top of that, I believe that it is desirable for the Setup-URI to be random. Setup-URI is inevitably long, so it goes through the clipboard. I think that its passphrase should not go through the same path, so it should essentially be typed manually.
> Hence, if we keep empty for uri_passphrase, generate_setupuri.ts generates an adjective-noun-randomnumber passphrase so that we can remember it without going through the clipboard.

You will then get the following output:

```bash
obsidian://setuplivesync?settings=%5B%22tm2DpsOE74nJAryprZO2M93wF%2Fvg.......4b26ed33230729%22%5D

Your passphrase of Setup-URI is:  patient-haze
This passphrase is never shown again, so please note it in a safe place.
```

Please keep your passphrase of Setup-URI.

### 2. Setup Self-hosted LiveSync to Obsidian
[This video](https://youtu.be/7sa_I1832Xc?t=146) may help us.
1. Install Self-hosted LiveSync
2. Choose `Use the copied setup URI` from the command palette and paste the setup URI. (obsidian://setuplivesync?settings=.....).
3. Type the previously displayed passphrase (`patient-haze`) for setup-uri passphrase.
4. Answer `yes` and `Set it up...`, and finish the first dialogue with `Keep them disabled`.
5. `Reload app without save` once.
