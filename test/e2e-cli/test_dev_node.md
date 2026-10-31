# CLI Node.js Test Development Notes

The CLI test suite under `test/e2e-cli/` uses Node.js 26 native TypeScript execution and the built-in `node:test` runner. The standard service-backed suite is selected by `ci-tasks.json`. P2P scenarios use the repository Compose entry point so that networking, signalling, and the runner environment are reproducible. Existing Bash tests under `src/apps/cli/test/` remain available as compatibility references.

## Goals and structure

- Run CLI subprocess and filesystem scenarios on Windows, macOS, and Linux.
- Use Node.js standard modules and shared helpers in place of a separate test runtime.
- Keep the default service-backed suite and canonical Compose P2P suite distinct.

```text
test/e2e-cli/
  tasks.json
  ci-tasks.json
  run-task.ts
  run-ci-suite.ts
  run-compose-p2p.ts
  run-coverage.ts
  helpers/
  test-*.ts
```

Node executes erasable TypeScript syntax directly. The scoped `test/e2e-cli/tsconfig.json` checks that test files stay within that runtime boundary. The task runner uses one test worker at a time and loads the CLI package `.test.env` file when present.

## Task manifest

`tasks.json` preserves named test and benchmark entry points as structured records. A record can name test files and an optional test-name filter, a TypeScript script, an ordered list of other tasks, or a command with arguments for the retained benchmark shell scripts. Shell commands are restricted to those legacy benchmark tasks.

`ci-tasks.json` is the source of truth for the default service-backed CI task list. Keep it aligned with the `test:ci` task runner. `test:local` groups setup, mirror, and daemon smoke tasks which do not require Docker.

## Test coverage

- `test-setup-put-cat.ts` covers setup URI generation and core CLI commands without a remote service.
- `test-mirror.ts` covers seven mirror scenarios, including unknown revision provenance, conflict preservation, deduplication, and resolution.
- `test-daemon.ts` and `test-daemon-startup.ts` cover daemon ignore rules and startup behaviour.
- `test-push-pull.ts`, `test-sync-two-local-databases.ts`, and `test-sync-locked-remote.ts` cover remote synchronisation and locking.
- `test-decoupled-vault.ts` covers a vault directory which is separate from the database directory.
- `test-remote-commands.ts`, `test-remote-administration-exit-codes.ts`, and `test-settings-writeback.ts` cover remote management and settings behaviour.
- P2P tests cover host startup, peer discovery, synchronisation, automatic host policy, replacement, relay disconnection, multi-node conflicts, and upload/download. The Compose suite runs the canonical synchronisation, replacement, and relay-disconnection scenarios.
- `test-e2e-two-vaults-couchdb.ts` and `test-e2e-two-vaults-matrix.ts` cover two-vault CouchDB and CouchDB/Object Storage cases.

## Running tests

Run the canonical workflows from the repository root. These npm scripts build the CLI before the suite where needed:

```bash
npm run test:e2e:cli
npm run test:e2e:cli:p2p
npm run test:e2e:cli:all
```

Run an individual named task after building the CLI:

```bash
npm run test:e2e:task --workspace self-hosted-livesync-cli -- test:mirror
```

The local smoke set is also available as `test:local`. It runs setup, mirror, and daemon tests without starting Docker services. To run the mirror file directly from its directory:

```bash
cd test/e2e-cli
node --env-file-if-exists=../../src/apps/cli/.test.env --test --test-concurrency=1 test-mirror.ts
```

Collect CLI body coverage with the local smoke suite, or pass `test:ci` to cover the standard service-backed suite:

```bash
npm run test:e2e:coverage --workspace self-hosted-livesync-cli
npm run test:e2e:coverage --workspace self-hosted-livesync-cli -- test:ci
```

The runner defaults to `test:local`, which does not require services. It writes HTML, JSON, and text reports under `coverage/cli-e2e/`. The runner enables CLI bundle source maps only for the coverage build with `LIVESYNC_CLI_COVERAGE=1`; ordinary builds do not enable them.

## Environment variables

### CouchDB

- `COUCHDB_URI`
- `COUCHDB_USER`
- `COUCHDB_PASSWORD`
- `COUCHDB_DBNAME`

The equivalent keys in `.test.env` are `hostname`, `username`, `password`, and `dbname`.

### Behaviour switches

- `LIVESYNC_START_DOCKER=0`: use an existing CouchDB service.
- `REMOTE_PATH`: override the target path for selected tests.
- `LIVESYNC_TEST_TEE=1`: stream CLI stdout and stderr during execution.
- `LIVESYNC_DOCKER_TEE=1`: stream Docker stdout and stderr.
- `LIVESYNC_CLI_RETRY=<n>`: retry transient network failures.
- `LIVESYNC_DEBUG_KEEP_DOCKER=1`: keep `couchdb-test` after a test completes.

### Docker command selection

`helpers/docker.ts` supports `LIVESYNC_DOCKER_MODE=auto` by default. On Windows it tries `wsl docker` first, then `docker`; on other platforms it tries `docker` first, then `wsl docker`. Set `LIVESYNC_DOCKER_MODE=native` or `LIVESYNC_DOCKER_MODE=wsl` to select one explicitly. `LIVESYNC_DOCKER_COMMAND` takes priority and can specify a custom command, such as `wsl docker`.

### P2P

- `RELAY`
- `ROOM_ID`
- `PASSPHRASE`
- `APP_ID`
- `PEERS_TIMEOUT`
- `SYNC_TIMEOUT`
- `USE_INTERNAL_RELAY=0|1`
- `TIMEOUT_SECONDS`

## Continuous integration

The `.github/workflows/cli-node-tests.yml` workflow runs for changes to the CLI or its shared runtime inputs. Its Linux `prepare` job builds the CLI once and distributes that bundle to the Linux service-backed test jobs. The `local-smoke` job runs automatically on pushes and non-draft pull requests, and also when `test:local` is selected manually; it builds the CLI once on each of Ubuntu, macOS, and Windows and starts no Docker services.

The separate `.github/workflows/cli-p2p-tests.yml` workflow runs the canonical Compose P2P suite for CLI and `test/bench-network/` changes. A change confined to Compose fixtures does not start the non-P2P matrix.

The `.github/workflows/cli-docker-validation.yml` workflow still builds the production CLI bundle with Node.js 22, then validates Docker images on native amd64 and arm64 runners. That release-image runtime remains independent of the Node.js version used by CLI E2E tests.

## Maintenance policy

Keep scenarios in Node test files and reuse helpers from `helpers/`. Preserve the authoritative CI task list in `ci-tasks.json`. Retain the Bash suites and benchmark wrappers until their corresponding migration has been separately agreed and completed.
