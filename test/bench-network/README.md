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

Set `BENCH_REPEAT_COUNT` to run each selected case more than once. Repeated
results are written with suffixes such as `-r01`, `-r02`, and `-r03`, and the
summary records the repeat index for each run.

`p2p-smartphone-vpn-direct` is a structural case name. When it is run inside
this Compose package it is not a real smartphone tethering/VPN measurement; it
uses the local Compose network. Use it only for wiring checks unless the runner
is executed in an actual tethered/VPN environment.

## Comparison model

The primary local comparison is between a remote-database path and a direct P2P
path:

| Case               | Data path                                   | What is measured                                                               | What is not measured                                                                                      |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `couchdb-baseline` | Device A -> CouchDB -> Device B             | Two one-shot CLI synchronisation commands through a local HTTP latency proxy   | Real WAN jitter, packet loss, bandwidth limits, VPN encapsulation, and server contention                  |
| `p2p-direct-local` | Device A -> Device B using Nostr signalling | One fresh CLI `p2p-sync` command, including process start-up and WebRTC connection establishment, with TURN disabled | Public relay operation, mobile carrier behaviour, and TURN relay throughput |

Use the CouchDB result as the remote-store baseline and the P2P result as the
direct-transfer comparison. The Nostr relay is used for signalling in the P2P
case, but synchronised note content is transferred over the WebRTC DataChannel.
The earlier `p2p-peers` observation command is excluded from the P2P timing,
but the timed `p2p-sync` command performs its own signalling and connection
establishment. The P2P result JSON records the selected WebRTC ICE candidate pair when the CLI
can collect it from `RTCPeerConnection.getStats()`. Interpret P2P paths from
the recorded candidate types rather than from TURN configuration alone. Do not
report a signalling-only Tier 2 run as though the selected note-data path were
also shaped.

Benchmark cases use `BENCH_VERIFY_MODE=all` by default. After the timed phase,
the runner retrieves and compares every generated file and records the verified
file count, whether verification was complete, and a SHA-256 digest of the
deterministic dataset. Set `BENCH_VERIFY_MODE=sample` only for exploratory
large-dataset runs where the additional verification time is impractical.

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

The CouchDB latency model is the HTTP proxy inside `bench-couchdb.ts`. It adds
half of the requested RTT before forwarding each request and the other half
before returning its response. It does not model packet loss, jitter, MTU,
bandwidth limits, bufferbloat, or VPN encapsulation.

For P2P runs, `BENCH_PEERS_TIMEOUT` is passed to `p2p-peers`. That command waits
for the requested observation window before printing discovered peers, so the
reported peer discovery command time should not be read as first-peer latency.

## Latency sweep

To run P2P once and CouchDB at several requested RTT values:

```bash
BENCH_COMMAND=latency-sweep \
BENCH_SWEEP_RTT_MS=20,50,100,150,300 \
BENCH_REPEAT_COUNT=3 \
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

## Data Compression benchmark

The [Data Compression specification](../../docs/specs_data_compression.md) records the current storage contract, 1.0 decision, measured result, and follow-up optimisation candidates. This section is the benchmark runbook.

The compression benchmark compares the exact CLI and Commonlib CouchDB path in
four configurations: E2EE off or on, each with Data Compression off or on. It
uses the normal CLI `mirror` and `sync` commands, so the recorded CouchDB
documents have passed through the current Rabin–Karp chunk splitter, optional
fflate compression, and E2EE V2 rather than a synthetic document transform.

```bash
BENCH_COMMAND=compression \
BENCH_COMPRESSION_REPEAT_COUNT=3 \
BENCH_COUCHDB_RTT_MS=1 \
docker compose -f test/bench-network/compose.yml run --build --rm bench-runner
```

The fixture contains current repository Markdown, PNG, JSON, and TypeScript
files; two deterministic JPEGs generated with `cjpeg`; a gzip-compressed
Markdown file; and deterministic high-entropy binary data. Every run verifies
all files after the second client has synchronised them. The JSON result under
`test/bench-network/bench-results/` records:

- source bytes and stored chunk bytes by file kind;
- raw CouchDB external, active, and file sizes;
- request and response body bytes observed by the local HTTP proxy, including
  the combined initial sync and full materialisation download;
- upload and download wall time, user and system CPU time, and maximum resident
  memory for each CLI process; and
- percentage changes caused by enabling compression with E2EE both off and on.

Use at least three repeats when making a default-setting decision. A `1 ms`
requested RTT keeps the local run focused on transform and storage costs. Run a
separate representative RTT when evaluating whether reduced request bodies
outweigh compression CPU on the intended network. HTTP byte counters cover
decoded bodies and exclude headers, while process timings include CLI start-up.
Full materialisation starts one CLI process per file and can repeat lazy chunk
fetches, so treat that phase as a CLI workflow measurement rather than a raw
download lower bound. Stored chunk size and upload request size are the more
direct transform comparisons.
The generated JPEGs are deterministic image-like fixtures, not a photographic
corpus, so broader media conclusions require a separately reviewed corpus.

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

## Split-container P2P emulation

The optional `p2p-split` profile runs the P2P host and client in separate
Compose services. Each service can apply `tc netem` to its own egress interface
and the client result records the selected WebRTC ICE candidate pair.

```bash
BENCH_MD_FILE_COUNT=2 \
BENCH_BIN_FILE_COUNT=1 \
BENCH_PEERS_TIMEOUT=10 \
BENCH_SPLIT_RUN_ID="$(date -u +%Y%m%d%H%M%S)" \
docker compose -f test/bench-network/compose.yml --profile p2p-split up \
  --abort-on-container-exit --exit-code-from p2p-split-client \
  p2p-split-host p2p-split-client
```

By default this uses the `home-wifi` profile (`20 ms` delay, `5 ms` jitter,
`0.1%` loss, `100 Mbit`, and `1500` MTU) on both P2P containers. Override the
same `NETEM_*` variables used by the TCP shim to model a stricter profile.

```bash
BENCH_MD_FILE_COUNT=100 \
BENCH_MD_MIN_SIZE_BYTES=512 \
BENCH_MD_MAX_SIZE_BYTES=2048 \
BENCH_BIN_FILE_COUNT=25 \
BENCH_BIN_SIZE_BYTES=8192 \
BENCH_PEERS_TIMEOUT=60 \
BENCH_SYNC_TIMEOUT=420 \
BENCH_SPLIT_RUN_ID="$(date -u +%Y%m%d%H%M%S)" \
BENCH_NETWORK_PROFILE=tethering-vpn \
NETEM_PROFILE=tethering-vpn \
NETEM_DELAY_MS=140 \
NETEM_JITTER_MS=50 \
NETEM_LOSS_PERCENT=1.0 \
NETEM_BANDWIDTH_MBIT=10 \
NETEM_MTU=1380 \
docker compose -f test/bench-network/compose.yml --profile p2p-split up \
  --abort-on-container-exit --exit-code-from p2p-split-client \
  p2p-split-host p2p-split-client
```

This is a Linux-only manual benchmark fixture, not a required pull-request CI
job. It shapes each P2P container's egress path, including signalling traffic,
and should be reported separately from the CouchDB TCP-shim measurements. The
result JSON includes `ok: true` for completed runs; failed runs still write a
summary with `ok: false` and a `failure` object before returning a non-zero
exit code.

Remove the shared work volume between repeated manual runs when you do not use
a unique `BENCH_SPLIT_RUN_ID`:

```bash
docker compose -f test/bench-network/compose.yml --profile p2p-split down --volumes
```

## P2P Signalling-Only Emulation

The optional `signalling-shim` profile shapes only the Nostr signalling relay
path. The P2P host and client run in the benchmark runner as usual, and the
configured relay URL points at a TCP netem shim in front of `nostr-relay`.
This is the preferred fixture when evaluating the hypothesis that P2P avoids a
constrained remote database data path while still depending on a signalling
server for rendezvous.

```bash
BENCH_CASES=p2p-signalling-netem-home-wifi \
docker compose -f test/bench-network/compose.yml --profile signalling-shim run --rm \
  bench-runner-signalling-shim
```

For a stricter signalling path:

```bash
NETEM_PROFILE=tethering-vpn \
NETEM_DELAY_MS=140 \
NETEM_JITTER_MS=50 \
NETEM_LOSS_PERCENT=1.0 \
NETEM_BANDWIDTH_MBIT=10 \
NETEM_MTU=1380 \
BENCH_CASES=p2p-signalling-netem-tethering-vpn \
docker compose -f test/bench-network/compose.yml --profile signalling-shim run --rm \
  bench-runner-signalling-shim
```

Use this separately from `p2p-split`. The `p2p-split` profile shapes each peer's
egress path, so it constrains both signalling and the selected WebRTC data
path. The `signalling-shim` profile constrains only relay access, which keeps
it focused on peer-to-signalling-server reachability rather than peer-to-peer
note-data transfer.

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
This shim currently measures the CouchDB path only. It does not shape or verify
the WebRTC P2P data path.
