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
- `couchdb-netem-home-wifi`
- `couchdb-netem-tethering-vpn`
- `p2p-smartphone-vpn-direct`
- `p2p-user-turn`

`p2p-smartphone-vpn-direct` is a structural case name. When it is run inside
this Compose package it is not a real smartphone tethering/VPN measurement; it
uses the local Compose network. Use it only for wiring checks unless the runner
is executed in an actual tethered/VPN environment.

## Comparison model

The primary local comparison is between a remote-database path and a direct P2P
path:

| Case | Data path | What is measured | What is not measured |
| --- | --- | --- | --- |
| `couchdb-baseline` | Device A -> CouchDB -> Device B | Two one-shot CLI synchronisation commands through a local HTTP latency proxy | Real WAN jitter, packet loss, bandwidth limits, VPN encapsulation, and server contention |
| `p2p-direct-local` | Device A -> Device B after Nostr signalling | One CLI P2P synchronisation command over WebRTC DataChannel with TURN disabled | Public relay operation, mobile carrier behaviour, TURN relay throughput, and first-peer discovery latency |

Use the CouchDB result as the remote-store baseline and the P2P result as the
direct-transfer comparison. The Nostr relay is used for signalling in the P2P
case, but synchronised note content is transferred over the WebRTC DataChannel.

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

## Network emulation smoke

The optional `netem` profile checks whether a Linux runner can apply traffic
shaping inside a Compose-managed container. This is a fixture smoke test for a
second-tier simulation design; it does not produce synchronisation performance
results by itself.

```bash
docker compose -f test/bench-network/compose.yml --profile netem run --rm netem-smoke
```

The smoke writes `tc qdisc`, route, and interface details under
`test/bench-network/bench-results/`. Profile parameters can be overridden:

```bash
NETEM_PROFILE=tethering-vpn \
NETEM_DELAY_MS=140 \
NETEM_JITTER_MS=50 \
NETEM_LOSS_PERCENT=1.0 \
NETEM_BANDWIDTH_MBIT=10 \
NETEM_MTU=1380 \
docker compose -f test/bench-network/compose.yml --profile netem run --rm netem-smoke
```

## Shimmed CouchDB benchmark

The optional `shim` profile runs a CouchDB benchmark through a TCP forwarding
container that applies `tc netem`. This is a manual Tier 2 synchronisation
measurement path; it is intentionally separate from required pull-request CI.

```bash
docker compose -f test/bench-network/compose.yml --profile shim run --rm bench-runner-shim
```

The default profile is `home-wifi`. A smartphone/VPN-like profile can be
requested by overriding both the shim parameters and the benchmark case:

```bash
NETEM_PROFILE=tethering-vpn \
NETEM_DELAY_MS=140 \
NETEM_JITTER_MS=50 \
NETEM_LOSS_PERCENT=1.0 \
NETEM_BANDWIDTH_MBIT=10 \
NETEM_MTU=1380 \
BENCH_CASES=couchdb-netem-tethering-vpn \
docker compose -f test/bench-network/compose.yml --profile shim run --rm bench-runner-shim
```

The benchmark result records `simulationTier`, `networkProfile`, and
`networkModel`. The shim also writes its applied `tc qdisc`, route, and
interface state under `test/bench-network/bench-results/`.
