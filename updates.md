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

## ~~0.25.5~~ 0.25.6

(0.25.5 has been withdrawn due to a bug in the `Fetch chunks on demand` feature).

9th August, 2025

### Fixed

- Storage scanning no longer occurs when `Suspend file watching` is enabled (including boot-sequence).
    - This change improves safety when troubleshooting or fetching the remote database.
- `Fetch chunks on demand` is now working again (if you installed 0.25.5, other versions are not affected).

### Improved

- Saving notes and files now consumes less memory.
    - Data is no longer fully buffered in memory and written at once; instead, it is now written in each over-2MB increments.
- Chunk caching is now more efficient.
    - Chunks are now managed solely by their count (still maintained as LRU). If memory usage becomes excessive, they will be automatically released by the system-runtime.
    - Reverse-indexing is also no longer used. It is performed as scanning caches and act also as a WeakRef thinning.
- Both of them (may) are effective for #692, #680, and some more.

### Changed

- `Incubate Chunks in Document` (also known as `Eden`) is now fully sunset.
    - Existing chunks can still be read, but new ones will no longer be created.
- The `Compute revisions for chunks` setting has also been removed.
    - This feature is now always enabled and is no longer configurable (restoring the original behaviour).
- As mentioned, `Memory cache size (by total characters)` has been removed.
    - The `Memory cache size (by total items)` setting is now the only option available (but it has 10x ratio compared to the previous version).

### Refactored

- A significant refactoring of the core codebase is underway.
    - This is part of our ongoing efforts to improve code maintainability, readability, and to unify interfaces.
        - Previously, complex files posed a risk due to a low bus factor. Fortunately, as our devices have become faster and more capable, we can now write code that is clearer and more maintainable (And not so much costs on performance).
    - Hashing functions have been refactored into the `HashManager` class and its derived classes.
    - Chunk splitting functions have been refactored into the `ContentSplitterCore` class and its derived classes.
    - Change tracking functions have been refactored into the `ChangeManager` class.
    - Chunk read/write functions have been refactored into the `ChunkManager` class.
    - Fetching chunks on demand is now handled separately from the `ChunkManager` and chunk reading functions. Chunks are queued by the `ChunkManager` and then processed by the `ChunkFetcher`, simplifying the process and reducing unnecessary complexity.
    - Then, local database access via `LiveSyncLocalDB` has been refactored to use the new classes.
- References to external sources from `commonlib` have been corrected.
- Type definitions in `types.ts` have been refined.
- Unit tests are being added incrementally.
    - I am using `Deno` for testing, to simplify testing and coverage reporting.
    - While this is not identical to the Obsidian environment, `jest` may also have limitations. It is certainly better than having no tests.
        - In other words, recent manual scenario testing has highlighted some shortcomings.
    - `pouchdb-test`, used for testing PouchDB with Deno, has been added, utilising the `memory` adapter.

Side note: Although class-oriented programming is sometimes considered an outdated style, However, I have come to re-evaluate it as valuable from the perspectives of maintainability and readability.

## 0.25.4

29th July, 2025

### Fixed

- The PBKDF2Salt is no longer corrupted when attempting replication while the device is offline. (#686)
    - If this issue has already occurred, please use `Maintenance` -> `Rebuilding Operations (Remote Only)` -> `Overwrite Remote` and `Send` to resolve it.
    - Please perform this operation on the device that is most reliable.
    - I am so sorry for the inconvenience; there are no patching workarounds. The rebuilding operation is the only solution.
        - This issue only affects the encryption of the remote database and does not impact the local databases on any devices.
        - (Preventing synchronisation is by design and expected behaviour, even if it is sometimes inconvenient. This is also why we should avoid using workarounds; it is, admittedly, an excuse).
        - In any case, we can unlock the remote from the warning dialogue on receiving devices. We are performing replication, instead of simple synchronisation at the expense of a little complexity (I would love to express thank you again for your every effort to manage and maintain the settings! Your all understanding saves our notes).
    - This process may require considerable time and bandwidth (as usual), so please wait patiently and ensure a stable network connection.

### Side note

The PBKDF2Salt will be referred to as the `Security Seed`, and it is used to derive the encryption key for replication. Therefore, it should be stored on the server prior to synchronisation. We apologise for the lack of explanation in previous updates!

## 0.25.3

22nd July, 2025

### Fixed

- Now the `Doctor` at migration will save the configuration.

## 0.25.2 ~~0.25.1~~

(0.25.1 was missed due to a mistake in the versioning process).
19th July, 2025

### Refined and New Features

- Fetching the remote database on `RedFlag` now also retrieves remote configurations optionally.
    - This is beneficial if we have already set up another device and wish to use the same configuration. We will see a much less frequent `Unmatched` dialogue.
- The setup wizard using Set-up URI and QR code has been improved.
    - The message is now more user-friendly.
    - The obsolete method (manual setting application) has been removed.
    - The `Cancel` button has been added to the setup wizard.
    - We can now fetch the remote configuration from the server if it exists, which is useful for adding new devices.
        - Mostly same as a `RedFlag` fetching remote configuration.
    - We can also use the `Doctor` to check and fix the imported (and fetched) configuration before applying it.

### Changes

- The Set-up URI is now encrypted with a new encryption algorithm (mostly the same as `V2`).
    - The new Set-up URI is not compatible with version 0.24.x or earlier.

## 0.25.0

19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

After reading Issue #668, I conducted another self-review of the E2EE-related code. In retrospect, it was clearly written by someone inexperienced, which is understandable, but it is still rather embarrassing. Three years is certainly enough time for growth.

I have now rewritten the E2EE code to be more robust and easier to understand. It is significantly more readable and should be easier to maintain in the future. The performance issue, previously considered a concern, has been addressed by introducing a master key and deriving keys using HKDF. This approach is both fast and robust, and it provides protection against rainbow table attacks. (In addition, this implementation has been [a dedicated package on the npm registry](https://github.com/vrtmrz/octagonal-wheels), and tested in 100% branch-coverage).

As a result, this is the first time in a while that forward compatibility has been broken. We have also taken the opportunity to change all metadata to use encryption rather than obfuscation. Furthermore, the `Dynamic Iteration Count` setting is now redundant and has been moved to the `Patches` pane in the settings. Thanks to Rabin-Karp, the eden setting is also no longer necessary and has been relocated accordingly. Therefore, v0.25.0 represents a legitimate and correct evolution.

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
