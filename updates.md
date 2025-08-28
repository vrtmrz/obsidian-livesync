## 0.25.11

28th August, 2025

### Fixed

- Automatic translation detection on the first launch now works correctly (#630).
- No errors are shown during synchronisations in offline (if not explicitly requested) (#699).
- Missing some checking during automatic-synchronisation now works correctly.

## 0.25.10

26th August, 2025

### New experimental feature

- We can perform Garbage Collection (Beta2) without rebuilding the entire database, and also fetch the database.
    - Note that this feature is very experimental and should be used with caution.
    - This feature requires disabling `Fetch chunks on demand`.

### Fixed

- Resetting the bucket now properly clears all uploaded files.

### Refactored

- Some files have been moved to better reflect their purpose and improve maintainability.
- The extensive LiveSyncLocalDB has been split into separate files for each role.

## 0.25.9

20th August, 2025

### Fixed

- CORS Checking messages now use replacements.
- Configuring CORS setting via the UI now respects the existing rules.
- Now startup-checking works correctly again, performs migration check serially and then it will also fix starting LiveSync or start-up sync. (#696)
- Statusline in editor now supported 'Bases'.

## 0.25.8

18th August, 2025

### New feature

- Insecure chunk detection has been implemented.
    - A notification dialogue will be shown if any insecure chunks are detected; these may have been created by v0.25.6 due to its issue. If this dialogue appears, please ensure you rebuild the database after backing it up.

### Fixed

- Unexpected `Failed to obtain PBKDF2 salt` or similar errors during bucket-synchronisation no longer occur.
- Unexpected long delays for chunk-missing documents when using bucket-synchronisation have been resolved.
- Fetched remote chunks are now properly stored in the local database if `Fetch chunks on demand` is enabled.
- The 'fetch' dialogue's message has been refined.
- No longer overwriting any corrupted documents to the storage on boot-sequence.

### Refactored

- Type errors have been corrected.

## 0.25.7

15th August, 2025

**Since the release of 0.25.6, there are two large problem. Please update immediately.**

- We may have corrupted some documents during the migration process. **Please check your documents on the wizard.**
- Due to a chunk ID assignment issue, some data has not been encrypted. **Please rebuild the database using Rebuild Everything** if you have enabled E2EE.

**_So, If you have enabled E2EE, please perform `Rebuild everything`. If not, please check your documents on the wizard._**

In next version, insecure chunk detection will be implemented.

### Fixed

- Off-loaded chunking have been fixed to ensure proper functionality (#693).
- Chunk document ID assignment has been fixed.
- Replication prevention message during version up detection has been improved (#686).
- `Keep A` and `Keep B` on Conflict resolving dialogue has been renamed to `Use Base` and `Use Conflicted` (#691).

### Improved

- Metadata and content-size unmatched documents are now detected and reported, prevented to be applied to the storage.
    - This behaviour can be configured in `Patch` -> `Edge case addressing (Behaviour)` -> `Process files even if seems to be corrupted`
    - Note: this toggle is for the direct-database-manipulation users.

### New Features

- `Scan for Broken files` has been implemented on `Hatch` -> `TroubleShooting`.

### Refactored

- Off-loaded processes have been refactored for the better maintainability.
    - Files prefixed `bg.worker` are now work on the worker threads.
    - Files prefixed `bgWorker.` are now also controls these worker threads. (I know what you want to say... I will rename them).
- Removed unused code.

## 0.25.0

19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

After reading Issue #668, I conducted another self-review of the E2EE-related code. In retrospect, it was clearly written by someone inexperienced, which is understandable, but it is still rather embarrassing. Three years is certainly enough time for growth.

I have now rewritten the E2EE code to be more robust and easier to understand. It is significantly more readable and should be easier to maintain in the future. The performance issue, previously considered a concern, has been addressed by introducing a master key and deriving keys using HKDF. This approach is both fast and robust, and it provides protection against rainbow table attacks. (In addition, this implementation has been [a dedicated package on the npm registry](https://github.com/vrtmrz/octagonal-wheels), and tested in 100% branch-coverage).

As a result, this is the first time in a while that forward compatibility has been broken. We have also taken the opportunity to change all metadata to use encryption rather than obfuscation. Furthermore, the `Dynamic Iteration Count` setting is now redundant and has been moved to the `Patches` pane in the settings. Thanks to Rabin-Karp, the eden setting is also no longer necessary and has been relocated accordingly. Therefore, v0.25.0 represents a legitimate and correct evolution.

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
