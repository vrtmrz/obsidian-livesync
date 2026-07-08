# Network benchmark package

This directory packages the CLI benchmark cases with Docker Compose. It is
intended for reproducible local benchmark runs where CouchDB, the Nostr
signalling relay, optional TURN, and the benchmark runner are fixed by the
Compose file.

## Quick smoke run

From the repository root:

```bash
docker compose -f test/bench-network/compose.yml run --rm bench-runner
```

By default this runs:

- `couchdb-baseline`
- `p2p-direct-local`

The dataset is intentionally small by default. Results are written to
`test/bench-network/bench-results/`.

## GitHub Actions smoke run

`.github/workflows/cli-p2p-compose-smoke.yml` provides a manual
`workflow_dispatch` smoke run for the same Compose package. It is intentionally
not a required check yet, because WebRTC peer discovery can still be slow or
environment-sensitive on GitHub-hosted runners. Keep the dataset small and use
the uploaded JSON artefact to inspect whether failures are caused by peer
discovery, synchronisation, CouchDB startup, or Docker networking.

## Select cases

```bash
BENCH_CASES=couchdb-baseline,p2p-direct-local,p2p-user-turn \
docker compose -f test/bench-network/compose.yml --profile turn run --rm bench-runner
```

Available local cases:

- `couchdb-baseline`
- `p2p-direct-local`
- `couchdb-tethering-vpn-proxy`
- `p2p-smartphone-vpn-direct`
- `p2p-user-turn`

`p2p-smartphone-vpn-direct` is a structural case name. When it is run inside
this Compose package it is not a real smartphone tethering/VPN measurement; it
uses the local Compose network. Use it only for wiring checks unless the runner
is executed in an actual tethered/VPN environment.

## Dataset and latency controls

```bash
BENCH_MD_FILE_COUNT=100 \
BENCH_MD_MIN_SIZE_BYTES=512 \
BENCH_MD_MAX_SIZE_BYTES=2048 \
BENCH_BIN_FILE_COUNT=25 \
BENCH_BIN_SIZE_BYTES=8192 \
BENCH_COUCHDB_RTT_MS=20 \
BENCH_PEERS_TIMEOUT=60 \
docker compose -f test/bench-network/compose.yml run --rm bench-runner
```

The current CouchDB latency model is the existing HTTP proxy inside
`bench-couchdb.ts`. It models a remote database path with additional request
latency, but it does not model packet loss, jitter, MTU, bandwidth limits,
bufferbloat, or VPN encapsulation.

For P2P runs, `BENCH_PEERS_TIMEOUT` is passed to `p2p-peers`. That command waits
for the requested observation window before printing discovered peers, so the
reported peer discovery command time should not be read as first-peer latency.

## Latency sweep

To run P2P once and CouchDB at several requested RTT values:

```bash
BENCH_COMMAND=latency-sweep \
BENCH_SWEEP_RTT_MS=20,50,100,150,300 \
BENCH_MD_FILE_COUNT=100 \
BENCH_MD_MIN_SIZE_BYTES=512 \
BENCH_MD_MAX_SIZE_BYTES=2048 \
BENCH_BIN_FILE_COUNT=25 \
BENCH_BIN_SIZE_BYTES=8192 \
BENCH_SYNC_TIMEOUT=300 \
BENCH_PEERS_TIMEOUT=60 \
docker compose -f test/bench-network/compose.yml run --rm bench-runner
```

This sweep is useful for finding where the remote CouchDB path falls behind the
local direct P2P path in the current HTTP-proxy latency model. It should not be
presented as a full smartphone/VPN model.
