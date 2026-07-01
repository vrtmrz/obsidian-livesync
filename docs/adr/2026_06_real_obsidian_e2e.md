# Architectural Decision Record: Real Obsidian End-to-End Test Runner

## Status

Proposed / Spike Implemented

## Release

Not yet. Planned after the serviceFeature refactoring branch is reviewed.

## Context

The current end-to-end tests run through Vitest browser mode and a mocked Obsidian environment in `test/harness`. This has been useful for exercising synchronisation flows without launching Obsidian, but it is no longer a reliable final signal for plug-in behaviour.

The main issues are:

- The harness reimplements a large part of the Obsidian API surface, including vault files, workspace events, settings, and lifecycle behaviour. This mock can drift from real Obsidian behaviour without failing.
- The tests run inside a browser-style environment, while the desktop plug-in runs inside Obsidian's Electron environment with its own application lifecycle, storage paths, command registry, and event ordering.
- Several high-value regressions are about integration boundaries: boot-up sequence timing, real vault file reflection, Obsidian command registration, settings persistence, restart prompts, and file watcher behaviour. These are precisely the areas where a mock harness gives weak confidence.
- Maintaining the harness competes with maintaining the plug-in. Adding behaviour to the plug-in often requires teaching the mock another Obsidian detail before the actual regression can be tested.

The current harness should therefore stop being treated as the primary E2E layer.

## Decision

Introduce a new E2E layer that launches real Obsidian with temporary vaults and the built Self-hosted LiveSync plug-in installed into those vaults.

The long-term test pyramid should be:

1. Unit tests for deterministic operations and serviceFeature boundaries.
2. Integration tests for CouchDB, Object Storage, P2P services, database operations, and replication protocols.
3. Real Obsidian E2E tests for boot-up sequence, vault reflection, command registration, settings dialogues, restart scheduling, and user-visible workflows.

The existing `test/harness` should be demoted to a transitional compatibility layer. It may remain temporarily while the real Obsidian runner reaches parity for critical flows, but new high-level E2E coverage should target the real runner.

## Non-Goals

- Do not replace unit or integration tests with slow UI tests.
- Do not keep extending the Obsidian mock to cover new Obsidian APIs unless a short-term compatibility bridge is required.
- Do not require real Obsidian E2E for every pull request initially. The first CI integration should be opt-in or nightly until stability is proven.
- Do not test every setting dialogue through UI clicks if the behaviour is already covered by unit or integration tests. Use UI automation only for workflows whose risk is in real Obsidian integration.

## Proposed Architecture

### Runner

Create a dedicated runner under `test/e2e-obsidian/`.

The runner should:

- Create one or more temporary vault directories.
- Build the plug-in once with `npm run build` or a narrower production build command.
- Install `main.js`, `manifest.json`, and `styles.css` when present into `.obsidian/plugins/obsidian-livesync/`.
- Prepare `.obsidian/community-plugins.json` and `.obsidian/plugins/obsidian-livesync/data.json` as needed.
- Launch Obsidian against the temporary vault.
- Wait until the plug-in reports readiness through a deterministic probe.
- Drive assertions through a narrow control channel rather than fragile visual selectors wherever possible.
- Dispose of Obsidian and temporary vaults after each scenario.

### Obsidian Launch

The preferred desktop target is the installed Obsidian application. The launch mechanism should be platform-specific but hidden behind a small adapter:

- Linux: launch the Obsidian executable with a vault path or Obsidian URI, depending on what is most reliable. If an AppImage is used and FUSE is not available, extract it with `--appimage-extract` and launch the extracted `squashfs-root/obsidian` binary.
- macOS: launch the app bundle through `open` or the executable inside the bundle.
- Windows: launch the installed executable or the registered application protocol.

The first implementation can support Linux only if that is the local and CI target. Cross-platform support can be added after the runner contract is stable.

In headless Linux environments, launch through `xvfb-run`, pass Electron flags such as `--no-sandbox` and `--disable-gpu`, and isolate `HOME`, `XDG_CONFIG_HOME`, and `--user-data-dir` per temporary vault.

### Control Channel

The runner needs a stable way to observe readiness and issue test commands. Prefer a test-only plug-in bridge compiled only in test builds or enabled only by an environment variable.

Possible bridge options:

- The official Obsidian CLI, using the installed `obsidian-cli` helper to open vaults, reload the plug-in, run `eval`, and call developer commands.
- A local HTTP/WebSocket bridge bound to `127.0.0.1` with a random port and token.
- A file-based bridge in the vault, where Obsidian writes status files and consumes command files.
- A DevTools protocol bridge if Obsidian exposes a stable debugging port in the test environment.

The first implementation uses Obsidian's CLI for orchestration and readiness checks. The CLI handles vault opening through `obsidian://open?path=...`, enables community plug-ins through `app.plugins.setEnable(true)`, reloads Self-hosted LiveSync through `plugin:reload id=obsidian-livesync`, and verifies that `app.plugins.plugins['obsidian-livesync']` is loaded.

This keeps E2E-only behaviour out of the production plug-in bundle. The runner should not require Self-hosted LiveSync to write marker files or expose a test server merely to prove that Obsidian loaded it.

The DevTools protocol remains useful for diagnostics. Obsidian's CLI exposes developer commands such as `dev:cdp`, `dev:errors`, and `dev:console`, so the runner should prefer the CLI path first and fall back to direct DevTools attachment only if the CLI cannot provide the required signal.

### Test Data and Services

Keep the existing Docker scripts for CouchDB, MinIO, and P2P services. The real Obsidian runner should reuse these service fixtures instead of creating another service orchestration stack.

Each test should use unique database names, bucket prefixes, vault names, and P2P room IDs. This prevents tests from depending on cleanup and makes interrupted runs less harmful.

## Migration Plan

### Phase 0: Discovery

- Confirm how Obsidian can be launched reliably on the local development environment.
- Confirm whether Obsidian accepts a vault path directly, requires an Obsidian URI, or needs a pre-existing vault registry.
- Identify where Obsidian stores per-user state in the test environment and decide how to isolate it.
- Decide whether the first bridge is file-based or HTTP/WebSocket.

Initial discovery on Linux ARM64 found that:

- `Obsidian-1.12.7-arm64.AppImage` requires `libfuse.so.2` for direct AppImage execution.
- Extracting the AppImage with `--appimage-extract` works without FUSE.
- Launching the extracted `squashfs-root/obsidian` binary under `xvfb-run` with isolated user data stays alive for the smoke timeout.
- No missing shared libraries were reported by `ldd` for the extracted binary in the tested environment.
- Obsidian's CLI is disabled unless the global `obsidian.json` contains `cli: true`.
- Passing only `.obsidian/community-plugins.json` is not enough to load community plug-ins on Obsidian 1.12. The runner also has to enable the global community plug-in switch through `app.plugins.setEnable(true)`.
- The reliable launch sequence is: start Obsidian, send `obsidian://open?path=...` through `obsidian-cli`, wait until the vault-side CLI exposes the plug-in catalogue, enable community plug-ins, reload Self-hosted LiveSync, and verify plug-in readiness through `obsidian-cli eval`.

### Phase 1: Smoke Runner

- Add `test/e2e-obsidian/runner` utilities for temporary vault creation, plug-in installation, launch, readiness wait, and cleanup.
- Add one smoke test:
    - launch Obsidian with an empty vault,
    - load Self-hosted LiveSync,
    - wait for the boot-up sequence to become ready,
    - read the plug-in version or status through the control channel,
    - close Obsidian cleanly.
- Add an npm script such as `test:e2e:obsidian`.

Current implementation status:

- Added `test/e2e-obsidian/runner` helpers for Obsidian discovery, CLI discovery, temporary vault creation, plug-in installation, process launch, CLI execution, and readiness polling.
- Added `test:e2e:obsidian:discover`, `test:e2e:obsidian:cli-help`, `test:e2e:obsidian:smoke`, `test:e2e:obsidian:vault-reflection`, `test:e2e:obsidian:couchdb-upload`, `test:e2e:obsidian:minio-upload`, `test:e2e:obsidian:startup-scan`, `test:e2e:obsidian:two-vault-sync`, `test:e2e:obsidian:hidden-file-snippet-sync`, `test:e2e:obsidian:customisation-sync`, `test:e2e:obsidian:setting-markdown-export`, `test:e2e:obsidian:local-suite`, `test:e2e:obsidian:local-suite:services`, and `test:e2e:obsidian:install-appimage`.
- Added `startObsidianLiveSyncSession()` so future workflows can reuse the launch, trusted temporary vault state, vault open, community plug-in reload, and readiness sequence without duplicating smoke runner code.
- Added CouchDB runner utilities that reuse `.test.env`/process environment values, create unique temporary databases, query uploaded documents directly, and clean up the database unless `E2E_OBSIDIAN_KEEP_COUCHDB=true` is set.
- Added a manual AppImage installer that downloads Obsidian `1.12.7` for `arm64` or `x86_64`, stores it under `_testdata/obsidian`, and extracts it for FUSE-free execution.
- Confirmed the smoke runner on Linux ARM64 with the extracted Obsidian `1.12.7` AppImage, `xvfb-run`, and the built Self-hosted LiveSync bundle.
- Confirmed the runner can enable the Obsidian CLI through isolated `obsidian.json` state, pre-seed the temporary Chromium local storage so the generated vault ID is trusted for community plug-ins, open the temporary vault through `obsidian-cli`, reload Self-hosted LiveSync, and verify readiness through `obsidian-cli eval`.
- Removed the first test-only ready-marker bridge from the plug-in bundle. The current runner observes readiness from outside the plug-in through Obsidian's own CLI, so normal user vaults do not receive E2E marker files.

Current verification:

- `npm run tsc-check` passes.
- `npm run build` passes with existing Svelte warnings.
- `npm run test:e2e:obsidian:discover` finds `_testdata/obsidian/squashfs-root/obsidian` when the extracted AppImage is present.
- `E2E_OBSIDIAN_SMOKE_TIMEOUT_MS=1000 npm run test:e2e:obsidian:smoke` passes locally.
- `npm run test:e2e:obsidian:vault-reflection` creates a note through Obsidian's vault API, verifies the reflected file on disk, and reads it back through Obsidian.
- `npm run test:e2e:obsidian:couchdb-upload` configures a unique CouchDB database, creates a note through Obsidian, commits it into the local database, runs one-shot synchronisation, and verifies that CouchDB contains the metadata document and all referenced chunk documents.
- `npm run test:e2e:obsidian:minio-upload` configures a unique Object Storage bucket prefix, creates a note through Obsidian, runs one-shot Journal Sync, and verifies through the AWS SDK that objects were written to the S3-compatible bucket.
- `npm run test:e2e:obsidian:startup-scan` verifies that a file written while Obsidian is stopped is picked up during the next real Obsidian boot and uploaded to CouchDB after one-shot synchronisation.
- `npm run test:e2e:obsidian:two-vault-sync` verifies two-vault note synchronisation: creation, update, rename, deletion, per-device target-filter differences, and a separate encrypted round-trip with Path Obfuscation enabled. The experimental Markdown conflict automatic merge check is available with `E2E_OBSIDIAN_INCLUDE_MARKDOWN_CONFLICT=true` but is not part of the default local suite.
- `npm run test:e2e:obsidian:hidden-file-snippet-sync` verifies hidden file synchronisation as a two-vault round-trip: creation, deletion, automatic JSON conflict merging with the merged result propagated by a second synchronisation, manual JSON Resolve dialogue application through Obsidian's UI, and per-device target-pattern differences.
- `npm run test:e2e:obsidian:customisation-sync` verifies a two-vault Customisation Sync workflow: scan a real snippet CSS file, config JSON file, and sample plug-in fixture into per-file Customisation Sync data, synchronise them through CouchDB, apply them on the second vault, assert the resulting `.obsidian` files, propagate a snippet update, and verify deletion of the source-vault snippet sync data without confusing it with the target vault's own applied copy.
- `npm run test:e2e:obsidian:setting-markdown-export` verifies that setting Markdown export creates a vault file and omits credentials when credential export is disabled.
- `npm run test:e2e:obsidian:install-appimage` reuses the existing AppImage and extracted binary when they are already present.
- `npm run test:e2e:obsidian:local-suite` runs the local verification sequence for the real Obsidian runner after CouchDB and MinIO have been started.
- `npm run test:e2e:obsidian:local-suite:services` stops leftover CouchDB and MinIO fixtures, starts fresh fixtures, runs the local suite, and stops the fixtures again.
- `npm run test:e2e:obsidian:local-suite:services` has been verified locally with real Obsidian, CouchDB, and MinIO. The run completed discovery, smoke, vault reflection, CouchDB upload, Object Storage upload, startup scan, two-vault synchronisation, Hidden File Sync, Customisation Sync, and setting Markdown export. The build step still emits existing Svelte warnings.

Known limits:

- The smoke runner currently proves only one-vault launch and plug-in load readiness. Broader workflows are covered by separate real Obsidian scripts, including CouchDB upload, startup scan, two-vault note synchronisation, Hidden File Sync, Customisation Sync, and setting Markdown export.
- Cross-platform support is still discovery-level. The working path has been validated on Linux ARM64. macOS and Windows should be validated in their own environments as follow-up work.
- CI wiring is intentionally not implemented. The runner depends on a licensed desktop application and is treated as a local verification tool.

### Phase 2: First Real Workflow

- Add a one-vault local workflow:
    - configure a temporary CouchDB database,
    - create a note in the real vault,
    - wait for metadata and chunks to be stored,
    - restart Obsidian,
    - verify that the plug-in loads and the note remains consistent.

This validates real boot-up, settings persistence, vault file access, database writes, and restart-sensitive state.

Current implementation status:

- Added a pre-CouchDB workflow that creates a note through Obsidian's vault API, confirms the note is reflected as a real vault file, and reads the same note back through Obsidian. This covers the vault reflection part of the Phase 2 path before remote database setup is introduced.
- Added a first CouchDB-backed upload workflow, modelled after the CLI Deno tests: reuse the standard CouchDB environment variables, create a unique remote database, apply CouchDB settings through the plug-in's setting service, commit the note through the real Obsidian vault path, run one-shot synchronisation, and assert that remote metadata and chunks exist.
- Added an Object Storage-backed upload workflow against MinIO to exercise Journal Sync and the AWS SDK path from real Obsidian.
- Added Obsidian-specific workflows for boot-time vault scanning, two-vault note synchronisation, hidden `.obsidian/snippets` file round-tripping, hidden JSON conflict resolution, Customisation Sync application for snippets, config JSON files, and plug-in fixtures, per-device target-filter differences, and setting Markdown export. These scenarios assert against CouchDB documents, vault files, or real Obsidian UI outcomes instead of internal service state.

### Phase 3: Two-Vault Synchronisation

- Launch two Obsidian instances with two temporary vaults.
- Configure both against the same temporary remote database.
- Create, modify, rename, and delete notes in one vault.
- Verify reflection in the other vault.
- Cover encrypted and non-encrypted configurations separately.

Current implementation status:

- `test:e2e:obsidian:two-vault-sync` covers creation, update, rename, deletion, and per-device target-filter behaviour for a non-encrypted CouchDB configuration. Markdown conflict automatic merging remains an optional check because it needs a dedicated, less timing-sensitive fixture.
- The same script creates a separate temporary CouchDB database and temporary vault pair for an encrypted two-vault round-trip with Path Obfuscation enabled.

### Phase 4: Harness Retirement

- Mark `test/harness` as deprecated in documentation.
- Stop adding new tests to `test/suite` unless they are explicitly transitional.
- Do not mechanically port `test/suite` into real Obsidian E2E. Scenarios that can already be exercised and asserted through the CLI test layer should stay there or move to lower-level integration tests.
- Prioritise real Obsidian coverage for behaviours that the CLI cannot prove well, especially RedFlag flag-file recovery flows, Fast Setup (Simple Fetch), boot-up sequencing, restart-sensitive initial synchronisation, and user-visible recovery dialogues.
- Remove the harness only after the new runner covers the critical boot-up and synchronisation workflows.

Current implementation status:

- `test/harness` is now documented as a transitional compatibility layer.
- New broad E2E work should target `test/e2e-obsidian/` when real Obsidian behaviour is the risk being tested.
- The next high-value scenarios are RedFlag variants and Fast Setup (Simple Fetch) variants, not a line-by-line migration of `test/suite`.

## Local Verification Strategy

Real Obsidian E2E is a local verification layer. It should not be wired into the default CI gate.

- Keep the scripts individually runnable for focused local debugging.
- Provide `test:e2e:obsidian:local-suite` for a broader local pass after the CouchDB and MinIO fixtures have been started.
- Provide `test:e2e:obsidian:local-suite:services` for a broader local pass that manages the CouchDB and MinIO fixtures itself.
- Use `OBSIDIAN_BINARY` when testing against an installed desktop application.
- Use `test:e2e:obsidian:install-appimage` on Linux when a local AppImage copy is needed, and reuse the extracted `_testdata/obsidian/squashfs-root` directory between local runs.
- Capture Obsidian logs, plug-in logs, vault snapshots, and service logs manually when investigating failures.
- Fail fast on launch failures, readiness timeouts, and cleanup failures with clear diagnostics.

## Risks and Mitigations

- **Obsidian licensing and installation**: Keep the runner local-first and capable of using `OBSIDIAN_BINARY`.
- **Flakiness from UI timing**: Prefer a control channel and service-level probes over visual selectors.
- **Multiple instances**: Obsidian may not support multiple independent instances cleanly on all platforms. Start with one-instance smoke tests, then validate two-instance behaviour on Linux before expanding scope.
- **State leakage**: Isolate vault directories, Obsidian user data, remote database names, and bridge tokens per test.
- **Security of E2E controls**: Keep readiness and control outside the production plug-in bundle. Prefer Obsidian CLI probes over E2E-only plug-in code.
- **Runtime cost**: Keep real Obsidian E2E out of the default PR gate. Use focused scripts or the local suite when a change touches real Obsidian integration.

## Open Questions

- Which launch mechanism is most reliable for Obsidian on each supported desktop platform?
- Can two Obsidian instances run with isolated user data at the same time?
- Do future scenarios need a richer control channel than Obsidian CLI, or can CLI `eval` and developer commands cover the required workflows?
- Should any future E2E-only plug-in code live in a separate test build, or should the production bundle remain free of E2E controls?
- Which RedFlag and Fast Setup (Simple Fetch) variants should be added first?

## Initial Implementation Checklist

1. Add an Obsidian launch discovery script that prints the detected executable, version, and launch mode.
2. Add temporary vault and plug-in installation helpers.
3. Add CLI-based plug-in readiness polling.
4. Add `test:e2e:obsidian:smoke` for one-vault plug-in load.
5. Document required local environment variables, especially `OBSIDIAN_BINARY`.
6. Port one CouchDB-backed workflow after the smoke test is stable.
7. Mark `test/harness` as transitional and block new broad E2E work from targeting it.
8. Add the local suite script for broader local verification.

## Consequences

- Real Obsidian E2E becomes the source of truth for plug-in lifecycle and vault integration.
- Unit and integration tests remain the primary fast feedback loops.
- The old browser harness can be deleted once the new runner covers the critical workflows.
- The project will gain slower but higher-confidence tests for the behaviours most likely to differ between mocks and Obsidian itself.
