# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

### Improved

- When an unsupported E2EE format stops a CouchDB Fetch, the CLI and Obsidian explain how to rebuild the remote from another device and retry Fetch. (#1365)

## 1.0.51

18th November, 2026

### Fixed

- Files registered as **Ignore** or **Automatic** in **Customisation sync** no longer trigger new snapshots during configuration scans. (#1359)
    - Existing snapshots are retained. Exclusions still rely on each item's recorded file list, and this fix does not repair empty or outdated lists.

- **Hidden File Sync** now respects **Customisation sync** exclusions (**Ignore** and **Selective**) for registered paths containing uppercase letters. (#1359)
    - When **Customisation sync** is enabled, the exclusion check compares both paths in lowercase, restoring case-insensitive matching.

### Improved

- We can see at a glance when automatic synchronisation is disabled, including while it remains suspended after Fetch or Rebuild. (#1361)
    - A framed badge in the status bar and editor overlay displays the configured **LiveSync**, **Periodic**, **On events**, or manual-only mode alongside current transfer activity.
    - Available for CouchDB and S3-compatible Object Storage remotes. Fetch and Rebuild retain their existing suspension behaviour.

- We can mute recurring plug-in version Notices for individual devices from **Joined devices** using **Mute version notices**. (#1349, #1368)
    - Choices are retained only for this Vault on this device and can be reversed with **Unmute version notices**, while synchronisation compatibility checks remain enabled. Removing a device record remains available under **… → Forget device record…**.

#### Recovery work in progress

- This plug-in can now reopen an unavailable local database before resuming synchronisation, after a read against the current connection fails, instead of requiring an immediate force-quit. (#1360)
    - Local file dispatch is held while the connection is replaced; if reopening fails, this plug-in requests an Obsidian restart. This recovery path does not prevent platform disconnections or detect an adapter operation which never settles.
    - Controlled Linux Obsidian recovery tests pass; natural background connection loss and recovery on a physical iPhone remain unverified.

- Ordinary Vault files which could not be reflected are retained for recovery and review, rather than remaining silently unapplied until another scan. (#1224, #1360)
    - Failures at known local database or remote content-read boundaries are eligible for one automatic retry after every required resource recovers. Failures without an established retry condition and items whose automatic allowance is exhausted remain available under **Hatch** → **Recovery and Repair** → **Review files which could not be reflected**.
    - Native request failures preserve their origin without relying on message text, and reopening the same local database retains saved recovery items and consumed retry allowances.

#### Developer tools

- The Review Harness (enabled via **Power users → Enable Developers' Debug Tools**) adds individual database diagnostics: **Database connection-loss diagnostic**, **Database background-events diagnostic**, and **Database transaction-abort diagnostic**.
    - These diagnostics use disposable database fixtures and record observations only; a run with no observed failure does not establish that recovery succeeded or attempt automatic product recovery.

### CLI

#### Fixed

- CLI file lookups avoid full Vault scans when checking files which have not arrived locally or have already been deleted. (#1347)
    - With Legacy file identity (`pathNormalizationVersion: 0`) and case-insensitive file-name handling, matching directory branches are listed directly instead of scanning unrelated Vault subtrees.

### Docker

#### Fixed

- The Docker Compose sample can now re-run initialisation against an already configured CouchDB server and preserve authentication and CORS settings when the container is recreated. (#1356)
    - The initialisation check authenticates with CouchDB, and a dedicated volume retains runtime configuration. Before recreating CouchDB on an existing stack, save and transfer its settings as described in [Data & Backup](docker/README.md#data--backup).

### Miscellaneous

- Updated dependencies (including `@vrtmrz/livesync-commonlib` 0.6.0).

### Acknowledgements

Thank you for your contributions!

- @levity, for avoiding full Vault scans during case-insensitive CLI file lookups (#1347).

## 1.0.50

12th November, 2026

### Fixed

- File-name collision checks no longer rebuild the whole path map after content-only edits.

#### P2P synchronisation

- Later P2P changes can continue to reach following devices when an earlier change notification was ignored before the peer was accepted. (#1247)
    - Change notifications no longer wait for a reply from the receiving device. A missed final notification still requires a later change or explicit synchronisation.

### CLI

#### Fixed

- CLI daemon collision checks no longer enumerate every file and its metadata after each content edit. (#1346)
    - The daemon maintains file names from filesystem observations and checks current directory names before accepting a path.

- We can synchronise CLI Vaults whose root or parent directories have dot-prefixed names, including through symlinks that resolve to those locations. (#1340)
    - Watch exclusions now apply within the selected Vault. Startup scans and live monitoring share the same exclusions, including PouchDB view indexes.
    - Hidden entries, the configured database storage entries, and `.livesync/ignore` rules remain excluded.

#### Added

- We can include ordinary directories with database-like names by specifying `--include-db-like-dirs` on each invocation. The CLI's database storage entries, hidden entries, and user ignore rules remain excluded.

## 1.0.49

11th November, 2026

### Changed

#### Encryption

- With E2EE enabled, CouchDB documents containing unencrypted file content are now rejected by default.
    - To retain the previous behaviour for third-party integrations that intentionally write plaintext, expand **Advanced** in the E2EE dialogue and enable **Accept unencrypted content**. The setting is off by default.
    - Enabling it allows anyone with write access to the remote database to supply plaintext file content. Content sent by this plug-in remains encrypted.
    - The setting is included in exported settings Markdown, Setup URIs, and QR codes. Changing this setting alone does not require Fetch or Rebuild.

### Miscellaneous

- Updated dependencies.

### Acknowledgements

- @Hama1cco, for reporting plaintext content acceptance with E2EE enabled.

## 1.0.48

11th November, 2026

### Fixed

- Ordinary start-up scans can apply retained database deletions to Vault files whose content is confirmed unchanged. (#1338)
    - Files with local changes or insufficient provenance remain available for review.
    - Interrupted provenance and scan-record cleanup is retried from existing local state during a later scan.

## 1.0.47

9th November, 2026

### Fixed

#### Synchronisation and recovery

- Temporary read failures no longer leave synchronisation blocked until Obsidian restarts. (#1331)
    - A related file change or **Apply pending changes now** retries the failed operation.
    - This applies to ordinary Vault files and uses the current Vault state.

- Fixed CouchDB Fetch failures in Vaults that already contain the fetched files. (#1329, #1332)
    - With **Fetch chunks on demand** enabled, missing Chunks are retrieved when needed.
    - The same fix applies when Fast Setup falls back to Standard Fetch.
    - **Use Only Local Chunks** remains respected. Unavailable content keeps Fetch incomplete for retry.

### CLI

#### Fixed

- Fixed repeated CouchDB Fetch failures in an existing Vault. (#1329)
    - Content checks retrieve missing Chunks with **Fetch chunks on demand** enabled.
    - **Use Only Local Chunks** remains respected. Incomplete Fetch operations retain their recovery state.

- Unreadable hidden directories no longer prevent the CLI daemon from starting. (#1325)
    - Vault scans skip these directories, which remain excluded from synchronisation.

- The daemon no longer misses files written into newly created folders. (#1328)
    - This includes bursts of writes and files renamed from temporary names.
    - The CLI requires Node.js 22.22 or later. The Docker image includes its own runtime.
