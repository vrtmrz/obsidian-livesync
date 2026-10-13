# Real Obsidian E2E Runner

This directory contains the maintained real Obsidian end-to-end runner.

The generic application discovery, isolated-vault, plug-in installation, process lifecycle, CLI, CDP, and readiness implementation comes from `@vrtmrz/obsidian-test-session`. The small modules under `runner/` preserve LiveSync's existing imports and supply its plug-in ID and artefact location. LiveSync-specific fixtures, services, settings, workflows, and assertions remain in this repository.

The current smoke runner verifies the launch path and the loaded plug-in's Service Context composition:

1. create a temporary vault,
2. install the built Self-hosted LiveSync plug-in artefacts,
3. launch real Obsidian,
4. open the temporary vault through `obsidian-cli`,
5. prepare the isolated Vault trust state and handle any Obsidian trust prompt,
6. preserve natural plug-in loading, or complete requested pre-load work before loading the plug-in once in controlled start-up,
7. verify through the active renderer that the plug-in is loaded,
8. observe event and translation results from the actual `ObsidianServiceContext`,
9. verify that the Service Hub and every exposed service retain that exact Context,
10. optionally drive a real vault or CouchDB workflow through Obsidian's own API, and
11. terminate Obsidian and remove the temporary vault.

The runner does not require Self-hosted LiveSync to expose an E2E-only bridge. Readiness is checked from outside the plug-in through Obsidian's own CLI.

Obsidian 1.12 stores the global community plug-in switch outside `.obsidian/community-plugins.json`. The smoke runner enables it through `app.plugins.setEnable(true)` after the vault window is available.

Future workflows should use `startObsidianLiveSyncSession()` from `runner/session.ts` rather than repeating the launch and plug-in readiness sequence. Add generic Obsidian bootstrap improvements to Fancy Kit; keep LiveSync behaviour and scenario helpers here.

When a LiveSync-owned scenario must establish application state before the plug-in's first load, pass an instance-scoped `lifecycle.beforePluginStart` callback through that wrapper. For example, the P2P pane scenario calls `setObsidianMobileTestModeBeforePluginStart()` there so LiveSync observes the mobile application state while registering its command and view. Mobile emulation reopens Obsidian's workspace layout; this helper waits for both the `is-mobile` body state and `workspace.layoutReady` before controlled loading continues. The shared package owns the controlled start-up order and guarantees that the plug-in loads once; the LiveSync scenario owns the resulting command, workspace placement, and visible UI assertions. Changing the state only after loading the plug-in is not evidence of its mobile start-up behaviour.

Each test vault uses an isolated Obsidian profile. The runner creates temporary directories for `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, and Electron `--user-data-dir`, writes the vault registry into those directories, pre-seeds the temporary Chromium local storage so community plug-ins are trusted for that generated vault ID, and passes the same environment to `obsidian-cli`. This is intended to keep real Obsidian E2E runs separate from a developer's daily Obsidian profile and vault registry.

On macOS, `@vrtmrz/obsidian-test-session` keeps the generated Vault and profile below `/tmp` so Obsidian's Unix-domain CLI socket remains below the platform path limit. It also gives only the isolated Obsidian process Chromium's mock-keychain flag, preventing the empty test HOME from opening a blocking login-keychain dialogue. LiveSync's deterministic fixture selects the built-in default language so a host-language translation prompt cannot pause plug-in readiness. The case-only rename check enumerates the parent directory and compares exact spellings because an old-path lookup still resolves the renamed file on the default case-insensitive macOS filesystem.

Multi-session workflows must keep each started Obsidian session tracked until its stop operation completes. If a scenario throws, teardown stops every active session before disposing its temporary Vault and profile, so a failed CLI or synchronisation operation cannot leave Obsidian using directories which have already been removed.

## Observing and diagnosing a scenario

Use externally visible behaviour as the pass condition: Vault files, remote-service state, revision data, or visible Obsidian UI. A log line can explain a failure, but should not replace an assertion about the resulting behaviour.

The maintained runner provides several complementary observation paths:

- `evalObsidianJson()` and `obsidian-cli eval` can read a small, explicitly selected piece of LiveSync or Obsidian state.
- `withObsidianPage()` can inspect the active renderer, invoke a registered command, or interact with visible UI through CDP. `captureObsidianPage()`, `captureObsidianDialogue()`, and `captureObsidianElement()` retain screenshots; the capture helpers also write a full-page `.failure.png` before rethrowing a UI assertion failure.
- `session.app.output()` returns the standard output and standard error captured from the isolated Obsidian process. This is especially useful when the renderer or CLI becomes unreachable.
- **Show log** (`obsidian-livesync:view-log`) exposes the recent LiveSync log, while **Copy full report to clipboard** (`obsidian-livesync:dump-debug-info`) opens the generated diagnostic report. `dialog-mounts.ts` verifies both surfaces, and focused scenarios may inspect the log pane and `appLifecycle.getUnresolvedMessages()` for a bounded set of expected errors.
- Renderer `console` messages and uncaught page errors are not retained automatically. A focused investigation can attach `page.on("console", ...)` and `page.on("pageerror", ...)` while it owns a `withObsidianPage()` callback. That observer ends when the callback closes its CDP connection, so use it around the action under investigation rather than treating it as a session-wide audit trail.

If a scenario times out or appears to do nothing, capture the visible page before teardown, then record a bounded state snapshot and the relevant tail of the LiveSync log, unresolved messages, and process output. If an unexplained Notice appears, retain a screenshot while it is still visible before opening or dismissing it, then use the log or full report to identify its source. A Notice alone is not enough evidence for its cause.

Set `showVerboseLog: true` only in isolated plug-in data when a focused investigation needs it. Keep captured output short and redact it before retaining or sharing it: logs and reports can contain Vault paths, document names, endpoints, credentials, Setup URIs, passphrases, or Security Seed material. Do not collect verbose logs from an ordinary user Vault.

Collect evidence before cleanup, and keep process, Vault, profile, and remote-fixture cleanup in `finally`. After `app.emulateMobile(true)`, use the active CDP renderer for fixture operations because Obsidian may remove desktop-only CLI commands. Visually inspect screenshots before copying selected images into user documentation; a passing locator assertion does not establish that a dialogue is readable or unobstructed.

## Local Setup

Set `OBSIDIAN_BINARY` when Obsidian is not installed in a standard location. Set `OBSIDIAN_CLI` as well when its companion executable is outside the built-in discovery paths.

For an AppImage on Linux without FUSE, use the helper script:

```bash
npm run test:e2e:obsidian:install-appimage
```

The script downloads Obsidian `1.12.7` for the current architecture, stores it in `_testdata/obsidian`, and extracts it to `_testdata/obsidian/squashfs-root`. The runner checks `_testdata/obsidian/squashfs-root/obsidian` before the AppImage path.

These tests are intended for local verification, not the default CI gate. Reuse the installed Obsidian application, or reuse the extracted AppImage directory between local runs:

- set `OBSIDIAN_BINARY` to an installed Obsidian executable,
- keep `_testdata/obsidian/squashfs-root` after running the AppImage installer, or
- run `test:e2e:obsidian:install-appimage` again only when the local Obsidian version should change.

## Commands

After changing plug-in source, use the focused wrapper rather than invoking a scenario directly. It always rebuilds `main.js` before launching real Obsidian, and it builds the local CLI too when the CLI-to-Obsidian scenario needs it:

```bash
npm run test:e2e:obsidian:focused -- settings-ui
npm run test:e2e:obsidian:focused -- two-vault-sync
npm run test:e2e:obsidian:focused -- stale-file-restart
npm run test:e2e:obsidian:focused -- folder-batch
npm run test:e2e:obsidian:focused -- security-seed-reconnect
npm run test:e2e:obsidian:focused -- couchdb-http-cache
```

The wrapper accepts only maintained real-Obsidian scenario names; run it with `--help` for the current list. It deliberately does not manage CouchDB, Object Storage, or the P2P signalling relay. Start the required fixture first, or use the complete service-managed suite.

`folder-batch` needs no remote service. It creates 24 notes and imports three notes with colons in their names into nested folders, reflects the database content into the existing files, then renames and deletes the parent through the Obsidian Vault API. It checks exact paths, descendant events, content, Chunks, deletion markers, provenance, and the absence of unexpected files. A note outside the parent must remain writable. The colon fixtures use the adapter to represent externally created files because Obsidian's Vault creation API rejects those names. The scenario also seeds a database-only colon-named note and verifies that Obsidian's refusal to create it preserves its Metadata without writing a differently named Vault file. It does not establish successful restoration of that absent note or behaviour on other operating systems.

`stale-file-restart` needs no remote service. It advances the local database while old Vault bytes remain, persists pending storage events, and restarts the same isolated Vault and profile. It checks that an unchanged file with exact provenance receives the newer database content without creating a revision, that unknown-origin content is preserved on a fresh independent branch, and that losing provenance and processing the file again does not duplicate or automatically merge that branch. A third file begins with no provenance while its bytes still match the current database revision; start-up must record that revision without creating a new one, and a later incoming revision must reflect without a conflict. The database advances and pending snapshot are controlled fixtures; start-up processing, persistence, file reflection, and conflict checking run in real Obsidian. The scenario does not simulate a mobile operating system suspending the application.

The principal entry points are:

```bash
npm run test:contract:contexts
npm run test:contract:context:webapp
npm run test:contract:context:cli
npm run test:contract:context:obsidian
npm run test:e2e:obsidian:runner
npm run test:e2e:obsidian:install-appimage
npm run test:e2e:obsidian:discover
npm run test:e2e:obsidian:cli-help -- vaults verbose
npm run test:e2e:obsidian:upgrade-from-stable -- --transport all
npm run test:e2e:obsidian:local-suite
npm run test:e2e:obsidian:local-suite:services
```

The underlying `test:e2e:obsidian:<scenario>` scripts remain available for an immediate rerun against an already built, unchanged bundle. They do not build `main.js`; do not use them as the first verification after a source change. The complete local suite performs its own build.

`test:contract:contexts` runs the directly observable host contract against the Obsidian, CLI, and Webapp compositions. It verifies event and translation results, host-specific capabilities, and that the CLI and Webapp Service Hubs pass one exact Context to all exposed services. `test:contract:context:webapp` runs only the Webapp part.

`test:contract:context:cli` builds the Node CLI and runs its existing Deno setup, put, read, list, information, remove, conflict-resolution, and revision workflow. `test:contract:context:obsidian` builds the plug-in and runs the real-Obsidian smoke test, including the Context inspection. These runtime scripts are local validation entry points and are not added to the default CI gate by this change.

`test:e2e:obsidian:onboarding-invitation` starts an unconfigured temporary Vault with no plug-in data and verifies that startup selects Commonlib's new-Vault recommendations, offers the setup wizard without opening it, and does not scan Vault files automatically. It checks the invitation action and introduction in mobile test mode, then reopens the wizard from Quick Setup in either settings interface. This scenario owns the unconfigured-startup boundary only; configured compatibility review remains covered by `settings-ui`, and the setup workflows remain covered by their dedicated scenarios.

`test:e2e:obsidian:dialog-mounts` starts a temporary real Obsidian session and exercises remote selection and CouchDB settings through `SetupManager`, plus Setup URI entry through the registered command. It verifies the compatibility pause and remote-size review, the distinction between a central data-storage server and P2P signalling, the explicit tested and untested CouchDB save actions, the internal-API warning, the Setup URI controls, automatic adjustment when differences are limited to compatible chunk settings, and both manual configuration-mismatch routes. The same session opens the live log and generated full report, reaches the `Hatch` recovery controls, writes and removes its own persistent log, and runs the missing-chunk recreation and file-verification actions against the empty disposable Vault. It captures representative desktop and mobile dialogues, checks the mobile layout and vertically stacked actions, closes each route through its normal controls, and verifies that each mounted operation settles without an error. It does not apply a remote configuration, contact a remote service, or claim to repair a deliberately damaged database.

`test:e2e:obsidian:settings-ui` starts with a pending compatibility review and verifies the dedicated pause summary, its detailed explanation, and the explicit resume action in a temporary real Obsidian session. It captures the desktop summary and the iPhone-sized summary and detail dialogues; the mobile checks cover viewport containment, horizontal overflow, safe-area containment, and the close control's touch target. It confirms that the acknowledged internal version advances only after the review is accepted, and checks that the Change Log contains no acknowledgement control. It then enables Advanced mode and persists one numeric Advanced setting. On Obsidian before 1.13, this covers the imperative settings fallback used by the `SettingSpec` proof. On Obsidian 1.13 or later, it verifies the task-oriented landing order, the separate Synchronisation group containing Remote Configuration and Sync Settings, and the General Settings group containing Appearance, Logging, and Extra menus. It reopens and cancels onboarding from Quick Setup, opens all 14 nested settings pages, searches globally for the Advanced control, captures the landing page, search result, Advanced page, and mobile landing page, and verifies that the value remains after the settings dialogue is closed and reopened. The mobile landing check confirms that Remote Configuration is reachable without initial scrolling. Finally, it selects the Synchronisation Settings page and verifies that the deletion panel still exposes the effective 'Keep empty folder' setting without presenting the legacy `trashInsteadDelete` control, whose value no longer changes Obsidian deletion behaviour.

The default runner uses the maintained pre-1.13 Obsidian fixture and therefore exercises the complete compatibility-review, mobile-layout, and imperative-settings path. To exercise only the native settings contract against an additional Obsidian 1.13-or-later installation, supply its executable and companion CLI explicitly:

```bash
OBSIDIAN_BINARY=/path/to/obsidian \
OBSIDIAN_CLI=/path/to/obsidian-cli \
E2E_OBSIDIAN_SETTINGS_ONLY=true \
npm run test:e2e:obsidian:settings-ui
```

The native run writes `settings-declarative-landing.png`, `settings-declarative-search.png`, `settings-declarative-advanced.png`, and `settings-declarative-landing-mobile.png` to `E2E_OBSIDIAN_DIAGNOSTICS_DIR`. All settings E2E scenarios open pages through the shared navigator in `runner/ui.ts`; scenario code must not select the legacy tab menu directly.

The mobile pass uses Obsidian's `app.emulateMobile(true)`, a 390 by 844 CSS-pixel viewport, and explicit iPhone-style safe-area insets of 47 pixels at the top and 34 pixels at the bottom. The public `@vrtmrz/obsidian-test-session` layout assertions require each modal to remain within the viewport and safe area without horizontal overflow. They also require the Obsidian Close control to remain within the safe area and provide at least a 44 by 44 CSS-pixel touch target. The runner clicks that control to verify actionability, then completes the explicit cancellation path. These simulated checks cover deterministic layout and interaction boundaries; they do not claim to reproduce a native operating-system overlay.

`test:e2e:obsidian:review-harness` exercises only the boundaries owned by the opt-in maintainer Harness. It retains a real compatibility pause, uses the fixed Harness restart action to persist a device-local continuation and reload Obsidian, and requires the Harness to delete that state before reopening. It also runs the bounded settings-lifecycle observation, confirms the dedicated Vault fixture root is removed, captures the copied privacy-bounded Markdown report, and checks the Harness layout and touch targets in mobile test mode. Compatibility explanation and persistence details remain owned by `settings-ui`, real P2P transfer remains owned by the dedicated P2P suites, and general Vault reflection remains owned by `vault-reflection`; the Harness test does not duplicate those workflows.

The Harness also measures ID generation with fixed in-memory data on desktop and mobile displays, checks that live settings remain unchanged, and verifies that the copied report includes both per-1,000-ID and per-ID timings, key derivation, and JavaScript heap availability. Mobile test mode verifies the UI and execution path; measure native device performance by running the same Harness on that device.

`test:e2e:obsidian:p2p-pane` starts one configured CouchDB-only session with no P2P profile and separate configured P2P sessions for desktop and mobile. It proves that the command remains registered while the retired command, automatic pane, and ribbon entry without a P2P configuration are absent. For the configured P2P profiles, it verifies that the desktop ribbon is available, the current status command reaches the pane without it opening at start-up, checks its connection control and horizontal layout, and captures unobstructed desktop and mobile screenshots. The mobile session uses a fresh Vault, profile, and Obsidian process, enters `app.emulateMobile(true)` through `lifecycle.beforePluginStart`, and requires the P2P view to belong to the right drawer rather than inheriting desktop workspace state. It deliberately uses no relay or peer: replacement of the active replicator is covered by focused unit tests, the Deno and Compose CLI P2P lifecycle suite covers the headless transport, and `p2p-setup-uri-workflow` owns the visible transfer path between two real Obsidian sessions.

`test:e2e:obsidian:local-suite` builds the plug-in and, unless `LIVESYNC_CLI_COMMAND` selects an external CLI, the local LiveSync CLI. It then runs discovery, smoke, the onboarding invitation, Svelte dialogue mounting, revision repair, settings UI, the Review Harness, the P2P status pane, Vault reflection, CouchDB upload and manual setup, CLI-to-Obsidian synchronisation, Object Storage upload and Setup URI and QR round trips, P2P Setup URI round-trip, startup scan, provisioned CouchDB Setup URI, two-vault synchronisation, Hidden File Sync, Customisation Sync, internal Metadata Doctor, and setting Markdown export in sequence. Start the local CouchDB, RustFS, and P2P relay fixtures before running it, or use `test:e2e:obsidian:local-suite:services` to let the wrapper stop leftover fixtures, start fresh fixtures, and stop them again after the run.

`test:e2e:obsidian:couchdb-upload` reuses the CouchDB variables from `.test.env` or the process environment. It expects a reachable CouchDB service, creates a unique database, starts from configured plug-in data without the device-local compatibility marker, and verifies that the marker is initialised without a compatibility dialogue, reminder, or runtime pause. It then creates a note in real Obsidian, commits it into the local database, runs one-shot synchronisation, and verifies that the remote database contains both the Metadata document and its Chunks.

The same workflow checks the two remote-activity status boundaries. It first holds a real CouchDB request at the selected fetch implementation and confirms that `🌐N` is visible while `📲` is absent. It then holds the real one-shot replication immediately before its replicator call, confirms that `📲` is visible while no physical request is active, releases it, and requires the finite and bounded activity counts to return to zero, the request and response counts to balance, and both indicators to disappear. Finally, it creates a remote-only chunk, holds the real on-demand fetch immediately before its remote call, makes the same logical active and idle assertions, and verifies that the fetched chunk is written into the local database. These gates make the active states deterministic without replacing the remote request or operation.

`test:e2e:obsidian:couchdb-http-cache` checks replication after rebuilding an encrypted CouchDB remote while an earlier HTTP response remains cached. It enables internal Metadata encryption with Hidden File Sync and Customisation Sync, verifies that the Rebuild replaces the Security Seed and ciphertext while retaining the document revision, and requires the replication pre-check and subsequent sends to succeed without clearing the browser cache. It uses the CouchDB fixture variables, an isolated Vault and profile, and a unique remote database. The raw command uses the current built plug-in by default; `E2E_OBSIDIAN_ARTIFACT_ROOT` can select an exact earlier build for regression comparison.

`npm run test:e2e:obsidian:focused -- chunk-fetch-retry` checks delayed Chunk availability through a real CouchDB service and Obsidian. It creates a Metadata-only remote fixture, starts ordinary one-shot replication with `readChunksOnline`, and inserts the missing Chunk only after a real fetch has returned an empty result. A pass-through observer records the replicator's call times and results without substituting responses or adding waits. The fixture sets the existing minimum request interval to 500 ms to keep the real retry status observable even if finite completion expedites the final probe. The actual status bar must show zero initial requests (`🛄`) and one retry (`🔁`), and both counts must return to zero after delivery ends. On-demand replication excludes Chunk documents from the ordinary pull, so the delayed Chunk must arrive through the observed fetch and produce the exact Vault content.

If finite replication was already inactive when the initial lookup began, the scenario requires a retry at least two seconds later and no physical request slot occupied during backoff. If finite replication ends during the initial lookup or the following backoff, the retry must instead be a post-completion final probe before the two-second delay would expire. This distinction is determined from the observed finite-count transitions, not an assumed ordering between replication and HTTP completion.

A second case never inserts the Chunk: it requires exactly one retry, a terminal missing notification, released activity, no Vault file, and no further fetch during another retry interval. A third starts a second genuine one-shot replication while the retry remains pending and passively observes its finite count. The final missing lookup must start after that finite operation ends and before the original backoff would expire. No test code changes the finite count. Deterministic Commonlib tests cover longer backoff stages and overlapping-completion races.

Each run uses an isolated Vault and remote database. This is a controlled availability-ordering reproduction, not a reproduction of a particular server's underlying delay or of mobile suspension. When comparing separately built pre-fix and fixed artefacts, retain the exact scenario, package, and bundle revisions: the original implementation ends delivery after the first missing response, while the interim single-retry implementation lacks the split status counts and finite-completion scheduling.

`test:e2e:obsidian:couchdb-manual-setup-workflow` follows the visible onboarding path for the first device when no Setup URI is available. It enters end-to-end encryption and CouchDB details, runs the read-only `Check server requirements` step, requires the prepared fixture to pass without applying a server fix, and lets the onboarding connection test create the named database. After Rebuild completes on the first device, it creates an ordinary note, asks that working device to generate a Setup URI for a second device, completes Fetch there, and verifies a bidirectional note round-trip. The workflow captures each decision point and the expanded server-check result; password controls remain visually masked. It uses an E2EE passphrase beginning with `%`, confirms that the saved settings do not contain it in plain text, and checks that Obsidian restores it after restarting with the first Vault.

The ordinary workflow now checks that all three ID-configuration radio choices are visible, disabled and dimmed while E2EE is off, and fully visible when it is enabled. It also checks that the random key is selected by default for a new Vault, **Keep current configuration** shows its legacy explanation, and the saved key is encrypted locally and transferred by Setup URI. A screenshot of the disabled group is saved as `guide-couchdb-manual-id-generation-disabled.png`. Set `E2E_OBSIDIAN_INDEPENDENT_IDS=true` for the same visible workflow with an explicitly entered, randomly generated source. That variant checks all three nested radio choices, requires a source when no key is saved, retains the saved key when a custom source is empty, rejects an ordinary string in the recovery-code input, restores the same key from a tagged code, verifies that the source is absent from local settings, and checks that both devices compute the same obfuscated document IDs after Setup URI import and Fast Fetch.

If this status workflow fails while Obsidian is running, it writes a full-page screenshot and a JSON snapshot of the status text and counters under `/tmp/obsidian-livesync-e2e`. The dialogue-mount workflow leaves desktop and mobile screenshots for both representative Svelte routes, the Hidden File Sync workflow captures the successfully displayed JSON Resolve dialogue before selecting an option, and the Security Seed reconnect workflow captures each significant application state. The suite therefore records representative evidence without capturing every interaction. Set `E2E_OBSIDIAN_DIAGNOSTICS_DIR` to use another directory.

The two-Vault workflow verifies that each isolated Vault initialises its missing marker without a compatibility pause. Later process launches reuse the same profile-backed acknowledgement. The Hidden File Sync scenario is narrower: it starts from an explicitly acknowledged marker because it tests consumer-owned hidden-file behaviour, JSON resolution, target filtering, and grouped mobile Notices rather than duplicating the compatibility workflow. After `app.emulateMobile(true)`, its fixture operations use the active DevTools renderer because Obsidian can remove desktop-only CLI commands in mobile mode.

The two-Vault workflow also covers independent ID derivation with two real Obsidian sessions: a note travels in each direction, both devices retain the same obfuscated document IDs, and identical content reuses the same Chunk IDs. Fresh devices with a different ID key or legacy ID configuration must be rejected by ordinary CouchDB replication before any remote document or checkpoint changes. Set `E2E_OBSIDIAN_ONLY_INDEPENDENT_IDS=true` to run that case without the other two-Vault scenarios.

Set `E2E_OBSIDIAN_ONLY_DIFFERENT_CHUNK_ID_KEYS=true` to run the focused case where two devices use different saved ID keys with Path Obfuscation off. It verifies that each device can read the other's note, visible document IDs agree, and writing the same content produces different Chunk IDs.

`test:e2e:obsidian:cli-to-obsidian-sync` is the cross-runtime compatibility check for the official LiveSync CLI and the real Obsidian plug-in. Build the plug-in first, and build the local CLI too when no external CLI command is selected. The script uses E2EE, Path Obfuscation, and the current preferred chunk settings to create and synchronise a note through the CLI, starts real Obsidian with an isolated Vault and profile, synchronises the same CouchDB database, and verifies that the plug-in materialises identical note content. This covers the boundary that CLI-only and plug-in-only round trips do not exercise.

The isolated Obsidian session starts with its CouchDB settings and device-local compatibility acknowledgement already in place. This keeps the scenario focused on cross-runtime data compatibility; unconfigured start-up and visible CouchDB onboarding are covered by their dedicated workflows.

By default, the compatibility check runs `node src/apps/cli/dist/index.cjs`. Set `LIVESYNC_CLI_COMMAND` to test another CLI build or distribution. The value may be a quoted command line or a JSON array of executable and prefix arguments; the scenario arguments are appended without going through a shell.

For example, to test an executable on `PATH`:

```bash
LIVESYNC_CLI_COMMAND='livesync-cli' npm run test:e2e:obsidian:cli-to-obsidian-sync
```

On Linux, a multi-architecture published Docker image can run against the local CouchDB fixture by sharing the temporary directory, using host networking, preserving the host user's file ownership, and overriding the image entrypoint so that the runner can supply its explicit database path. Images published before ARM64 support remain AMD64-only and require configured Docker emulation on an ARM host.

```bash
LIVESYNC_CLI_COMMAND="docker run --rm --network host --user $(id -u):$(id -g) --volume /tmp:/tmp --entrypoint node ghcr.io/vrtmrz/livesync-cli:edge /app/dist/index.cjs" \
  npm run test:e2e:obsidian:cli-to-obsidian-sync
```

`test:e2e:obsidian:tweak-compatibility` exercises the mismatch dialogue against temporary CouchDB databases. Build the plug-in first. The scenario removes the legacy filename-case value from the remote preferred settings, applies compatible differences through the ordinary settings action, and verifies note synchronisation and a subsequent restart. Separate true/false and true/missing filename-case mismatches check that Fetch remains required. The true/missing case also fetches the files and verifies a subsequent synchronisation attempt. A final case changes the remote while the dialogue is open, selects the stale Fetch action, and checks that the current settings, existing local file, and documents in both remotes remain unchanged.

`test:e2e:obsidian:minio-upload` reuses the Object Storage variables from `.test.env` or the process environment. It expects a reachable S3-compatible service and starts with isolated Object Storage settings and the device-local compatibility acknowledgement already in place, keeping the scenario focused on upload rather than unconfigured start-up or setup. It confirms those settings through `obsidian-cli eval`, creates a note in real Obsidian, runs one-shot Journal Sync, and verifies through the AWS SDK that objects were written under a unique bucket prefix. Adapter tests separately observe an in-progress SDK command, while this real-runtime workflow verifies the resulting request counters advance and rebalance.

Set `E2E_OBSIDIAN_INDEPENDENT_IDS=true` to run the same upload with E2EE, Path Obfuscation, and a separately derived ID key. The scenario verifies the local document and Chunk ID shapes before the Journal transfer.
Set `E2E_OBSIDIAN_CUSTOM_HTTP_HANDLER=true` when the local Object Storage fixture does not allow browser requests from Obsidian's renderer.

`test:e2e:obsidian:object-storage-setup-uri-workflow` uses the public Commonlib-backed tool to generate the initial Setup URI for a unique Object Storage prefix, completes visible initialisation on the first device, and then asks that working real Obsidian device to create a new Setup URI through the registered command. A second real Obsidian device imports only the device-generated URI. The workflow verifies the A-to-B note through explicit replication, then verifies that the B-to-A note arrives through `syncOnStart` after restarting the first device, without requesting manual replication. It captures the documented onboarding choices, and removes the Object Storage prefix only after both sessions have stopped. The test requires the current version marker and absence of a compatibility pause after Fetch and after restarting the same Vault, without accepting a review automatically.

`test:e2e:obsidian:object-storage-qr-workflow` runs the same Object Storage round trip with QR settings on the second device. It takes the first device's settings, assigns a distinct database suffix in the QR fixture, encodes them with Commonlib's QR encoder, passes the payload to the real QR decoding entry point, and selects **Join this device** in the visible dialogue. Unlike the Setup URI, the QR payload includes a database suffix; explicitly choosing one makes the namespace change independent of Obsidian's initial defaults. Before Fetch begins, the scenario verifies that the imported namespace has its current compatibility marker without a pause. Fetch then selects the receiving device's own suffix when resetting the local database. The test verifies the marker and absence of a pause again after Fetch and after a natural restart. It covers the QR settings and setup flow, without requiring a camera or exercising operating-system URI dispatch.

`test:e2e:obsidian:object-storage-compatible-setup-uri-workflow` selects **Compatible (no time limit)** in the real generation dialogue and uses Persistent mode for the bootstrap tool. All three Object Storage sharing scenarios require the generated independent ID key to survive import and natural restarts on both devices, remain encrypted in local settings, and retain document and Chunk IDs during the bidirectional transfer. Before valid setup, they submit an incorrect passphrase and a URI generated in a past window, require the visible rejection, and verify unchanged runtime and persisted settings. Only an isolated fixture worker uses the past clock; Obsidian and the runner use real time.

`test:e2e:obsidian:p2p-setup-uri-workflow` runs two concurrent isolated real Obsidian sessions against the local Compose Nostr relay fixture. The first device imports a generated initial Setup URI and completes its signalling test with zero peers, creates a Setup URI for the second device through the registered command, and remains online while the second device imports it. The second device must select the expected online source before Fetch can rebuild its local database. The workflow accepts each connection request visibly on the receiving device, verifies the initial A-to-B fetch, checks that the menu for the three persistent per-peer actions remains within the viewport, reconnects both P2P sessions in join order, and verifies the B-to-A return journey. Every started session remains tracked until teardown completes.

`test:e2e:obsidian:p2p-connection-check` owns the browser-to-Obsidian preflight path. It serves the WebPeer production build from loopback, asks the page to generate a disposable Setup URI using the local relay, starts its browser reference peer, and applies that exact URI through visible onboarding in an isolated empty real Obsidian Vault. After the first successful WebRTC diagnostic appears, it selects the action for another device in the same room, proves that the Setup URI was not regenerated, applies it to a second isolated empty real Obsidian Vault, and requires both the successful total and the baseline number of simultaneous active connections to advance. It captures the result card without Setup URI credentials and does not claim to verify note synchronisation. Run `test:e2e:obsidian:p2p-connection-check:services` to build both production artefacts and let the scenario start and stop the Compose relay.

`test:e2e:obsidian:startup-scan` starts from a CouchDB fixture using current settings with its device-local compatibility marker already acknowledged, stops Obsidian, writes a note directly into the Vault, restarts the same isolated Vault and profile without rewriting its plug-in data, and verifies from CouchDB that the start-up scan picked up the offline file. Onboarding remains covered by `onboarding-invitation`; this scenario owns the ordinary configured restart and start-up scan.

`test:e2e:obsidian:partial-startup-file-failure` is a focused Linux release-acceptance scenario for an ordinary configured restart. It stores one valid database-only note and one database-only note whose path component is 258 UTF-8 bytes, then restarts the same isolated Vault and profile. On a Linux test Vault which enforces the conventional 255-byte component limit, the scenario requires the valid file to be reflected, the application to become ready, the partial-failure Notice to appear, and the failed path to remain readable and eligible for a later scan with its exact path in the verbose log. It remains outside `local-suite` because the failure fixture is deliberately platform-specific.

`test:e2e:obsidian:setup-uri-workflow` runs the repository's public Commonlib-backed CouchDB provisioning and Setup URI tools against the local CouchDB fixture. It configures a new, empty Vault in the first real Obsidian session through the visible onboarding wizard and uses Rebuild. After that device is working, it generates a new Setup URI through the registered command; the second real Obsidian Vault uses that URI for Fetch instead of reusing the initial Setup URI produced by the provisioning tool. The workflow verifies ordinary notes from the first device to the second and back again, independently enables Hidden File Sync on each device, and verifies a snippet. The retained Setup URI screenshots show only encrypted URIs and visually masked Setup URI passphrases; plaintext credentials are not captured. Files prefixed with `guide-` capture the relevant dialogue, settings panel, or workspace leaf without transient Notices. Public documentation copies selected images only after visual inspection; the E2E run does not overwrite repository documentation assets.

`E2E_OBSIDIAN_ONLY_SETUP_URI_GENERATION=true npm run test:e2e:obsidian:focused -- dialog-mounts` runs the Setup URI generation slice in an isolated real Obsidian Vault without a CouchDB service. It checks the Time-bound choice and displayed end time, the generated URI's round trip, Compatible encryption with the original passphrase, and desktop and mobile dialogue layout. Unit and protocol tests cover the time-window boundary without changing the host clock.

`test:e2e:obsidian:two-vault-sync` runs a two-vault note synchronisation workflow. It verifies note creation, update, ordinary rename, a case-only file name change within the same directory, deletion, and a separate encrypted round-trip with Path Obfuscation enabled. Its target-filter scenario confirms that one Vault receives and checkpoints a remote document without reflecting it, restarts with the same profile and filter, and then reflects the stored document after the filter is broadened through the settings service. Directory case changes deliberately remain outside the ordinary workflow because they require directory-aware rename handling.

During focused development, `E2E_OBSIDIAN_ONLY_PARENT_CASE_DELETION=true` runs an Issue #1168 check which renames `parent/test3` to `parent/Test3` through external `node:fs/promises.rename` while Vault A is open, and verifies that the note content, Metadata, and Chunk references are not logically deleted locally, remotely, or after restart. It accepts either case spelling on Vault B, so it does not provide directory rename support or exact case convergence between devices. The natural Obsidian event sequence and resulting database state are evidence for the selected build; an existing-version reproduction result must be reported separately from fixed-version safety evidence.

The optional Markdown conflict check can be enabled with `E2E_OBSIDIAN_INCLUDE_MARKDOWN_CONFLICT=true`. It creates divergent revisions in two separate Vaults, performs a conservative merge on one Vault, edits that result again, and requires the other Vault to replace its known deleted losing revision without recreating the conflict. The separate `E2E_OBSIDIAN_INCLUDE_CONFLICT_OPERATIONS=true` check keeps four conflicts active while one Vault edits, deletes, performs a case-only rename, and performs a cross-path rename. It asserts that each operation extends the revision displayed on that device, replicates the exact resulting revision tree, and preserves the other conflict branch. During focused development, `E2E_OBSIDIAN_ONLY_CONFLICT_OPERATIONS=true` runs that self-contained scope without the ordinary, target-filter, or encrypted scenarios. Both conflict checks remain outside the default local suite.

`test:e2e:obsidian:security-seed-reconnect` is a focused CouchDB release-acceptance workflow. Device A first recognises an initial remote Security Seed, stops automatic replication while remaining open, and creates an unsent note. The runner replaces only the Security Seed in the managed remote synchronisation-parameter fixture. Device A must retain its deliberately stale cached value until the next one-shot synchronisation, refresh it before sending, and upload an HKDF-encrypted payload which uses the replacement value. A fresh device B must decrypt that note and send an encrypted note back; the original device A then receives the return journey with its Vault and isolated profile preserved. Desktop Obsidian may enforce a single application instance, so the two device sessions run sequentially after the same-process stale-cache assertion has completed.

The workflow creates a random dedicated database, records only SHA-256 Seed fingerprints, and never writes a Seed, passphrase, or CouchDB credentials to its result. It also requires the remote Seed and all other synchronisation parameters to remain unchanged after the replacement revision, rejects HKDF and Seed errors from either session, writes `security-seed-reconnect-result.json`, and verifies that every Obsidian process, temporary Vault, isolated profile, and database has been removed. The result file and stage screenshots are retained in `E2E_OBSIDIAN_DIAGNOSTICS_DIR`; the screenshots show ordinary Vault content, not settings or secrets. The strict cleanup workflow rejects `E2E_OBSIDIAN_KEEP_VAULT` and `E2E_OBSIDIAN_KEEP_COUCHDB`.

This proves in real Obsidian the plug-in behaviour shared by supported platforms, including the encrypted bidirectional round-trip and protection against a stale client restoring the old remote Seed. It does not verify iPadOS-specific background or reconnect lifecycle behaviour, and it does not count as Android device evidence. The workflow remains outside `test:e2e:obsidian:local-suite` because it is a focused release-acceptance check.

`test:e2e:obsidian:conflict-dialog-policy` creates three real local revision leaves without a remote service and opens the pairwise merge dialogue in Obsidian. It verifies the three-version count, requires the four decision buttons to be stacked vertically, concatenates the displayed pair as a child of the displayed winner, confirms that the untouched leaf remains as one conflict, postpones that remaining pair, restarts the same isolated Vault and profile, and confirms that only the two current versions are reconstructed. It also verifies that an ordinary repeated conflict check does not reopen a postponed dialogue, that **Resolve if conflicted.** explicitly reopens it, and that the active editor retains the appropriate unresolved-conflict warning. The scenario then invokes the same Commonlib consumer boundary used for an incoming replicated document and checks that a postponed warning disappears, an open stale dialogue closes, and the conflict-processing queue completes even when the dialogue closes immediately. This isolates the Obsidian UI contract from transport and second-device setup. The fixture owns one temporary Vault and profile, and the session runner stops Obsidian before removing them.

`test:e2e:obsidian:revision-repair` creates an ordinary healthy logical deletion and two current leaf revisions in a temporary real Obsidian Vault, then removes a chunk used only by the non-winning revision. It proves that automatic conflict checking does not discard the unreadable branch, and that a healthy logical deletion with no Vault file is neither reported nor retained as Vault provenance. **Inspect conflicts and file/database differences** must show the winner and conflict separately, identify the exact unreadable revision and missing chunk, show the compact `Δsize` and `Δtime` diagnostics, and expose a wrench menu with the appropriate actions for each branch. The scenario opens the existing comparison dialogue in read-only mode, applies the readable winner to the Vault, shows the compact matching-winner and remaining-conflict status, records the exact winner as Vault provenance without creating a child, and confirms that retrying the unreadable branch leaves the revision tree unchanged. It then verifies both the cancellation path and the explicit confirmation path for discarding only that selected current branch, requires the winner and its Vault provenance to remain unchanged, and captures the repair card, a 360-pixel-wide reflow check, the matching-winner status, both revision menus, and the read-only comparison. The narrow capture checks responsive layout, not a mobile operating-system lifecycle. The scenario uses no remote service; a retry is therefore expected to remain unreadable unless the chunk is already available locally.

`test:e2e:obsidian:document-history-restore` creates a normal note, records a logical deletion while retaining readable chunks, and restores the deleted content through the visible Document History dialogue. It requires the action itself to create and reflect a new non-deleted successor revision, reopens the history at that successor, and captures the file picker, readable deleted revision, restored Vault file, and new successor revision. This scenario owns the ordinary-history restoration boundary; conflict resolution remains with **Inspect conflicts and file/database differences**.

`test:e2e:obsidian:hidden-file-snippet-sync` runs a two-vault hidden file round-trip. It verifies creation and deletion of a real `.obsidian/snippets/*.css` file, automatic JSON conflict merging for a hidden file with the merged result propagated by a second synchronisation, manual JSON Resolve dialogue application through Obsidian's UI, and per-device target patterns where one vault ignores a hidden file that the other vault synchronises. Initial enablement must open one user-visible progress Notice before the enabled setting is saved, then retain that Notice while its nested rebuild and scan phases continue in the ordinary log. The configured fixture starts with a current CouchDB remote profile, so migration from legacy remote settings remains the responsibility of the upgrade scenarios and cannot add unrelated Notices to this check. It also covers [issue #555](https://github.com/vrtmrz/obsidian-livesync/issues/555) by requiring several plug-in and settings changes to share one separate action Notice whose controls remain usable in mobile layouts; a manually dismissed group must not repeat its acknowledged rows when a later change arrives.

`test:e2e:obsidian:customisation-sync` runs a two-vault Customisation Sync workflow. It scans a real snippet CSS file, config JSON file, and sample plug-in fixture into per-file Customisation Sync data, synchronises the entries through CouchDB, applies them on the second vault, verifies the resulting `.obsidian` files, propagates a snippet update, and verifies deletion of the source-vault snippet sync data without confusing it with the target vault's own applied copy.

The workflow also opens the Customisation Sync dialogue. `--case=visibility` checks that **Hide not applicable items** hides an identical snippet, preserves a different snippet and its source selector, and restores the identical snippet when cleared. `--case=mtime` gives the multi-file plug-in fixture modern millisecond timestamps and requires an older remote copy to remain labelled **Older** and unselected by **Select All Shiny**. With no case argument, both checks run before the existing apply, update, and deletion workflow.

`test:e2e:obsidian:received-change-readiness` uses two sequential real Obsidian sessions and isolated CouchDB databases. The source creates ordinary notes and their Chunks; the target starts continuous replication, resets readiness through the public lifecycle service, and receives those documents while its Vault files remain absent. Marking the target ready twice must emit one readiness event and reflect the queued content. A second note remains absent after readiness while database reflecting is explicitly suspended, then appears when that setting is resumed. This focused scenario is outside `test:e2e:obsidian:local-suite`.

`test:e2e:obsidian:remote-feature-change` starts real Obsidian with continuous CouchDB replication, then changes the remote version document from generation 12 to generation 13 with an unknown feature. It waits for the control document to reach the local database and the active Replicator to retire, checks that another replication is refused, and verifies that an already accepted Vault note remains intact. After restarting the same Vault, the current remote declaration still blocks finite replication and the actual continuous connection attempt. No KV feature history is involved. It is a focused test outside `test:e2e:obsidian:local-suite`; recovery with a future compatible client remains a separate validation boundary.

`test:e2e:obsidian:internal-metadata-migration` enables internal Metadata encryption through the settings UI without Rebuild. It checks unchanged plaintext and rewritten encrypted Hidden File Sync and Customisation Sync Metadata in CouchDB, stable document IDs, mismatch rejection on a second device, and file restoration after aligning settings. It then turns the preference OFF, runs Fast Fetch, and compares content loaded from both Metadata representations and their Chunks while retaining the remote feature declaration. These focused tests use the local CouchDB fixture and are outside `test:e2e:obsidian:local-suite`.

`test:e2e:obsidian:internal-metadata-doctor` reuses the migration fixture and enables encryption through the real Config Doctor dialogues. It checks declining the consultation, skipping the recommendation with a reminder, dismissing the current Doctor version, and accepting the recommendation through **Run Doctor** after dismissal. Each choice is checked against active and persisted settings, with natural restarts of the same Vault and profile verifying reminders and retained choices. A local database sentinel, start-up flag checks, unchanged remote documents, and renderer identity checks detect an unintended automatic Rebuild, Fetch, or restart. The accepted setting then follows the two-device migration and Fast Fetch checks above. This scenario requires CouchDB and is included in `test:e2e:obsidian:local-suite`; run it separately with `npm run test:e2e:obsidian:focused -- internal-metadata-doctor` after starting the CouchDB fixture.

`test:e2e:obsidian:setting-markdown-export` enables setting Markdown export, waits for the generated Markdown file in the vault, and verifies that credentials are omitted when `writeCredentialsForSettingSync=false`, including both the plaintext ID key and its encrypted local representation.

`test:e2e:obsidian:setting-markdown-roundtrip` generates Markdown with and without credentials through the real export command, copies each original file into a separate fresh Vault, and imports it through **Parse setting file** and the visible **Apply settings** dialogue. Each receiver starts with default plug-in settings and no connection profiles, with its own configuration encryption passphrase provided independently of the source through localStorage. The scenario verifies ordinary settings, conditional credentials and complete profiles, encrypted local persistence, and restoration after restarting the same Vault and profile without reseeding settings or localStorage. Imports without credentials may create new profiles through the existing legacy migration; those profiles must contain none of the omitted source credentials. This scenario requires no remote service and is included in the focused wrapper and local suite.

`test:e2e:obsidian:upgrade-from-stable` is the release-acceptance upgrade workflow. It installs the exact published 0.25.83 artefacts into an isolated Vault, verifies their pinned SHA-256 values, and then replaces only the plug-in artefacts with the current target while retaining the same Vault and isolated Obsidian profile. The first run downloads the old release into the ignored `_testdata/releases` cache; every later run verifies the cached bytes before use.

The workflow first exercises a non-empty legacy settings document which has no `isConfigured` or file-name case value. It verifies that 0.25.83 treats a default-equivalent document as unconfigured. That release can persist the inferred boolean during a later, unrelated settings-save event, so the runner accepts either an absent value or the inferred `false` on disk, then restores the same minimal pre-flag document deliberately before installing 1.0. The target independently proves its direct migration: the Vault remains unconfigured instead of receiving new-Vault recommendations, case-insensitive handling becomes explicit, no compatibility pause or acknowledgement marker is created while onboarding remains pending, and a second 1.0 start is idempotent. The absent marker is deliberately deferred while onboarding is pending; a later configured start records the current version if no other review is required. This fixture rewrite is limited to the missing-flag boundary; the configured transport upgrades use only state created and saved by 0.25.83 itself.

For CouchDB and Object Storage, the workflow then configures 0.25.83 from its own defaults, saves the selected remote, and restarts that release with the same profile before creating history. This both verifies that the old settings persist and lets the old release initialise its replicator from the same saved state as an ordinary existing Vault. The runner waits for that release's asynchronously initialised persistent node identity, creates, edits, renames, and deletes notes, and synchronises each transition before installing the target. Every launch of the upgraded device uses the same isolated Obsidian profile. The session layer closes the renderer before its process-tree fallback, so Chromium persists the legacy compatibility marker naturally; the target must read and migrate that actual profile state to its current namespaced key. The final target restart likewise consumes the marker persisted by the preceding target session. The runner does not reconstruct that device's Vault data, plug-in settings, local database files, device-local state, or remote state. Before the target performs any synchronisation, it must retain the same Vault profile, local database, node identity, remote profile, local checkpoint, and remote milestone. The local node-info document is the identity source of truth; a transient replicator field is used only to confirm that the old asynchronous initialisation has completed. Its first synchronisation must be a no-op: CouchDB document revisions and `update_seq` must remain unchanged, while Object Storage must neither upload nor download journal bodies. The upgraded device then sends a new delta. A separate fresh 1.0 verifier starts from an explicit fixture containing settings and compatibility state for the current version, receives the complete surviving history, and returns another delta; it is not part of the migration assertion for legacy remote settings. The upgraded Vault receives that return journey and retains it across restart.

Before creating stable-release history, the runner waits until the remote Security Seed can be read and only then marks the remote as resolved. Completion of the old release's remote-creation method alone does not prove that this asynchronous fixture boundary is ready.

Run the focused wrapper after source changes so that the target plug-in is rebuilt first:

```bash
npm run test:e2e:obsidian:focused -- upgrade-from-stable --transport all --manage-services
```

Use `--transport couchdb` or `--transport object-storage` for a focused rerun. `--manage-services` starts and stops the required local fixture or fixtures; add `--keep-services` only when they should remain available for inspection. Set `E2E_LIVESYNC_TARGET_ARTIFACT_ROOT` to validate another already-built target directory, or `E2E_LIVESYNC_SOURCE_ARTIFACT_ROOT` to use an explicit cache directory whose files still match the pinned release hashes.

This workflow is deliberately excluded from `local-suite`. It downloads a published historical artefact, reuses one profile across multiple application versions, and is an expensive release-acceptance gate rather than a routine current-version scenario. P2P is also excluded because cross-version P2P interoperability is a separate physical validation boundary.

Start the local fixtures first when they are not already running:

```bash
npm run test:docker-couchdb:start
npm run test:docker-s3:start
npm run test:docker-p2p:start
npm run test:e2e:obsidian:local-suite
```

Or let the wrapper manage both fixtures:

```bash
npm run test:e2e:obsidian:local-suite:services
```

### Combined setup and security regression checks

Build the current plug-in once, then run these focused scenarios sequentially with their documented fixtures:

| Coverage | Scenario or command |
| --- | --- |
| Time-bound URI, independent key, rejection, restart, and two-way Object Storage transfer | `npm run test:e2e:obsidian:object-storage-setup-uri-workflow` |
| Compatible URI with the same key and transfer checks | `npm run test:e2e:obsidian:object-storage-compatible-setup-uri-workflow` |
| QR import, changed database suffix, key persistence, and two-way transfer | `npm run test:e2e:obsidian:object-storage-qr-workflow` |
| Custom ID source, recovery code, encrypted local storage, and CouchDB Setup URI transfer | `E2E_OBSIDIAN_INDEPENDENT_IDS=true npm run test:e2e:obsidian:couchdb-manual-setup-workflow` |
| Matching IDs and rejection of incompatible document keys before remote writes | `E2E_OBSIDIAN_ONLY_INDEPENDENT_IDS=true npm run test:e2e:obsidian:two-vault-sync` |
| Doctor decline, reminder, dismissal, later acceptance, and mixed internal Metadata | `npm run test:e2e:obsidian:internal-metadata-doctor` |

The setup-tool contract suite also checks ID recovery and explicit legacy IDs in both URI modes. `dialog-mounts` covers the availability dialogue and setup choices on desktop and emulated mobile. These automated scenarios remove the need to repeat every decision path manually during BRAT acceptance.

BRAT acceptance validates the exact published artefacts: install or update through BRAT, cold-start Obsidian, and exchange one note in each direction. Build behaviour can be checked before publication using the exact reviewed build; record its identity and avoid repeating the same decision paths during BRAT acceptance.

A short physical-device check is optional when a specific concern remains about localised time text, input, clipboard interaction, or responsiveness. The camera and operating-system dispatch paths are unchanged by this integration and do not require routine revalidation. Emulated mobile establishes layout and interaction, but does not establish native device performance or verify the published installation path.

### Environment variables

- `OBSIDIAN_BINARY`: explicit Obsidian executable path.
- `OBSIDIAN_CLI`: explicit companion `obsidian-cli` executable path.
- `E2E_OBSIDIAN_VERSION`: Obsidian AppImage version for `test:e2e:obsidian:install-appimage`; default is `1.12.7`.
- `E2E_OBSIDIAN_APPIMAGE_ARCH`: AppImage architecture override, such as `arm64` or `x86_64`.
- `E2E_OBSIDIAN_APPIMAGE_URL`: explicit AppImage URL override.
- `E2E_OBSIDIAN_DOWNLOAD_DIR`: AppImage download and extraction directory; default is `_testdata/obsidian`.
- `E2E_OBSIDIAN_FORCE_DOWNLOAD=true`: re-download the AppImage even when it exists.
- `E2E_OBSIDIAN_SKIP_EXTRACT=true`: download the AppImage without extracting it.
- `E2E_OBSIDIAN_SMOKE_TIMEOUT_MS`: smoke timeout in milliseconds.
- `E2E_OBSIDIAN_DIALOG_TIMEOUT_MS`: timeout for a representative Svelte dialogue to mount, expose its principal controls, and close; default is 10 seconds.
- `E2E_OBSIDIAN_REVISION_REPAIR_TIMEOUT_MS`: timeout for each visible revision-repair control and result; default is 15 seconds.
- `E2E_OBSIDIAN_SETTINGS_TIMEOUT_MS`: timeout for the settings pane and its deletion controls to become visible; default is 10 seconds.
- `E2E_OBSIDIAN_SETTINGS_ONLY=true`: skip compatibility-review and its dialogue-layout coverage when running `settings-ui` against an additional Obsidian 1.13-or-later installation; the native settings mobile-landing check still runs.
- `E2E_OBSIDIAN_REVIEW_HARNESS_TIMEOUT_MS`: timeout for Review Harness view and action boundaries; default is 15 seconds.
- `E2E_OBSIDIAN_P2P_PANE_TIMEOUT_MS`: timeout for the P2P status pane and its principal connection control; default is 10 seconds.
- `E2E_OBSIDIAN_P2P_WORKFLOW_TIMEOUT_MS`: timeout for each visible P2P Setup URI, peer-discovery, approval, and replication control; default is 60 seconds.
- `E2E_P2P_CHECK_CONNECTION_TIMEOUT_MS`: timeout for the browser-to-Obsidian successful WebRTC diagnostic; default is 60 seconds.
- `E2E_P2P_CHECK_SCREENSHOT`: explicit path for the successful browser result screenshot; default is `p2p-connection-check-browser-success.png` under `E2E_OBSIDIAN_DIAGNOSTICS_DIR`.
- `E2E_P2P_RELAY_URL`: signalling relay used by the real-Obsidian P2P workflow; default is the local relay at `ws://127.0.0.1:4010/`.
- `E2E_P2P_RELAY_PORT`: host port for the local P2P relay fixture; default is `4010`.
- `E2E_OBSIDIAN_SECONDARY_REMOTE_DEBUGGING_PORT`: CDP port for the second concurrent real Obsidian session; default is one greater than the primary port.
- `E2E_OBSIDIAN_READY_TIMEOUT_MS`: plug-in readiness timeout in milliseconds.
- `E2E_OBSIDIAN_CLI_READY_TIMEOUT_MS`: timeout for waiting until the vault-side Obsidian CLI exposes the plug-in catalogue.
- `E2E_OBSIDIAN_CLI_TIMEOUT_MS`: timeout for each `obsidian-cli` invocation.
- `E2E_LIVESYNC_CLI_TIMEOUT_MS`: timeout for each official LiveSync CLI invocation in the CLI-to-Obsidian compatibility check; default is 60 seconds.
- `LIVESYNC_CLI_COMMAND`: optional LiveSync CLI executable and prefix arguments used by the CLI-to-Obsidian compatibility check. The default is the locally built CLI.
- `E2E_LIVESYNC_SOURCE_ARTIFACT_ROOT`: optional cache directory containing the exact pinned 0.25.83 plug-in artefacts. Cached files are always checksum-verified.
- `E2E_LIVESYNC_TARGET_ARTIFACT_ROOT`: directory containing the built 1.0 target `main.js`, `manifest.json`, and `styles.css`; default is the repository root.
- `E2E_OBSIDIAN_ARTIFACT_ROOT`: directory containing the plug-in artefact installed by a direct scenario invocation; default is the repository root.
- `E2E_OBSIDIAN_ARTIFACT_REVISION`: exact source commit recorded by the Security Seed reconnect result when `E2E_OBSIDIAN_ARTIFACT_ROOT` is a downloaded artefact rather than a Git worktree.
- `E2E_OBSIDIAN_FILE_TIMEOUT_MS`: timeout for waiting until a note created through Obsidian's vault API is reflected to disk.
- `E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS`: timeout for waiting until Self-hosted LiveSync reports that its core lifecycle and local database are ready.
- `E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS`: timeout for waiting until a file appears in Self-hosted LiveSync's local database.
- `E2E_OBSIDIAN_ONLY_PARENT_CASE_DELETION=true`: run only the focused external parent-directory case-rename protection check in `two-vault-sync`.
- `E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS`: timeout for waiting until CouchDB contains uploaded E2E documents.
- `E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS`: timeout for an observed remote activity to enter or leave its status boundary; default is 30 seconds.
- `E2E_OBSIDIAN_DIAGNOSTICS_DIR`: directory for screenshots and status snapshots, including the Security Seed reconnect stages; default is `/tmp/obsidian-livesync-e2e`.
- `E2E_OBSIDIAN_OBJECT_STORAGE_TIMEOUT_MS`: timeout for waiting until Object Storage contains uploaded E2E objects.
- `E2E_OBSIDIAN_KEEP_COUCHDB=true`: keep the temporary CouchDB database for inspection.
- `E2E_OBSIDIAN_KEEP_OBJECT_STORAGE=true`: keep the temporary Object Storage prefix for inspection.
- `E2E_OBSIDIAN_STARTUP_GRACE_MS`: early process-exit detection window in milliseconds.
- `E2E_OBSIDIAN_KEEP_VAULT=true`: keep the temporary vault for inspection.
- `E2E_OBSIDIAN_USE_XVFB=false`: disable automatic `xvfb-run` on headless Linux.
- `E2E_OBSIDIAN_USE_USER_DATA_DIR=false`: disable the isolated Electron `--user-data-dir` argument. This is not recommended for normal local testing.
- `E2E_OBSIDIAN_ARGS`: override the default Obsidian launch arguments.

On headless Linux, the runner automatically uses `/usr/bin/xvfb-run` when no `DISPLAY` or `WAYLAND_DISPLAY` is present.
