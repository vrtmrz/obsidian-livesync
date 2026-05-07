# CLI Deno Test Development Notes

This document provides an overview of the Deno-based compatibility tests under `src/apps/cli/testdeno/`.
The existing bash tests under `src/apps/cli/test/` are preserved, while a Windows-friendly suite is maintained in parallel.

---

## Goals

- Keep existing bash tests intact.
- Provide direct execution from Windows PowerShell.
- Establish a TypeScript (Deno) foundation for core end-to-end and integration scenarios.

---

## Directory structure

```
src/apps/cli/testdeno/
  deno.json
  CONTRIBUTING_TESTS.md
  helpers/
    backgroundCli.ts
    cli.ts
    docker.ts
    env.ts
    p2p.ts
    settings.ts
    temp.ts
  test-e2e-two-vaults-couchdb.ts
  test-push-pull.ts
  test-p2p-host.ts
  test-p2p-peers-local-relay.ts
  test-p2p-sync.ts
  test-p2p-three-nodes-conflict.ts
  test-p2p-upload-download-repro.ts
  test-e2e-two-vaults-matrix.ts
  test-setup-put-cat.ts
  test-mirror.ts
  test-sync-two-local-databases.ts
  test-sync-locked-remote.ts
```

---

## Key files

### `deno.json`

- Defines Deno tasks.
- Defines import maps for `@std/assert` and `@std/path`.

Main tasks:

- `deno task test`
- `deno task test:local`
- `deno task test:push-pull`
- `deno task test:setup-put-cat`
- `deno task test:mirror`
- `deno task test:sync-two-local`
- `deno task test:sync-locked-remote`
- `deno task test:p2p-host`
- `deno task test:p2p-peers`
- `deno task test:p2p-sync`
- `deno task test:p2p-three-nodes`
- `deno task test:p2p-upload-download`
- `deno task test:e2e-couchdb`
- `deno task test:e2e-matrix`

### `helpers/cli.ts`

- CLI execution wrappers.
- `runCli`, `runCliOrFail`, `runCliWithInput`.
- Output normalisation via `sanitiseCatStdout`.
- Comparison utilities, including `assertFilesEqual`.

This file corresponds to `run_cli` and common assertions in `test-helpers.sh`.

### `helpers/settings.ts`

- Executes `init-settings --force`.
- Marks `isConfigured = true`.
- Applies CouchDB and P2P settings.
- Applies remote synchronisation settings and P2P test tweaks.

This file corresponds to settings helpers in `test-helpers.sh`.

### `helpers/docker.ts`

- Starts, stops, and initialises CouchDB directly from Deno.
- Configures CouchDB via `fetch + retry`.
- Starts and stops the P2P relay through the same Docker runner.

Both CouchDB and P2P relay flows are bash-independent.

### `helpers/backgroundCli.ts`

- Starts long-running commands such as `p2p-host` in the background.
- Waits for readiness logs and handles termination.

### `helpers/p2p.ts`

- Determines whether a local relay should be started.
- Parses `p2p-peers` output.
- Discovers peer IDs with a fallback based on advertisement logs.

### `helpers/env.ts`

- Loads `.test.env`.
- Supports `KEY=value`, single-quoted values, and double-quoted values.

### `helpers/temp.ts`

- Provides `TempDir`.
- Uses `await using` to auto-clean temporary directories.

---

## Implemented tests

### `test-push-pull.ts`

- Verifies push and pull round trips.
- Uses environment variables or `.test.env` for CouchDB values.

### `test-setup-put-cat.ts`

- Verifies `setup` with full setup URI generation via `encodeSettingsToSetupURI`.
- Verifies `push`, `cat`, `ls`, `info`, `rm`, `resolve`, `cat-rev`, and `pull-rev`.
- Does not require an external remote.

### `test-mirror.ts`

- Verifies six core mirror scenarios.
- Does not require an external remote.

### `test-sync-two-local-databases.ts`

- Verifies sync between two vaults and CouchDB.
- Verifies conflict detection and resolve propagation.
- Starts Docker CouchDB by default when `LIVESYNC_START_DOCKER != 0`.

### `test-sync-locked-remote.ts`

- Updates the CouchDB milestone `locked` flag.
- Verifies sync success when unlocked.
- Verifies actionable CLI error when locked.

### `test-p2p-host.ts`

- Verifies that `p2p-host` starts and emits readiness output.

### `test-p2p-peers-local-relay.ts`

- Verifies peer discovery through a local relay.

### `test-p2p-sync.ts`

- Verifies that `p2p-sync` completes after peer discovery.

### `test-p2p-three-nodes-conflict.ts`

- Uses one host and two clients.
- Verifies conflict creation, detection via `info`, and resolution via `resolve`.

### `test-p2p-upload-download-repro.ts`

- Uses host, upload, and download nodes.
- Verifies transfer of text files and binary files, including larger files.

### `test-e2e-two-vaults-couchdb.ts`

- Verifies two-vault end-to-end scenarios on CouchDB.
- Runs both encryption-off and encryption-on cases.
- Includes conflict marker checks in `ls` and resolve propagation checks.

### `test-e2e-two-vaults-matrix.ts`

- Verifies the matrix equivalent of the bash script.
- Runs four combinations:
  - `COUCHDB-enc0`
  - `COUCHDB-enc1`
  - `MINIO-enc0`
  - `MINIO-enc1`

---

## Running tests (PowerShell)

From `src/apps/cli/testdeno`:

```powershell
cd src/apps/cli/testdeno

# Local-only set
deno task test:local

# Individual tests
deno task test:setup-put-cat
deno task test:mirror
deno task test:push-pull
deno task test:sync-locked-remote

# CouchDB-based tests
deno task test:sync-two-local
deno task test:e2e-couchdb

# P2P-based tests
deno task test:p2p-host
deno task test:p2p-peers
deno task test:p2p-sync
deno task test:p2p-three-nodes
deno task test:p2p-upload-download
deno task test:e2e-matrix
```

---

## Environment variables

### CouchDB

- `COUCHDB_URI`
- `COUCHDB_USER`
- `COUCHDB_PASSWORD`
- `COUCHDB_DBNAME`

Equivalent keys in `src/apps/cli/.test.env`:

- `hostname`
- `username`
- `password`
- `dbname`

### Behaviour switches

- `LIVESYNC_START_DOCKER=0`: use existing CouchDB.
- `REMOTE_PATH`: override target path for selected tests.
- `LIVESYNC_TEST_TEE=1`: stream CLI stdout and stderr during execution.
- `LIVESYNC_DOCKER_TEE=1`: stream Docker stdout and stderr.
- `LIVESYNC_CLI_RETRY=<n>`: retry transient network failures.
- `LIVESYNC_DEBUG_KEEP_DOCKER=1`: keep `couchdb-test` after test completion.

### Docker command selection

`helpers/docker.ts` supports command selection via environment variables.

- `LIVESYNC_DOCKER_MODE=auto` (default)
  - Windows: tries `wsl docker` first, then `docker`.
  - Non-Windows: tries `docker` first, then `wsl docker`.
- `LIVESYNC_DOCKER_MODE=native`: always uses `docker`.
- `LIVESYNC_DOCKER_MODE=wsl`: always uses `wsl docker`.
- `LIVESYNC_DOCKER_COMMAND="..."`: custom command, for example `wsl docker`.

`LIVESYNC_DOCKER_COMMAND` has priority over `LIVESYNC_DOCKER_MODE`.

PowerShell examples:

```powershell
# Use Docker in WSL explicitly
$env:LIVESYNC_DOCKER_MODE = "wsl"
deno task test:sync-two-local

# Full custom command
$env:LIVESYNC_DOCKER_COMMAND = "wsl docker"
deno task test:sync-two-local
```

### P2P

- `RELAY`
- `ROOM_ID`
- `PASSPHRASE`
- `APP_ID`
- `PEERS_TIMEOUT`
- `SYNC_TIMEOUT`
- `USE_INTERNAL_RELAY=0|1`
- `TIMEOUT_SECONDS`

---

## Continuous Integration

The GitHub Actions workflow `.github/workflows/cli-deno-tests.yml` is used to run these tests automatically on push and pull requests affecting the CLI.

---

## Current limitations

- MinIO startup and matrix coverage are ported. Current limits are elsewhere, not setup URI generation.

---

## Maintenance policy

- Existing bash tests remain available.
- Deno tests are expanded in parallel for cross-platform usage.
- New scenarios should be added through reusable helpers in `helpers/`.
