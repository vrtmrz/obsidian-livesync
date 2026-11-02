# Writing CLI Tests with Node.js

Add CLI end-to-end tests under `test/e2e-cli/`. This suite uses Node.js 26 native TypeScript support and the built-in `node:test` runner so that local filesystem and subprocess scenarios can run on Windows, macOS, and Linux.

## Principles

- Keep one scenario per file when practical.
- Reuse helpers from `helpers/` rather than duplicating process, Docker, or settings logic.
- Prefer deterministic data over random inputs unless randomness is explicitly required.
- Ensure every test can clean up automatically.
- Keep assertions actionable with clear failure messages.
- Keep test concurrency at one. Tests share the built CLI and may start local services.
- Use TypeScript syntax which Node can strip without compilation; `test/e2e-cli/tsconfig.json` checks this boundary.

## Directory structure

```text
test/e2e-cli/
  helpers/
    backgroundCli.ts
    cli.ts
    docker.ts
    env.ts
    p2p.ts
    settings.ts
    temp.ts
  test-*.ts
  run-task.ts
  tasks.json
  ci-tasks.json
```

## Test file naming and assertions

Use `test-<feature>.ts`, aligned with existing CLI test names where practical. Import the built-in test and assertion APIs: `test` and `describe` from `node:test`, and assertions from `node:assert/strict`. For example:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

test("feature: behaviour", async (t) => {
    await t.test("preserves the expected result", () => {
        assert.equal(actualValue, expectedValue);
    });
});
```

## Core helper usage

- `runCli(...)` and `runCliOrFail(...)` execute the CLI and return or validate its result.
- `runCliWithInputOrFail(input, ...)` supports `put` and other stdin-driven commands.
- `TempDir` and `await using` provide automatic temporary-directory cleanup.
- Settings helpers create baseline files and apply CouchDB or P2P configuration.
- Docker helpers start, initialise, and stop local CouchDB, RustFS, and relay services when a test needs them.
- `startCliInBackground(...)` manages long-running host commands such as `p2p-host`.

Prefer `try`/`finally` when a test needs explicit cleanup in addition to registered test hooks. For network-sensitive commands, use `LIVESYNC_CLI_RETRY` during debugging. Keep Docker container reuse disabled by default unless debugging.

## Task registration

Add each supported task name to `tasks.json`. A task record uses one of these forms:

- `{ "test": ["test-file.ts"] }`, optionally with a `filter` regular expression for named subtests.
- `{ "script": "script.ts" }` for a TypeScript script.
- `{ "tasks": ["task-name"] }` for an ordered task group.
- `{ "command": "...", "args": [...] }` only for the retained legacy benchmark shell scripts.

Add a task name to `ci-tasks.json` only when it belongs in the standard service-backed CI suite. That file is authoritative for both `run-ci-suite.ts` and the automatic CI matrix. Keep the local `test:local` group service-free so it remains suitable for Windows, macOS, and Linux smoke runs.

Use `npm run test:e2e:task --workspace self-hosted-livesync-cli -- <task-name>` from the repository root to run one task after building the CLI. The standard suite and canonical P2P suite use `npm run test:e2e:cli` and `npm run test:e2e:cli:p2p`, respectively. P2P network scenarios use Compose because host networking and WebRTC candidate selection are not reproducible across environments; individual host-direct P2P tasks are for explicit diagnostics.
