# Real Obsidian E2E Runner

This directory contains the experimental real Obsidian end-to-end runner.

The current smoke runner verifies only the launch path:

1. create a temporary vault,
2. install the built Self-hosted LiveSync plug-in artifacts,
3. launch real Obsidian,
4. open the temporary vault through `obsidian-cli`,
5. enable Obsidian community plug-ins for the temporary app profile,
6. reload Self-hosted LiveSync through `obsidian-cli`,
7. verify through `obsidian-cli eval` that the plug-in is loaded,
8. optionally drive a real vault or CouchDB workflow through Obsidian's own API,
9. terminate Obsidian and remove the temporary vault.

The runner does not require Self-hosted LiveSync to expose an E2E-only bridge. Readiness is checked from outside the plug-in through Obsidian's own CLI.

Obsidian 1.12 stores the global community plug-in switch outside `.obsidian/community-plugins.json`. The smoke runner enables it through `app.plugins.setEnable(true)` after the vault window is available.

Future workflows should use `startObsidianLiveSyncSession()` from `runner/session.ts` rather than repeating the launch and plug-in readiness sequence.

Each test vault uses an isolated Obsidian profile. The runner creates temporary directories for `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, and Electron `--user-data-dir`, writes the vault registry into those directories, pre-seeds the temporary Chromium local storage so community plug-ins are trusted for that generated vault ID, and passes the same environment to `obsidian-cli`. This is intended to keep real Obsidian E2E runs separate from a developer's daily Obsidian profile and vault registry.

## Local Setup

Set `OBSIDIAN_BINARY` when Obsidian is not installed in a standard location.

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

```bash
npm run test:e2e:obsidian:install-appimage
npm run test:e2e:obsidian:discover
npm run test:e2e:obsidian:cli-help -- vaults verbose
npm run test:e2e:obsidian:smoke
npm run test:e2e:obsidian:vault-reflection
npm run test:e2e:obsidian:couchdb-upload
npm run test:e2e:obsidian:minio-upload
npm run test:e2e:obsidian:startup-scan
npm run test:e2e:obsidian:two-vault-sync
npm run test:e2e:obsidian:hidden-file-snippet-sync
npm run test:e2e:obsidian:customisation-sync
npm run test:e2e:obsidian:setting-markdown-export
npm run test:e2e:obsidian:local-suite
npm run test:e2e:obsidian:local-suite:services
```

`test:e2e:obsidian:local-suite` runs `npm run build`, discovery, smoke, vault reflection, CouchDB upload, Object Storage upload, startup scan, two-vault synchronisation, Hidden File Sync, Customisation Sync, and setting Markdown export in sequence. Start the local CouchDB and MinIO fixtures before running it, or use `test:e2e:obsidian:local-suite:services` to let the wrapper stop leftover fixtures, start fresh fixtures, and stop them again after the run.

`test:e2e:obsidian:couchdb-upload` reuses the CouchDB variables from `.test.env` or the process environment. It expects a reachable CouchDB service, creates a unique database, configures Self-hosted LiveSync through `obsidian-cli eval`, creates a note in real Obsidian, commits the note into the local database, runs one-shot synchronisation, and verifies that the remote database contains both the metadata document and its chunk documents.

`test:e2e:obsidian:minio-upload` reuses the Object Storage variables from `.test.env` or the process environment. It expects a reachable S3-compatible service, configures Self-hosted LiveSync for Object Storage through `obsidian-cli eval`, creates a note in real Obsidian, runs one-shot Journal Sync, and verifies through the AWS SDK that objects were written under a unique bucket prefix.

`test:e2e:obsidian:startup-scan` configures a temporary CouchDB database, stops Obsidian, writes a note directly into the vault, restarts Obsidian, and verifies from CouchDB that the boot-time scan picked up the offline file.

`test:e2e:obsidian:two-vault-sync` runs a two-vault note synchronisation workflow. It verifies note creation, update, rename, deletion, per-device target filters where one vault ignores a note that the other vault synchronises, and a separate encrypted round-trip with Path Obfuscation enabled. The optional Markdown conflict automatic merge check can be enabled with `E2E_OBSIDIAN_INCLUDE_MARKDOWN_CONFLICT=true`, but it is not part of the default local suite.

`test:e2e:obsidian:hidden-file-snippet-sync` runs a two-vault hidden file round-trip. It verifies creation and deletion of a real `.obsidian/snippets/*.css` file, automatic JSON conflict merging for a hidden file with the merged result propagated by a second synchronisation, manual JSON Resolve dialogue application through Obsidian's UI, and per-device target patterns where one vault ignores a hidden file that the other vault synchronises.

`test:e2e:obsidian:customisation-sync` runs a two-vault Customisation Sync workflow. It scans a real snippet CSS file, config JSON file, and sample plug-in fixture into per-file Customisation Sync data, synchronises the entries through CouchDB, applies them on the second vault, verifies the resulting `.obsidian` files, propagates a snippet update, and verifies deletion of the source-vault snippet sync data without confusing it with the target vault's own applied copy.

`test:e2e:obsidian:setting-markdown-export` enables setting Markdown export, waits for the generated Markdown file in the vault, and verifies that credentials are omitted when `writeCredentialsForSettingSync=false`.

Start the local fixtures first when they are not already running:

```bash
npm run test:docker-couchdb:start
npm run test:docker-s3:start
npm run test:e2e:obsidian:local-suite
```

Or let the wrapper manage both fixtures:

```bash
npm run test:e2e:obsidian:local-suite:services
```

Useful environment variables:

- `OBSIDIAN_BINARY`: explicit Obsidian executable path.
- `E2E_OBSIDIAN_VERSION`: Obsidian AppImage version for `test:e2e:obsidian:install-appimage`; default is `1.12.7`.
- `E2E_OBSIDIAN_APPIMAGE_ARCH`: AppImage architecture override, such as `arm64` or `x86_64`.
- `E2E_OBSIDIAN_APPIMAGE_URL`: explicit AppImage URL override.
- `E2E_OBSIDIAN_DOWNLOAD_DIR`: AppImage download and extraction directory; default is `_testdata/obsidian`.
- `E2E_OBSIDIAN_FORCE_DOWNLOAD=true`: re-download the AppImage even when it exists.
- `E2E_OBSIDIAN_SKIP_EXTRACT=true`: download the AppImage without extracting it.
- `E2E_OBSIDIAN_SMOKE_TIMEOUT_MS`: smoke timeout in milliseconds.
- `E2E_OBSIDIAN_READY_TIMEOUT_MS`: plug-in readiness timeout in milliseconds.
- `E2E_OBSIDIAN_CLI_READY_TIMEOUT_MS`: timeout for waiting until the vault-side Obsidian CLI exposes the plug-in catalogue.
- `E2E_OBSIDIAN_CLI_TIMEOUT_MS`: timeout for each `obsidian-cli` invocation.
- `E2E_OBSIDIAN_FILE_TIMEOUT_MS`: timeout for waiting until a note created through Obsidian's vault API is reflected to disk.
- `E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS`: timeout for waiting until Self-hosted LiveSync reports that its core lifecycle and local database are ready.
- `E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS`: timeout for waiting until a file appears in Self-hosted LiveSync's local database.
- `E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS`: timeout for waiting until CouchDB contains uploaded E2E documents.
- `E2E_OBSIDIAN_OBJECT_STORAGE_TIMEOUT_MS`: timeout for waiting until Object Storage contains uploaded E2E objects.
- `E2E_OBSIDIAN_KEEP_COUCHDB=true`: keep the temporary CouchDB database for inspection.
- `E2E_OBSIDIAN_KEEP_OBJECT_STORAGE=true`: keep the temporary Object Storage prefix for inspection.
- `E2E_OBSIDIAN_STARTUP_GRACE_MS`: early process-exit detection window in milliseconds.
- `E2E_OBSIDIAN_KEEP_VAULT=true`: keep the temporary vault for inspection.
- `E2E_OBSIDIAN_USE_XVFB=false`: disable automatic `xvfb-run` on headless Linux.
- `E2E_OBSIDIAN_USE_USER_DATA_DIR=false`: disable the isolated Electron `--user-data-dir` argument. This is not recommended for normal local testing.
- `E2E_OBSIDIAN_ARGS`: override the default Obsidian launch arguments.

On headless Linux, the runner automatically uses `/usr/bin/xvfb-run` when no `DISPLAY` or `WAYLAND_DISPLAY` is present.
