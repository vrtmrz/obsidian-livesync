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
8. terminate Obsidian and remove the temporary vault.

The runner does not require Self-hosted LiveSync to expose an E2E-only bridge. Readiness is checked from outside the plug-in through Obsidian's own CLI.

Obsidian 1.12 stores the global community plug-in switch outside `.obsidian/community-plugins.json`. The smoke runner enables it through `app.plugins.setEnable(true)` after the vault window is available.

Future workflows should use `startObsidianLiveSyncSession()` from `runner/session.ts` rather than repeating the launch and plug-in readiness sequence.

## Local Setup

Set `OBSIDIAN_BINARY` when Obsidian is not installed in a standard location.

For an AppImage on Linux without FUSE, use the helper script:

```bash
npm run test:e2e:obsidian:install-appimage
```

The script downloads Obsidian `1.12.7` for the current architecture, stores it in `_testdata/obsidian`, and extracts it to `_testdata/obsidian/squashfs-root`. The runner checks `_testdata/obsidian/squashfs-root/obsidian` before the AppImage path.

Do not download the AppImage on every CI run. Prefer one of these approaches:

- set `OBSIDIAN_BINARY` to a pre-installed Obsidian executable,
- restore `_testdata/obsidian/squashfs-root` from a CI cache, or
- run `test:e2e:obsidian:install-appimage` only in a manually triggered preparation job.

## Commands

```bash
npm run test:e2e:obsidian:install-appimage
npm run test:e2e:obsidian:discover
npm run test:e2e:obsidian:cli-help -- vaults verbose
npm run test:e2e:obsidian:smoke
npm run test:e2e:obsidian:vault-reflection
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
- `E2E_OBSIDIAN_STARTUP_GRACE_MS`: early process-exit detection window in milliseconds.
- `E2E_OBSIDIAN_KEEP_VAULT=true`: keep the temporary vault for inspection.
- `E2E_OBSIDIAN_USE_XVFB=false`: disable automatic `xvfb-run` on headless Linux.
- `E2E_OBSIDIAN_ARGS`: override the default Obsidian launch arguments.

On headless Linux, the runner automatically uses `/usr/bin/xvfb-run` when no `DISPLAY` or `WAYLAND_DISPLAY` is present.
