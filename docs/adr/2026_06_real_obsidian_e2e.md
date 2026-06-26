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
- Added `test:e2e:obsidian:discover`, `test:e2e:obsidian:cli-help`, `test:e2e:obsidian:smoke`, `test:e2e:obsidian:vault-reflection`, and `test:e2e:obsidian:install-appimage`.
- Added `startObsidianLiveSyncSession()` so future workflows can reuse the launch, vault open, community plug-in enablement, plug-in reload, and readiness sequence without duplicating smoke runner code.
- Added a manual AppImage installer that downloads Obsidian `1.12.7` for `arm64` or `x86_64`, stores it under `_testdata/obsidian`, and extracts it for FUSE-free execution.
- Confirmed the smoke runner on Linux ARM64 with the extracted Obsidian `1.12.7` AppImage, `xvfb-run`, and the built Self-hosted LiveSync bundle.
- Confirmed the runner can enable the Obsidian CLI through isolated `obsidian.json` state, open the temporary vault through `obsidian-cli`, enable community plug-ins through `app.plugins.setEnable(true)`, reload Self-hosted LiveSync, and verify readiness through `obsidian-cli eval`.
- Removed the first test-only ready-marker bridge from the plug-in bundle. The current runner observes readiness from outside the plug-in through Obsidian's own CLI, so normal user vaults do not receive E2E marker files.

Current verification:

- `npm run tsc-check` passes.
- `npm run build` passes with existing Svelte warnings.
- `npm run test:e2e:obsidian:discover` finds `_testdata/obsidian/squashfs-root/obsidian` when the extracted AppImage is present.
- `E2E_OBSIDIAN_SMOKE_TIMEOUT_MS=1000 npm run test:e2e:obsidian:smoke` passes locally.
- `npm run test:e2e:obsidian:vault-reflection` creates a note through Obsidian's vault API, verifies the reflected file on disk, and reads it back through Obsidian.
- `npm run test:e2e:obsidian:install-appimage` reuses the existing AppImage and extracted binary when they are already present.

Known limits:

- The smoke runner currently proves only one-vault launch and plug-in load readiness. It does not yet exercise synchronisation, settings persistence, restart behaviour, or database writes.
- Cross-platform support is still discovery-level. The working path has been validated on Linux ARM64.
- CI wiring is not yet implemented. CI should use `OBSIDIAN_BINARY` or a cached `_testdata/obsidian/squashfs-root` rather than downloading the AppImage on every run.

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

### Phase 3: Two-Vault Synchronisation

- Launch two Obsidian instances with two temporary vaults.
- Configure both against the same temporary remote database.
- Create, modify, rename, and delete notes in one vault.
- Verify reflection in the other vault.
- Cover encrypted and non-encrypted configurations separately.

### Phase 4: Harness Retirement

- Mark `test/harness` as deprecated in documentation.
- Stop adding new tests to `test/suite` unless they are explicitly transitional.
- Move critical existing scenarios from `test/suite` to real Obsidian E2E or lower-level integration tests.
- Remove the harness only after the new runner covers the critical boot-up and synchronisation workflows.

## CI Strategy

Start with local-only execution. After the smoke runner is stable:

- Run the smoke test in CI on Linux.
- Keep full two-vault synchronisation scenarios as nightly or manually triggered jobs until runtime and flakiness are understood.
- Do not download the Obsidian AppImage on every CI run. Use a pre-installed Obsidian binary, a CI cache for `_testdata/obsidian/squashfs-root`, or a manually triggered preparation job.
- Capture Obsidian logs, plug-in logs, vault snapshots, and service logs on failure.
- Fail fast on launch failures, readiness timeouts, and cleanup failures with clear diagnostics.

## Risks and Mitigations

- **Obsidian licensing and installation**: CI may need a cached installer or a pre-installed binary. Keep the runner capable of using `OBSIDIAN_BINARY`.
- **Flakiness from UI timing**: Prefer a control channel and service-level probes over visual selectors.
- **Multiple instances**: Obsidian may not support multiple independent instances cleanly on all platforms. Start with one-instance smoke tests, then validate two-instance behaviour on Linux before expanding scope.
- **State leakage**: Isolate vault directories, Obsidian user data, remote database names, and bridge tokens per test.
- **Security of E2E controls**: Keep readiness and control outside the production plug-in bundle. Prefer Obsidian CLI probes over E2E-only plug-in code.
- **Runtime cost**: Keep the default PR gate small. Move slow synchronisation matrices to scheduled jobs.

## Open Questions

- Which launch mechanism is most reliable for Obsidian on Linux in this repository's CI environment?
- Can two Obsidian instances run with isolated user data at the same time?
- Do future scenarios need a richer control channel than Obsidian CLI, or can CLI `eval` and developer commands cover the required workflows?
- Should any future E2E-only plug-in code live in a separate test build, or should the production bundle remain free of E2E controls?
- Which existing `test/suite` scenarios are critical enough to port before deprecating the harness?

## Initial Implementation Checklist

1. Add an Obsidian launch discovery script that prints the detected executable, version, and launch mode.
2. Add temporary vault and plug-in installation helpers.
3. Add CLI-based plug-in readiness polling.
4. Add `test:e2e:obsidian:smoke` for one-vault plug-in load.
5. Document required local environment variables, especially `OBSIDIAN_BINARY`.
6. Port one CouchDB-backed workflow after the smoke test is stable.
7. Mark `test/harness` as transitional and block new broad E2E work from targeting it.

## Consequences

- Real Obsidian E2E becomes the source of truth for plug-in lifecycle and vault integration.
- Unit and integration tests remain the primary fast feedback loops.
- The old browser harness can be deleted once the new runner covers the critical workflows.
- The project will gain slower but higher-confidence tests for the behaviours most likely to differ between mocks and Obsidian itself.
