# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## 0.25.54

18th March, 2026

### Fixed

- Remote storage size check now works correctly again (#818).
- Some buttons on the settings dialogue now respond correctly again (#827).

### Refactored

- P2P replicator has been refactored to be a little more robust and easier to understand.
- Delete items which are no longer used that might cause potential problems

### CLI

- Fixed the corrupted display of the help message.
- Remove some unnecessary code.

### WebApp

- Fixed the issue where the detail level was not being applied in the log pane.
- Pop-ups are now shown.
- Add coverage for the test.
- Pop-ups are now shown in the web app as well.

## 0.25.53

17th March, 2026

I did wonder whether I should have released a minor version update, but when I actually tested it, compatibility seemed to be intact, so I didn’t. Hmm.

### Fixed

#### P2P Synchronisation

- Fixed flaky timing issues in P2P synchronisation.
- No longer unexpected `Unhandled Rejections` during P2P operations (waiting for acceptance).

#### Journal Sync

- Fixed an issue where some conflicts cannot be resolved in Journal Sync.
- Many minor fixes have been made for better stability and reliability.

### Tests

- Rewrite P2P end-to-end tests to use the CLI as a host.

### CLI

We have previously developed FileSystem LiveSync and various other components in a separate repository, but updates have been significantly delayed, and we have been plagued by compatibility issues. Now, a CLI tool using the same core logic is emerging. This does not directly manipulate the file system, but it offers a more convenient way of working and can also communicate with Object Storage. We can also resolve conflicts. Please refer to the code in `src/apps/cli` for the [self-hosted-livesync-cli](./src/apps/cli/README.md) for more details.
- Add `self-hosted-livesync-cli` to `src/apps/cli` as a headless and dedicated version.
- P2P sync and Object Storage are also supported in the CLI.
  - Yes, we have finally managed to 'get one file'.
  - Also, no more need for a [LiveSync PeerServer](https://github.com/vrtmrz/livesync-serverpeer) for virtual environments! The CLI can do it.

- Now binary files are also supported in the CLI.

### Refactored or internal changes

- ServiceFileAccessBase now correctly handles the reading of binary files.
- HeadlessAPIService now correctly provides the online status (always online) to the plug-in.
- Non-worker version of bgWorker now correctly handles some functions.
- Separated `ObsidianLiveSyncPlugin` into `ObsidianLiveSyncPlugin` and `LiveSyncBaseCore`.
- Now `LiveSyncCore` indicates the type specified version of `LiveSyncBaseCore`.
- Referencing `plugin.xxx` has been rewritten to referencing the corresponding service or `core.xxx`.
- Offline change scanner and the local database preparation have been separated.
- Set default priority for processFileEvent and processSynchroniseResult for the place to add hooks.
- ControlService now provides the readiness for processing operations.
- DatabaseService is now able to modify database opening options on derived classes.
- Now `useOfflineScanner`, `useCheckRemoteSize`, and `useRedFlagFeatures` are set from `main.ts`, instead of `LiveSyncBaseCore`.
- Storage Access APIs are now yielding Promises. This is to allow more limited storage platforms to be supported.
- Journal Replicator now yields true after the replication is done.

### R&D

- Browser-version of Self-hosted LiveSync is now in development. This is not intended for public use now, but I will eventually make it available for testing.
- We can see the code in `src/apps/webapp` for the browser version.

## 0.25.52

9th March, 2026

Excuses: Too much `I`.
Whilst I had a fever, I could not figure it out at all, but once I felt better, I spotted the problem in about thirty seconds. I apologise for causing you concern. I am grateful for your patience.
I would like to devise a mechanism for running simple test scenarios. Now that we have got the Obsidian CLI up and running, it seems the perfect opportunity.

To improve the bus factor, we really need to organise the source code more thoroughly. Your cooperation and contributions would be greatly appreciated.

### Fixed

- No longer unexpected deletion-propagation occurs when the parent directory is not empty (#813).

### Revert reversions

- Reverted the reversion of ModuleCheckRemoteSize. Now it is back to the service feature.

## 0.25.51

7th March, 2026

### Reverted

- Reverted to ModuleRedFlag and ModuleInitializerFile to the previous version because of some unexpected issues. (#813)
    - I will re-implement them in the future with better design and tests.

## 0.25.50

3rd March, 2026

Note: 0.25.49 has been skipped because of too verbose logging (credentials are logged in verbose level, but I realised that could lead to unexpected exposure on issue reporting). Please bump to 0.25.50 to get the fix if you are on 0.25.49. (No expected behaviour changes except the logging).

### Fixed

- No longer deleted files are not clickable in the Global History pane.
- Diff view now uses more specific classes (#803).
- A message of configuration mismatching slightly added for better understanding.
    - Now it says `When replication is initiated manually via the command palette or ribbon, a dialogue box will open to address this.` to make it clear that the user can fix the issue by themselves.

### Refactored

- `ModuleRedFlag` has been refactored to `serviceFeatures/redFlag` and also tested.
- `ModuleInitializerFile` has been refactored to `lib/serviceFeatures/offlineScanner` and also tested.

## 0.25.48

2nd March, 2026

No behavioural changes except unidentified faults. Please report if you find any unexpected behaviour after this update.

### Refactored

- Many storage-related functions have been refactored for better maintainability and testability.
    - Now all platform-specific logics are supplied as adapters, and the core logic has become platform-agnostic.
    - Quite a number of tests have been added for the core logic, and the platform-specific logics are also tested with mocked adapters.

## 0.25.47

27th February, 2026

Phew, the financial year is still not over yet, but I have got some time to work on the plug-in again!

### Fixed and refactored

- Fixed the inexplicable behaviour when retrieving chunks from the network.
    - The chunk manager has been layered to be responsible for its own areas and duties. e.g., `DatabaseWriteLayer`, `DatabaseReadLayer`, `NetworkLayer`, `CacheLayer`, and `ArrivalWaitLayer`.
        - All layers have been tested now!
        - `LayeredChunkManager` has been implemented to manage these layers. Also tested.
    - `EntryManager` has been mostly rewritten and also tested.

- Now we can configure `Never warn` for remote storage size notification again.

### Tests

- The following test has been added:
    - `ConflictManager`.

## 0.25.46

26th February, 2026

### Fixed

- Unexpected errors no longer occurred when the plug-in was unloaded.
- Hidden File Sync now respects selectors.
- Registering protocol-handlers now works safely without causing unexpected errors.

### Refactored

- `ModuleCheckRemoteSize` has been ported to a serviceFeature, and tests have also been added.
- Some unnecessary things have been removed.
- LiveSyncManagers has now explicit dependencies.
- LiveSyncLocalDB is now responsible for LiveSyncManagers, not accepting the managers as dependencies.
    - This is to avoid circular dependencies and clarify the ownership of the managers.
- ChangeManager has been refactored. This had a potential issue, so something had been fixed, possibly.
- Some tests have been ported from Deno's test runner to Vitest to accumulate coverage.

## 0.25.45

25th February, 2026

As a result of recent refactoring, we are able to write tests more easily now!

### Refactored

- `ModuleTargetFilter`, which was responsible for checking if a file is a target file, has been ported to a serviceFeature.
    - And also tests have been added. The middleware-style-power.
- `ModuleObsidianAPI` has been removed and implemented in `APIService` and `RemoteService`.
- Now `APIService` is responsible for the network-online-status, not `databaseService.managers.networkManager`.

## 0.25.44

24th February, 2026

This release represents a significant architectural overhaul of the plug-in, focusing on modularity, testability, and stability. While many changes are internal, they pave the way for more robust features and easier maintenance.
However, as this update is very substantial, please do feel free to let me know if you encounter any issues.

### Fixed

- Ignore files (e.g., `.ignore`) are now handled efficiently.
- Replication & Database:
    - Replication statistics are now correctly reset after switching replicators.
- Fixed `File already exists` for .md files has been merged (PR #802) So thanks @waspeer for the contribution!

### Improved

- Now we can configure network-error banners as icons, or hide them completely with the new `Network Warning Style` setting in the `General` pane of the settings dialogue. (#770, PR #804)
    - Thanks so much to @A-wry!

### Refactored

#### Architectural Overhaul:

- A major transition from Class-based Modules to a Service/Middleware architecture has begun.
    - Many modules (for example, `ModulePouchDB`, `ModuleLocalDatabaseObsidian`, `ModuleKeyValueDB`) have been removed or integrated into specific Services (`database`, `keyValueDB`, etc.).
    - Reduced reliance on dynamic binding and inverted dependencies; dependencies are now explicit.
    - `ObsidianLiveSyncPlugin` properties (`replicator`, `localDatabase`, `storageAccess`, etc.) have been moved to their respective services for better separation of concerns.
    - In this refactoring, the Service will henceforth, as a rule, cease to use setHandler, that is to say, simple lazy binding.
        - They will be implemented directly in the service.
    - However, not everything will be middlewarised. Modules that maintain state or make decisions based on the results of multiple handlers are permitted.
- Lifecycle:
    - Application LifeCycle now starts in `Main` rather than `ServiceHub` or `ObsidianMenuModule`, ensuring smoother startup coordination.

#### New Services & Utilities:

- Added a `control` service to orchestrate other services (for example, handling stop/start logic during settings realisation).
- Added `UnresolvedErrorManager` to handle and display unresolved errors in a unified way.
- Added `logUtils` to unify logging injection and formatting.
- `VaultService.isTargetFile` now uses multiple, distinct checkers for better extensibility.

#### Code Separation:

- Separated Obsidian-specific logic from base logic for `StorageEventManager` and `FileAccess` modules.
- Moved reactive state values and statistics from the main plug-in instance to the services responsible for them.

#### Internal Cleanups:

- Many functions have been renamed for clarity (for example, `_isTargetFileByLocalDB` is now `_isTargetAcceptedByLocalDB`).
- Added `override` keywords to overridden items and removed dynamic binding for clearer code inheritance.
- Moved common functions to the common library.

#### Dependencies:

- Bumped dependencies simply to a point where they can be considered problem-free (by human-powered-artefacts-diff).
    - Svelte, terser, and more something will be bumped later. They have a significant impact on the diff and paint it totally.
    - You may be surprised, but when I bump the library, I am actually checking for any unintended code.

## 0.25.43

5th, February, 2026

### Fixed

- Encryption/decryption issues when using Object Storage as remote have been fixed.
    - Now the plug-in falls back to V1 encryption/decryption when V2 fails (if not configured as ForceV1).
    - This may fix the issue reported in #772.

### Notice

Quite a few packages have been updated in this release. Please report if you find any unexpected behaviour after this update.

## 0.25.42

2nd, February, 2026

This release is identical to 0.25.41-patched-3, except for the version number.

### Refactored

- Now the service context is `protected` instead of `private` in `ServiceBase`.
    - This change allows derived classes to access the context directly.
- Some dynamically bound services have been moved to services for better dependency management.
- `WebPeer` has been moved to the main repository from the sub repository `livesync-commonlib` for correct dependency management.
- Migrated from the outdated, unstable platform abstraction layer to services.
    - A bit more services will be added in the future for better maintainability.

Full notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
