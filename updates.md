# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.


## Unreleased

### Improved

- Overhauled the Object Storage (e.g., MinIO and S3) replication engine ('Journal Replicator 2nd Edition'). It now leverages the standard Web Streams API for a resilient, backpressure-aware architecture, reducing memory footprints on large vaults.
- Decoupled the physical storage logic to make it easier to add new storage backends in the future.
- Stricter compliance with CouchDB's replication protocol (proper `_revisions` transfers with `new_edits: false`) when using Object Storage.
- Introduced Connection String support for setup configuration.
- Added comprehensive unit tests for the new `JournalSyncCore` engine, covering streams, backpressure, and `new_edits: false` validation.
- Improved integration test workflows in the CI pipeline to run MinIO tests automatically using standard environment variables.

## 0.25.77

19th June, 2026

This update is mostly meaningless for users. But for maintainers, not, I hope. I wonder if I were done well in the start, there would be no hassles. It really was a great opportunity.

Also, this update is a very large one, even if we had a lot of time, and we had CI tests, and mostly only fixing the types. Please let me know if you find any issues!

### Improved

- File deletion now respects the user's deletion preferences (by utilising the `FileManager.trashFile` API) on Obsidian v1.7.2 or newer, regardless of the plug-in's internal trashbin setting.

### Miscellaneous
- Typings of the library are now included
- Many typing errors have been improved.
- Import paths have been normalised to be relative to the root and to the `lib/src` directory, to avoid breaking the boundary between the library and the plug-in.
- Subprojects, such as the CLI and the webapp, are now in the workspace.

## 0.25.76

15th June, 2026

### Fixed

- Now the S3 connection with custom headers works properly (#875).
  - Previously, custom headers injected for proxy authentication were incorrectly included in the AWS Signature v4 calculation. This led to a '400 Bad Request' error (such as 'signed header is not present') on strict S3 backends (for example, Garage), or when reverse proxies modified, renamed, or stripped these headers before they reached the storage service.
- No longer connection information of the P2P synchronisation is broken on the specific platform (#956).

## 0.25.75

13th June, 2026

### Fixed

- Fixed an issue where using fast synchronisation caused a TypeError in some environments (#953).

### New features
- Now we can configure to keep replication active in the background on desktop platforms (#939, PR #949). Thank you so much for @migsferro!

### Fixed (CLI, automated)

- Fixed an issue where the mirror command could fail to apply updates when conflict preservation checks prevented overwriting unsynchronised local changes, even when the `force` parameter or `writeDocumentsIfConflicted` setting was enabled.

### Improved

- (CLI) Ported the remaining bash regression tests (`test-daemon-linux.sh`, `test-decoupled-vault-linux.sh`, and `test-remote-commands-linux.sh`) to Deno for cross-platform validation.

### Miscellaneous
- Some dependencies have been updated.
- Now we check the compatibility with iOS 15 in the CI tests to ensure the plugin continues to work on older iOS versions even after we upgrade some dependencies.

## 0.25.74

8th June, 2026

### Fixed

- Fixed an issue where disabling hidden file synchronisation did not take effect, allowing non-target hidden files to continue to be processed and synchronised by replication or boot-sequence scan (#941).
- Prevented the automatic merging of conflicted revisions when one of the revisions has been deleted, which was causing deleted files to reappear (#911).
- The startup sequence now saves the state more effectively (Thank you so much for @bmcyver)!

## Only CLI

8th June, 2026

I should also consider the version numbering for the CLI...

### Improved

- Added new remote database management commands: `remote-status`, `unlock-remote`, `lock-remote`, and `mark-resolved`.
- --vault option is now available for daemon and mirror commands! (Thank you so much for @starskyzheng)!
- Decoupled the database directory path from the actual vault directory path using the `--vault` (or `-V`) option.

### Fixed (preventive)

- Validated that the specified vault path exists and is indeed a directory before starting the CLI.
- Integrated path resolution and validations for one-off commands (such as `'push'`, `'pull'`, `'cat'`, `'rm'`, `'info'`, and `'resolve'`) against the decoupled vault path instead of the database path.

## 0.25.73

4th June, 2026

### Fixed

- Adjust CouchDB's database name checking to its specification (#926).
- `Reset Syncronisation on This Device` for minio and P2P is now working properly. 

## ~~0.25.71~~ 0.25.72

0.25.71 was cancelled due to the fixes needed (Object Storage related)

3rd June, 2026

### Improved

- Database fetching (a.k.a. Reset Synchronisation on This Device) on the initialisation now supports streaming and is faster (CouchDB only)
- The database fetching process has been streamlined, and database operations are now suspended until it has been completed
- The initial synchronisation process has been simplified, making it easier to synchronise files with the remote server
- We can select the remote database to fetch from during the initialisation, when there are multiple remote databases configured (e.g. multiple CouchDBs or S3 remotes)
- Hebrew (he) Translation has been added (Thank you so much, @MusiCode1)!
- Translation loading time has been reduced (Thank you so much, @bmcyver)!
  
### Fixed

- No longer does the status element break other plugins' interaction (#930).
- No longer does file events occured during initial database fetching using Object Storage. 

### Refactored

To support the new Community automated tests, we fixed numerous lint warnings. This may have also resolved potential issues.

## 0.25.70

25th May, 2026

### New features
- Diff dialogue now has great tools to navigate and understand the differences, including:
  - A checkbox to toggle the visibility of collapsed identical sections, making it easier to focus on the actual differences (PR #889).
  - A search feature to find specific text in past revisions, and navigate revisions with search results highlighted in the dialogue (PR #890).

- Conflict resolution dialogue now has a navigation feature to jump between conflicts (PR #891).

Thank you so much to @SeleiXi for implementing these features!

### Improved

- More diagnostic information for P2P connections is now shown, including why a connection failure occurred and the current connection status.

## 0.25.69

22nd May, 2026

### Fixed
- No longer does the P2P passphrase mismatch cause a server shutdown.
- Settings related to P2P synchronisation are now correctly applied on start-up and no longer reverted.

### New features
- Diagnostic P2P connection stats are now available.
  - These stats indicate the number of connection trials, successes, and failures.

Full notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
