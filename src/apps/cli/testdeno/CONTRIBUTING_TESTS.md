# Writing CLI Tests on Deno

This guide explains how to add or update tests under `src/apps/cli/testdeno/`.
Note that new tests should be added to the Deno suite rather than the existing bash suite due to the cross-platform execution and TypeScript benefits.

## Scope

The Deno suite is designed for cross-platform execution, with a strong focus on Windows compatibility while keeping behaviour equivalent to existing bash tests.

## Principles

- Keep one scenario per file when practical.
- Reuse helpers from `helpers/` rather than duplicating process, Docker, or settings logic.
- Prefer deterministic data over random inputs unless randomness is explicitly required.
- Ensure every test can clean up automatically.
- Keep assertions actionable with clear failure messages.

## Directory structure

```
src/apps/cli/testdeno/
  helpers/
    backgroundCli.ts
    cli.ts
    docker.ts
    env.ts
    p2p.ts
    settings.ts
    temp.ts
  test-*.ts
  deno.json
```

## Test file naming

- Use `test-<feature>.ts`.
- Use names aligned with existing bash tests when porting, for example:
  - `test-sync-locked-remote.ts`
  - `test-p2p-sync.ts`

## Core helper usage

### Temporary workspace

Use `TempDir` and `await using` so cleanup is automatic:

```ts
await using workDir = await TempDir.create("livesync-cli-my-test");
```

### CLI execution

- `runCli(...)`: returns code and combined output.
- `runCliOrFail(...)`: throws on non-zero exit.
- `runCliWithInputOrFail(input, ...)`: for `put` and stdin-driven commands.

### Settings

- `initSettingsFile(...)`: creates a baseline settings file.
- `applyCouchdbSettings(...)`: applies CouchDB fields.
- `applyRemoteSyncSettings(...)`: applies remote and encryption fields.
- `applyP2pSettings(...)`: applies P2P fields.
- `applyP2pTestTweaks(...)`: enables P2P-only test profile.

### Docker services

- `startCouchdb(...)`, `stopCouchdb()`
- `startP2pRelay()`, `stopP2pRelay()`

### P2P discovery

- `discoverPeer(...)`
- `maybeStartLocalRelay(...)`
- `stopLocalRelayIfStarted(...)`

### Background host process

Use `startCliInBackground(...)` for long-running host mode such as `p2p-host`.

## Recommended test structure

1. Arrange
2. Act
3. Assert
4. Cleanup in `finally`

Example skeleton:

```ts
Deno.test("feature: behaviour", async () => {
  await using workDir = await TempDir.create("example");
  // Arrange

  try {
    // Act

    // Assert
  } finally {
    // Optional explicit cleanup
  }
});
```

## Reliability guidelines

- Use explicit waits only when needed for eventual consistency.
- Re-run sync operations where the protocol is eventually consistent.
- For network-sensitive commands, use `LIVESYNC_CLI_RETRY` during debugging.
- Keep Docker container reuse disabled by default unless debugging.

## Environment variables

Common variables:

- `LIVESYNC_DOCKER_MODE`
- `LIVESYNC_DOCKER_COMMAND`
- `LIVESYNC_TEST_TEE`
- `LIVESYNC_DOCKER_TEE`
- `LIVESYNC_CLI_DEBUG`
- `LIVESYNC_CLI_VERBOSE`
- `LIVESYNC_CLI_RETRY`
- `LIVESYNC_DEBUG_KEEP_DOCKER`

P2P variables:

- `RELAY`
- `ROOM_ID`
- `PASSPHRASE`
- `APP_ID`
- `PEERS_TIMEOUT`
- `SYNC_TIMEOUT`
- `USE_INTERNAL_RELAY`

## Adding a new test task

1. Add the test file under `src/apps/cli/testdeno/`.
2. Add a task in `src/apps/cli/testdeno/deno.json`.
3. Update `src/apps/cli/testdeno/test_dev_deno.md`.
4. Run the new task locally.

## Validation checklist

- The test passes on a clean workspace.
- The test does not leave persistent artefacts unless explicitly requested.
- Failure messages identify both expected and actual behaviour.
- The corresponding task is documented.

## Out of scope for this suite

- One-off reproduction scripts that are not intended as stable regression tests.
