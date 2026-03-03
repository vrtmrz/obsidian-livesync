# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## 0.25.49

3rd March, 2026

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

## 0.25.41

24th January, 2026

### Fixed

- No longer `No available splitter for settings!!` errors occur after fetching old remote settings while rebuilding local database. (#748)

### Improved

- Boot sequence warning is now kept in the in-editor notification area.

### New feature

- We can now set the maximum modified time for reflect events in the settings. (for #754)
    - This setting can be configured from `Patches` -> `Remediation` in the settings dialogue.
    - Enabling this setting will restrict the propagation from the database to storage to only those changes made before the specified date and time.
    - This feature is primarily intended for recovery purposes. After placing `redflag.md` in an empty vault and importing the Self-hosted LiveSync configuration, please perform this configuration, and then fetch the local database from the remote.
    - This feature is useful when we want to prevent recent unwanted changes from being reflected in the local storage.

### Refactored

- Module to service refactoring has been started for better maintainability:
    - UI module has been moved to UI service.

### Behaviour change

- Default chunk splitter version has been changed to `Rabin-Karp` for new installations.

## 0.25.40

23rd January, 2026

### Fixed

- Fixed an issue where some events were not triggered correctly after the refactoring in 0.25.39.

## 0.25.39

23rd January, 2026

Also no behaviour changes or fixes in this release. Just refactoring for better maintainability. Thank you for your patience! I will address some of the reported issues soon.
However, this is not a minor refactoring, so please be careful. Let me know if you find any unexpected behaviour after this update.

### Refactored

- Rewrite the service's binding/handler assignment systems
- Removed loopholes that allowed traversal between services to clarify dependencies.
- Consolidated the hidden state-related state, the handler, and the addition of bindings to the handler into a single object.
    - Currently, functions that can have handlers added implement either addHandler or setHandler directly on the function itself.
      I understand there are differing opinions on this, but for now, this is how it stands.
- Services now possess a Context. Please ensure each platform has a class that inherits from ServiceContext.
- To permit services to be dynamically bound, the services themselves are now defined by interfaces.

## 0.25.38

17th January, 2026

### Fixed

- Fixed an issue where indexedDB would not close correctly on some environments, causing unexpected errors during database operations.

Full notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
