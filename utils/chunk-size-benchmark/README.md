# Chunk-size research harness

These scripts support the October 2026 Chunk-size investigation. The decision,
measurements, and their limits are recorded in Commonlib's
`docs/adr/2026_10_chunking_and_transport_batching.md` and its evidence companion.
They are research tools with experiment-specific assertions, separate from
the maintained unit and integration suites.

The original experiments used Commonlib 0.1.44 and unpublished candidates with
the same version label. `local.mjs` checks that version explicitly. Record the
installed package's source revision and tarball digest when comparing results;
the version label alone does not identify the tested implementation. Scripts
which import internal `dist` paths also depend on that package layout.

## Local measurements

Install the exact Commonlib candidate to assess, then run from the repository
root with Node.js 24:

```sh
NODE_OPTIONS=--max-old-space-size=3072 node utils/chunk-size-benchmark/local.mjs --output .bench/chunk-size --sizes 0,1,4 --repeats 1
node --test utils/chunk-size-benchmark/rabin-window.test.mjs
```

The local run generates a deterministic corpus from repository Markdown,
images, and seeded binary data. It records initial, overwrite, and insertion
stages, Chunk identifiers, reconstructed content checks, and timings. Keep
the generated corpus when comparing revisions: source Markdown may change.
Generated Vaults, logs, and results belong under `.bench/` and are not source
files for the normal test runner.

## Transport measurements

Build the CLI and start the disposable fixtures required for the chosen
transport. These use loopback ports and public benchmark-only credentials.
The scripts create and delete their own test databases and buckets.
GNU `time`, Docker Compose, and a Linux CLI runtime are required.

```sh
NODE_OPTIONS=--max-old-space-size=3072 npm run build --workspace self-hosted-livesync-cli
docker compose -p livesync-chunk-benchmark -f utils/chunk-size-benchmark/compose.yml up -d couchdb object-storage
node utils/chunk-size-benchmark/remote.mjs --output .bench/chunk-size --sizes 0,1,4 --repeats 1 --rtt-ms 0
docker compose -p livesync-chunk-benchmark -f utils/chunk-size-benchmark/compose.yml down --volumes
```

`remote.mjs` accepts `--providers couchdb`, `--providers s3`, or both, plus
`--corpus`, `--source-cli`, and `--target-cli`. Its HTTP proxy adds the requested
RTT across the request and response legs. This models per-request delay rather
than network bandwidth, packet loss, or a production service.

For P2P, start the `relay` fixture instead and run `p2p.mjs` with the same
output, corpus, size, repeat, and CLI options, omitting `--rtt-ms`. Its
DataChannel counters measure application payloads and record the selected
connection path. An archived CLI entry point needs all of its generated
CommonJS chunks beside it. Run transports sequentially and stop the named
Compose project afterwards.

## Historical analysis helpers

- `summarise.mjs`, `report.mjs`, and `verify-results.mjs` consume the original
  result layouts. The verifier requires that experiment's exact variants,
  configuration counts, and files; it is not a general mixed-version verifier.
- `cloudant-limit.mjs` temporarily changes the disposable CouchDB document
  limit and restores it afterwards. `cloudant-json-boundary.mjs` probes final
  serialised document sizes against the same fixture. These scripts model
  published Cloudant constraints; they do not connect to IBM Cloudant or
  certify its acceptance of a Vault.

Some helpers retain historical output-directory and size defaults. Supply
explicit paths and inspect their assertions before reusing them for a new
experiment. The recorded implementation matrix checks file content in both
writer directions; revision-conflict retention has separate Commonlib tests.
