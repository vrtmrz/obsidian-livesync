# Real Obsidian E2E Runner

This directory contains the maintained real Obsidian end-to-end runner.

The generic application discovery, isolated-vault, plug-in installation, process lifecycle, CLI, CDP, and readiness implementation comes from `@vrtmrz/obsidian-test-session`. The small modules under `runner/` preserve LiveSync's existing imports and supply its plug-in ID and artefact location. LiveSync-specific fixtures, services, settings, workflows, and assertions remain in this repository.

The current smoke runner verifies the launch path and the loaded plug-in's Service Context composition:

1. create a temporary vault,
2. install the built Self-hosted LiveSync plug-in artifacts,
3. launch real Obsidian,
4. open the temporary vault through `obsidian-cli`,
5. enable Obsidian community plug-ins for the temporary app profile,
6. reload Self-hosted LiveSync through `obsidian-cli`,
7. verify through `obsidian-cli eval` that the plug-in is loaded,
8. observe event and translation results from the actual `ObsidianServiceContext`,
9. verify that the Service Hub and every exposed service retain that exact Context,
10. optionally drive a real vault or CouchDB workflow through Obsidian's own API, and
11. terminate Obsidian and remove the temporary vault.

The runner does not require Self-hosted LiveSync to expose an E2E-only bridge. Readiness is checked from outside the plug-in through Obsidian's own CLI.

Obsidian 1.12 stores the global community plug-in switch outside `.obsidian/community-plugins.json`. The smoke runner enables it through `app.plugins.setEnable(true)` after the vault window is available.

Future workflows should use `startObsidianLiveSyncSession()` from `runner/session.ts` rather than repeating the launch and plug-in readiness sequence. Add generic Obsidian bootstrap improvements to Fancy Kit; keep LiveSync behaviour and scenario helpers here.

Each test vault uses an isolated Obsidian profile. The runner creates temporary directories for `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, and Electron `--user-data-dir`, writes the vault registry into those directories, pre-seeds the temporary Chromium local storage so community plug-ins are trusted for that generated vault ID, and passes the same environment to `obsidian-cli`. This is intended to keep real Obsidian E2E runs separate from a developer's daily Obsidian profile and vault registry.

On macOS, `@vrtmrz/obsidian-test-session` keeps the generated Vault and profile below `/tmp` so Obsidian's Unix-domain CLI socket remains below the platform path limit. It also gives only the isolated Obsidian process Chromium's mock-keychain flag, preventing the empty test HOME from opening a blocking login-keychain dialogue. LiveSync's deterministic fixture selects the built-in default language so a host-language translation prompt cannot pause plug-in readiness. The case-only rename check enumerates the parent directory and compares exact spellings because an old-path lookup still resolves the renamed file on the default case-insensitive macOS filesystem.

Multi-session workflows must keep each started Obsidian session tracked until its stop operation completes. If a scenario throws, teardown stops every active session before disposing its temporary Vault and profile, so a failed CLI or synchronisation operation cannot leave Obsidian using directories which have already been removed.

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
```

The wrapper accepts only maintained real-Obsidian scenario names; run it with `--help` for the current list. It deliberately does not manage CouchDB, Object Storage, or the P2P signalling relay. Start the required fixture first, or use the complete service-managed suite.

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

`test:e2e:obsidian:onboarding-invitation` starts an unconfigured temporary Vault with no plug-in data and verifies that startup selects Commonlib's new-Vault recommendations, offers the setup wizard without opening it, and does not scan Vault files automatically. It checks the invitation action and introduction in mobile test mode, then uses the permanent command to reopen the wizard on the desktop. This scenario owns the unconfigured-startup boundary only; configured compatibility review remains covered by `settings-ui`, and the setup workflows remain covered by their dedicated scenarios.

`test:e2e:obsidian:dialog-mounts` starts a temporary real Obsidian session and exercises two representative Svelte dialogue routes: remote server selection through `SetupManager`, and Setup URI entry through the registered command. The session pre-seeds a configured, inactive plug-in state so that onboarding and migration prompts do not interfere with the dialogues under test. It requires each dialogue title and its principal controls to be visible, captures desktop and mobile screenshots, closes them through their normal user controls, and verifies that the remote-selection promise settles without an error. This covers the host, context, component, and result boundaries moved during the Commonlib package extraction without applying settings or contacting a remote service.

`test:e2e:obsidian:settings-ui` starts with a pending compatibility review and verifies the dedicated pause summary, its detailed explanation, and the explicit resume action in a temporary real Obsidian session. It captures the desktop summary and the iPhone-sized summary and detail dialogues; the mobile checks cover viewport containment, horizontal overflow, safe-area containment, and the close control's touch target. It confirms that the acknowledged internal version advances only after the review is accepted, and checks that the Change Log contains no acknowledgement control. It then selects the Synchronisation Settings pane and verifies that the deletion panel still exposes the effective 'Keep empty folder' setting without presenting the legacy `trashInsteadDelete` control, whose value no longer changes Obsidian deletion behaviour.

The mobile pass uses Obsidian's `app.emulateMobile(true)`, a 390 by 844 CSS-pixel viewport, and explicit iPhone-style safe-area insets of 47 pixels at the top and 34 pixels at the bottom. The public `@vrtmrz/obsidian-test-session` layout assertions require each modal to remain within the viewport and safe area without horizontal overflow. They also require the Obsidian Close control to remain within the safe area and provide at least a 44 by 44 CSS-pixel touch target. The runner clicks that control to verify actionability, then completes the explicit cancellation path. These simulated checks cover deterministic layout and interaction boundaries; they do not claim to reproduce a native operating-system overlay.

`test:e2e:obsidian:review-harness` exercises only the boundaries owned by the opt-in maintainer Harness. It retains a real compatibility pause, uses the fixed Harness restart action to persist a device-local continuation and reload Obsidian, and requires the Harness to delete that state before reopening. It also runs the bounded local observations, confirms the dedicated Vault fixture root is removed, captures the copied privacy-bounded Markdown report, and checks the Harness layout and touch targets in mobile test mode. Compatibility explanation and persistence details remain owned by `settings-ui`, real P2P transfer remains owned by the dedicated P2P suites, and general Vault reflection remains owned by `vault-reflection`; the Harness test does not duplicate those workflows.

`test:e2e:obsidian:p2p-pane` opens the P2P status view in a temporary real Obsidian session, verifies its principal connection control and horizontal layout, and captures a screenshot. It deliberately uses no relay or peer: current-replicator replacement is covered by focused unit tests, the Deno and Compose CLI P2P lifecycle suite covers the headless transport, and `p2p-setup-uri-workflow` owns the visible two-device real-Obsidian path.

`test:e2e:obsidian:local-suite` builds the plug-in and, unless `LIVESYNC_CLI_COMMAND` selects an external CLI, the local LiveSync CLI. It then runs discovery, smoke, the onboarding invitation, Svelte dialogue mounting, settings UI, the Review Harness, the P2P status pane, Vault reflection, CouchDB upload, CLI-to-Obsidian synchronisation, Object Storage upload and Setup URI round-trip, P2P Setup URI round-trip, startup scan, provisioned CouchDB Setup URI, two-vault synchronisation, Hidden File Sync, Customisation Sync, and setting Markdown export in sequence. Start the local CouchDB, MinIO, and P2P relay fixtures before running it, or use `test:e2e:obsidian:local-suite:services` to let the wrapper stop leftover fixtures, start fresh fixtures, and stop them again after the run.

`test:e2e:obsidian:couchdb-upload` reuses the CouchDB variables from `.test.env` or the process environment. It expects a reachable CouchDB service, creates a unique database, starts from configured plug-in data without the device-local compatibility marker, and verifies the copied-or-restored Vault explanation in the actual compatibility dialogue. It captures the summary and details, resumes explicitly, confirms that the marker was recorded, creates a note in real Obsidian, commits the note into the local database, runs one-shot synchronisation, and verifies that the remote database contains both the metadata document and its chunk documents.

The same workflow checks the two remote-activity status boundaries. It first holds a real CouchDB request at the selected fetch implementation and confirms that `🌐N` is visible while `📲` is absent. It then holds the real one-shot replication immediately before its replicator call, confirms that `📲` is visible while no physical request is active, releases it, and requires the finite and bounded activity counts to return to zero, the request and response counts to balance, and both indicators to disappear. Finally, it creates a remote-only chunk, holds the real on-demand fetch immediately before its remote call, makes the same logical active and idle assertions, and verifies that the fetched chunk is written into the local database. These gates make the active states deterministic without replacing the remote request or operation.

If this status workflow fails while Obsidian is running, it writes a full-page screenshot and a JSON snapshot of the status text and counters under `/tmp/obsidian-livesync-e2e`. The dialogue-mount workflow leaves desktop and mobile screenshots for both representative Svelte routes, and the Hidden File Sync workflow captures the successfully displayed JSON Resolve dialogue before selecting an option. The suite therefore records representative evidence without capturing every interaction. Set `E2E_OBSIDIAN_DIAGNOSTICS_DIR` to use another directory.

The two-Vault workflow performs the missing-marker review once for each isolated Vault. Later process launches reuse the same profile-backed acknowledgement, rather than seeding a replacement or repeatedly applying a first-device decision. The Hidden File Sync scenario is narrower: it starts from an explicitly acknowledged marker because it tests consumer-owned hidden-file behaviour, JSON resolution, target filtering, and grouped mobile Notices rather than duplicating the compatibility workflow. After `app.emulateMobile(true)`, its fixture operations use the active DevTools renderer because Obsidian can remove desktop-only CLI commands in mobile mode.

`test:e2e:obsidian:cli-to-obsidian-sync` is the cross-runtime compatibility check for the official LiveSync CLI and the real Obsidian plug-in. Build the plug-in first, and build the local CLI too when no external CLI command is selected. The script uses E2EE, Path Obfuscation, and the current preferred chunk settings to create and synchronise a note through the CLI, starts real Obsidian with an isolated Vault and profile, synchronises the same CouchDB database, and verifies that the plug-in materialises identical note content. This covers the boundary that CLI-only and plug-in-only round trips do not exercise.

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

`test:e2e:obsidian:minio-upload` reuses the Object Storage variables from `.test.env` or the process environment. It expects a reachable S3-compatible service, configures Self-hosted LiveSync for Object Storage through `obsidian-cli eval`, creates a note in real Obsidian, runs one-shot Journal Sync, and verifies through the AWS SDK that objects were written under a unique bucket prefix. Adapter tests separately observe an in-progress SDK command, while this real-runtime workflow verifies the resulting request counters advance and rebalance.

`test:e2e:obsidian:object-storage-setup-uri-workflow` generates a public Commonlib-backed bootstrap URI for a unique MinIO prefix, completes visible first-device initialisation, and then asks that working real Obsidian device to create a new Setup URI through the registered command. A second real Obsidian device imports only the device-generated URI. The workflow verifies A-to-B and B-to-A notes, captures the documented onboarding choices, and removes the Object Storage prefix only after both sessions have stopped.

`test:e2e:obsidian:p2p-setup-uri-workflow` runs two concurrent isolated real Obsidian sessions against the local Nostr relay fixture. The first device imports a generated bootstrap URI, creates the additional-device URI through the registered command, and remains online while the second device imports it. The workflow selects the expected peer, accepts each connection request visibly on the receiving device, verifies the initial A-to-B fetch, reconnects both finite P2P sessions in join order, and verifies the B-to-A return journey. Every started session remains tracked until teardown completes.

`test:e2e:obsidian:startup-scan` configures a temporary CouchDB database, stops Obsidian, writes a note directly into the vault, restarts Obsidian, and verifies from CouchDB that the boot-time scan picked up the offline file.

`test:e2e:obsidian:setup-uri-workflow` runs the repository's public Commonlib-backed CouchDB provisioning and Setup URI tools against the local CouchDB fixture. It configures the first data-less real Obsidian Vault through the visible onboarding wizard and uses Rebuild. After that device is working, it generates a new Setup URI through the registered command; the second real Obsidian Vault uses that URI for Fetch instead of reusing the provisioning-time bootstrap URI. The workflow verifies ordinary notes from the first device to the second and back again, independently enables Hidden File Sync on each device, and verifies a snippet. The retained Setup URI screenshots show only encrypted URIs and visually masked Setup URI passphrases; plaintext credentials are not captured. Files prefixed with `guide-` capture the relevant dialogue, settings panel, or workspace leaf without transient Notices. Public documentation copies selected images only after visual inspection; the E2E run does not overwrite repository documentation assets.

`test:e2e:obsidian:two-vault-sync` runs a two-vault note synchronisation workflow. It verifies note creation, update, ordinary rename, a case-only file name change within the same directory, deletion, and a separate encrypted round-trip with Path Obfuscation enabled. Its target-filter scenario confirms that one Vault receives and checkpoints a remote document without reflecting it, restarts with the same profile and filter, and then reflects the stored document after the filter is broadened through the settings service. Directory case changes deliberately remain outside this scenario because they require directory-aware rename handling. The optional Markdown conflict check can be enabled with `E2E_OBSIDIAN_INCLUDE_MARKDOWN_CONFLICT=true`. It creates divergent revisions in two separate Vaults, performs a conservative merge on one Vault, edits that result again, and requires the other Vault to replace its known deleted losing revision without recreating the conflict. The separate `E2E_OBSIDIAN_INCLUDE_CONFLICT_OPERATIONS=true` check keeps four conflicts active while one Vault edits, deletes, performs a case-only rename, and performs a cross-path rename. It asserts that each operation extends the revision displayed on that device, replicates the exact resulting revision tree, and preserves the other live branch. During focused development, `E2E_OBSIDIAN_ONLY_CONFLICT_OPERATIONS=true` runs that self-contained scope without the ordinary, target-filter, or encrypted scenarios. Both conflict checks remain outside the default local suite.

`test:e2e:obsidian:hidden-file-snippet-sync` runs a two-vault hidden file round-trip. It verifies creation and deletion of a real `.obsidian/snippets/*.css` file, automatic JSON conflict merging for a hidden file with the merged result propagated by a second synchronisation, manual JSON Resolve dialogue application through Obsidian's UI, and per-device target patterns where one vault ignores a hidden file that the other vault synchronises. It also covers [issue #555](https://github.com/vrtmrz/obsidian-livesync/issues/555) by requiring several plug-in and settings changes to share one mobile-safe Notice with actionable touch targets; a manually dismissed group must not repeat its acknowledged rows when a later change arrives.

`test:e2e:obsidian:customisation-sync` runs a two-vault Customisation Sync workflow. It scans a real snippet CSS file, config JSON file, and sample plug-in fixture into per-file Customisation Sync data, synchronises the entries through CouchDB, applies them on the second vault, verifies the resulting `.obsidian` files, propagates a snippet update, and verifies deletion of the source-vault snippet sync data without confusing it with the target vault's own applied copy.

`test:e2e:obsidian:setting-markdown-export` enables setting Markdown export, waits for the generated Markdown file in the vault, and verifies that credentials are omitted when `writeCredentialsForSettingSync=false`.

`test:e2e:obsidian:upgrade-from-stable` is the release-acceptance upgrade workflow. It installs the exact published 0.25.83 artefacts into an isolated Vault, verifies their pinned SHA-256 values, and then replaces only the plug-in artefacts with the current target while retaining the same Vault and isolated Obsidian profile. The first run downloads the old release into the ignored `_testdata/releases` cache; every later run verifies the cached bytes before use.

The workflow first exercises a non-empty legacy settings document which has no `isConfigured` or file-name case value. It verifies that 0.25.83 treats a default-equivalent document as unconfigured. That release can persist the inferred boolean during a later, unrelated settings-save event, so the runner accepts either an absent value or the inferred `false` on disk, then restores the same minimal pre-flag document deliberately before installing 1.0. The target independently proves its direct migration: the Vault remains unconfigured instead of receiving new-Vault recommendations, case-insensitive handling becomes explicit, no compatibility pause or acknowledgement marker is created while onboarding remains pending, and a second 1.0 start is idempotent. The absent marker is deliberately deferred rather than accepted; a later configured start must evaluate it. This fixture rewrite is limited to the missing-flag boundary; the configured transport upgrades use only state created and saved by 0.25.83 itself.

For CouchDB and Object Storage, the workflow then configures 0.25.83 from its own defaults, saves the selected remote, and restarts that release with the same profile before creating history. This both verifies that the old settings persist and lets the old release initialise its replicator from the same saved state as an ordinary existing Vault. The runner waits for that release's asynchronously initialised persistent node identity, creates, edits, renames, and deletes notes, and synchronises each transition before installing the target. Every launch of the upgraded device uses the same isolated Obsidian profile. The session layer closes the renderer before its process-tree fallback, so Chromium persists the legacy compatibility marker naturally; the target must read and migrate that actual profile state to its current namespaced key. The final target restart likewise consumes the marker persisted by the preceding target session. The runner does not reconstruct that device's Vault data, plug-in settings, local database files, device-local state, or remote state. Before the target performs any synchronisation, it must retain the same Vault profile, local database, node identity, remote profile, local checkpoint, and remote milestone. The local node-info document is the identity source of truth; a transient replicator field is used only to confirm that the old asynchronous initialisation has completed. Its first synchronisation must be a no-op: CouchDB document revisions and `update_seq` must remain unchanged, while Object Storage must neither upload nor download journal bodies. The upgraded device then sends a new delta. A separate fresh 1.0 verifier starts from an explicit current-version settings and compatibility fixture, receives the complete surviving history, and returns another delta; it is not part of the legacy-profile migration assertion. The upgraded Vault receives that return journey and retains it across restart.

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

Useful environment variables:

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
- `E2E_OBSIDIAN_SETTINGS_TIMEOUT_MS`: timeout for the settings pane and its deletion controls to become visible; default is 10 seconds.
- `E2E_OBSIDIAN_REVIEW_HARNESS_TIMEOUT_MS`: timeout for Review Harness view and action boundaries; default is 15 seconds.
- `E2E_OBSIDIAN_P2P_PANE_TIMEOUT_MS`: timeout for the P2P status pane and its principal connection control; default is 10 seconds.
- `E2E_OBSIDIAN_P2P_WORKFLOW_TIMEOUT_MS`: timeout for each visible P2P Setup URI, peer-discovery, approval, and replication control; default is 60 seconds.
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
- `E2E_OBSIDIAN_FILE_TIMEOUT_MS`: timeout for waiting until a note created through Obsidian's vault API is reflected to disk.
- `E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS`: timeout for waiting until Self-hosted LiveSync reports that its core lifecycle and local database are ready.
- `E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS`: timeout for waiting until a file appears in Self-hosted LiveSync's local database.
- `E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS`: timeout for waiting until CouchDB contains uploaded E2E documents.
- `E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS`: timeout for an observed remote activity to enter or leave its status boundary; default is 30 seconds.
- `E2E_OBSIDIAN_DIAGNOSTICS_DIR`: directory for screenshots and status snapshots captured after a remote-activity failure; default is `/tmp/obsidian-livesync-e2e`.
- `E2E_OBSIDIAN_OBJECT_STORAGE_TIMEOUT_MS`: timeout for waiting until Object Storage contains uploaded E2E objects.
- `E2E_OBSIDIAN_KEEP_COUCHDB=true`: keep the temporary CouchDB database for inspection.
- `E2E_OBSIDIAN_KEEP_OBJECT_STORAGE=true`: keep the temporary Object Storage prefix for inspection.
- `E2E_OBSIDIAN_STARTUP_GRACE_MS`: early process-exit detection window in milliseconds.
- `E2E_OBSIDIAN_KEEP_VAULT=true`: keep the temporary vault for inspection.
- `E2E_OBSIDIAN_USE_XVFB=false`: disable automatic `xvfb-run` on headless Linux.
- `E2E_OBSIDIAN_USE_USER_DATA_DIR=false`: disable the isolated Electron `--user-data-dir` argument. This is not recommended for normal local testing.
- `E2E_OBSIDIAN_ARGS`: override the default Obsidian launch arguments.

On headless Linux, the runner automatically uses `/usr/bin/xvfb-run` when no `DISPLAY` or `WAYLAND_DISPLAY` is present.
