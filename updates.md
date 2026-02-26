# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## -- in progress --

### Refactored
- `ModuleCheckRemoteSize` has been ported to a serviceFeature, and also tests have been added.
- Some unnecessary things have been removed.

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

## 0.25.37

15th January, 2026

Thank you for your patience until my return!

This release contains minor changes discovered and fixed during test implementation.
There are no changes affecting usage.

### Refactored

- Logging system has been slightly refactored to improve maintainability.
- Some import statements have been unified.

## 0.25.36

25th December, 2025

### Improved

- Now the garbage collector (V3) has been implemented. (Beta)
    - This garbage collector ensures that all devices are synchronised to the latest progress to prevent inconsistencies.
    - In other words, it makes sure that no new conflicts would have arisen.
        - This feature requires additional information (via node information), but it should be more reliable.
        - This feature requires all devices have v0.25.36 or later.
    - After the garbage collector runs, the database size may be reduced (Compaction will be run automatically after GC).
        - We should have an administrative privilege on the remote database to run this garbage collector.
- Now the plug-in and device information is stored in the remote database.
    - This information is used for the garbage collector (V3).
    - Some additional features may be added in the future using this information.

## 0.25.35

24th December, 2025

Sorry for a small release! I would like to keep things moving along like this if possible. After all, the holidays seem to be starting soon. I will be doubled by my business until the 27th though, indeed.

### Fixed

- Now the conflict resolution dialogue shows correctly which device only has older APIs (#764).

## 0.25.34

10th December, 2025

### Behaviour change

- The plug-in automatically fetches the missing chunks even if `Fetch chunks on demand` is disabled.
    - This change is to avoid loss of data when receiving a bulk of revisions.
    - This can be prevented by enabling `Use Only Local Chunks` in the settings.
- Storage application now saved during each event and restored on startup.
- Synchronisation result application is also now saved during each event and restored on startup.
    - These may avoid some unexpected loss of data when the editor crashes.

### Fixed

- Now the plug-in waits for the application of pended batch changes before the synchronisation starts.
    - This may avoid some unexpected loss or unexpected conflicts.
      Plug-in sends custom headers correctly when RequestAPI is used.
- No longer causing unexpected chunk creation during `Reset synchronisation on This Device` with bucket sync.

### Refactored

- Synchronisation result application process has been refactored.
- Storage application process has been refactored.
    - Please report if you find any unexpected behaviour after this update. A bit of large refactoring.

Full notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
