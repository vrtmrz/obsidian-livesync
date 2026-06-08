# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## Unreleased

8th June, 2026

### Fixed

- Prevented the automatic merging of conflicted revisions when one of the revisions has been deleted, which was causing deleted files to reappear (#911).

## Only CLI

8th June, 2026

- Added new remote database management commands: `remote-status`, `unlock-remote`, `lock-remote`, and `mark-resolved`.

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

## 0.25.68

22nd May, 2026

### Improved

- P2P connections have improved slightly
  - Upgrade to `trystero` v0.24.0, and fixes event handler assignment. This should fix some edge cases where P2P connections fail to establish or messages are not properly handled.
  - Weaken terser options to avoid potential issues with minification that could cause runtime errors in some environments.

## ~~0.25.66~~ 0.25.67

20th May, 2026

0.25.66 had a bug that the auto-accept logic for compatible but lossy mismatches was not working as intended.

### New features
- Implement an auto-accept compatible tweak setting and enhance the mismatch resolution logic.

### Improved
- Many messages related to tweak mismatch resolution have been updated for clarity.

## 0.25.65

19th May, 2026

### Fixed
- Fix an issue about resuming from background on iOS (#888).
- Now Chunk Splitter: `V3: Fine Deduplication` is working fine again (#866).
  - It has some drawbacks, such as fewer chunks are generated. However, it makes less transfer and storage when the files are modified but not completely changed.
- Unsynchronised local changes (which means changes that have not been sent) are now correctly preserved as a conflict (Thank you so much for @SeleiXi!).
- Avoid creating a new revision when the current and conflicted revisions have identical content (Thank you so much for @daichi-629).

### Improved
- Improved the error verbosity on concurrent processing during the start-up process.
- Now the `report` includes recent logs (of verbosity `verbose` even settings is not set to `verbose`).
- Updating logs is now debounced to avoid excessive updates during rapid log generation.
- Added a `Generate full report for opening the issue with debug info` command to the command palette, which generates a report without opening the settings dialogue.


Full notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
