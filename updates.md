# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## 0.25.80

7th July, 2026

### Fixed

- Improved Markdown conflict auto-merge so that non-overlapping edits are merged while overlapping delete-and-edit cases remain visible for manual resolution (#993).
  - Behaviour change:
    - When one side deletes an unchanged line and the other side edits a different region, the deleted line is no longer reintroduced into the merged result.
    - When one side deletes a line and the other side modifies that same line, the conflict is preserved instead of silently choosing one side.
- Fixed an issue where applying a newer database entry to storage could incorrectly preserve an older local file as a conflict (#994).
  - Behaviour change:
    - Local storage is preserved as a conflict when it may contain unsynchronised changes that are not represented in the revision history. A newer incoming text entry is applied without creating a conflict only when it clearly extends the existing local text.
- Fixed an issue where choosing Disable and then Overwrite in Hidden File Sync could silently skip hidden files, because the overwrite setup ran while hidden file synchronisation was still disabled (#989, PR #992).
  - Hidden File Sync is now re-enabled before the Fetch, Overwrite, or Merge initialisation runs, instead of after it completes. If that initialisation fails, the setting may remain enabled.

## 0.25.79

29th June, 2026

### Fixed

- Fast Fetch now retries transient stream interruptions and resumes from the latest persisted checkpoint, instead of starting over after ordinary network or platform interruptions (#977, PR #978; commonlib PR #59). Thank you so much for @apple-ouyang for the fix!
- Simple Fetch now remembers the selected setup choices while an interrupted Fetch All operation is still pending, so users are not asked the same questions again on retry (#977, PR #978). Thank you so much for @apple-ouyang for the fix!
- No longer hidden storage events, such as `.git` paths, reach the normal target-file filter when internal file synchronisation is disabled. This avoids noisy non-target logs before those files are skipped (commonlib PR #60). Thank you so much for @apple-ouyang for the fix!
- Fixed an issue where a file deleted from storage could be resurrected by the offline scanner because the database tombstone was not written when the storage file was already gone (commonlib PR #56). Thank you so much for @cosmic-fire-eng for the fix!

### Improved

- Local database maintenance commands now ask before applying the required chunk settings, and can apply those prerequisites before continuing (#980, PR #981). Thank you so much for @apple-ouyang for the improvement!
- Improved CouchDB replication event handling by using the new `StreamInbox` helper from `octagonal-wheels` (commonlib PR #62).

### Documentation

- Added `nginx` to the setup documentation table of contents (PR #976). Thank you so much for @kiraventom for the improvement!

### Miscellaneous

- Updated `octagonal-wheels` to `0.1.47` across the plug-in and workspace packages to use the newly published helper modules.

## 0.25.78

23rd June, 2026

### Fixed
- No longer fast synchronisation (a.k.a. Fast Fetch) causes a rewind and re-fetch of the entire database when some errors occur during the process (#972, PR #973). Thank you so much for @apple-ouyang for the fix!

### Improved

- Overhauled the Object Storage (e.g., MinIO and S3) replication engine ('Journal Replicator 2nd Edition').
  - It now leverages the standard Web Streams API for a resilient, backpressure-aware architecture, reducing memory footprints/temporary storage usage on large vaults.
  - Decoupled the physical storage logic to make it easier to add new storage backends in the future.
  - Stricter compliance with CouchDB's replication protocol (proper `_revisions` transfers with `new_edits: false`) when using Object Storage.

### Testing
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

Full notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
