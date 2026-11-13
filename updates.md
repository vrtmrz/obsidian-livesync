# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

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

## 1.0.46

7th November, 2026

P2P synchronisation can stop connecting when our devices are on different versions. And this is one of those versions.

If we use P2P synchronisation, let us make sure all our devices are on the same version.

### Fixed

#### Synchronisation and recovery

- Receiving devices no longer reject newly saved files with 'seems to be corrupted! Writing prevented' because rapid edits left the sender's cached file size out of date. New saves record the byte length of the content actually read. (#1324)
    - Existing incorrect size records need explicit repair. Use **Inspect conflicts and file/database differences** → **Correct recorded file size** when the readable current database revision has no conflicts and matches the Vault exactly. The correction retains the file content and timestamps.

#### P2P synchronisation

- Peer actions and long device names now fit narrow panes. Larger buttons and wrapped labels keep the controls readable and usable.

### Improved

#### P2P synchronisation

- We can inspect the latest relay, peer, and synchronisation observations in **P2P Status**. Expand **Diagnostic summary** below **Stats**; detailed observations start collapsed.
    - Enable **Diag** to show diagnostic events in the Log Pane without editor-status updates or notifications. Opening the Log Pane also displays its buffered messages.
    - Unobserved information is labelled explicitly. An open room does not establish relay acceptance; relay rejection details remain unavailable through the diagnostic summary.

- We can see sent (↑) and received (↓) database document revision counts in the P2P panes and editor status, and in the main status bar when P2P is our main remote. Counts include Metadata and Chunks, rather than Vault files.
    - Directional ⏩ labels show changes-feed comparison progress, including when no revisions need transferring. Each label disappears three seconds after its count last changes; its absence alone does not establish completion. Peers without document statistics retain sequence values labelled `seq`.

- The updated transport incorporates upstream improvements to peer discovery after relay reconnection, missed signalling messages, and stale connections after rejoining or waiting. Connection offers are created on demand.
    - All communicating devices in our P2P group, including CLI and WebPeer clients, must be updated together before P2P synchronisation resumes. Trystero 0.26.0 cannot exchange data with the previous transport.

### Documentation

- Clarified backend selection and hosting requirements, including Object Storage request costs. Added a guide to P2P diagnostic observations, logs, and transfer progress.
