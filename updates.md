# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## 0.25.43-patched-6

18th February, 2026

Let me confess that I have lied about `now all ambiguous properties`... I have found some more implicit calling.

Note: I have not checked hidden file sync and customisation sync, yet. Please report if you find any unexpected behaviour on these features.

### Fixed

- Now ReplicatorService responds to database reset and database initialisation events to dispose the active replicator.
    - Fixes some unlocking issues during rebuilding.

### Refactored

- Now `StorageEventManagerBase` is separated from `StorageEventManagerObsidian` following their concerns.
    - No longer using `ObsidianFileAccess` indirectly during checking duplicated-file events.
    - Last event memorisation is now moved into the StorageAccessManager, just like the file processing interlocking.
    - These methods, i.e., `ObsidianFileAccess.touch`. `StorageEventManager.recentlyTouched`, and `StorageEventManager.touch` are still available, but simply call the StorageAccessManager's methods.
- Now `FileAccessBase` is separated from `FileAccessObsidian` following their concerns.

## 0.25.43-patched-5

17th February, 2026

Yes, we mostly have got refactored!

### Refactored

- Following properties of `ObsidianLiveSyncPlugin` are now initialised more explicitly:

    - property : what is responsible
    - `storageAccess` : `ServiceFileAccessObsidian`
    - `databaseFileAccess` : `ServiceDatabaseFileAccess`
    - `fileHandler` : `ServiceFileHandler`
    - `rebuilder` : `ServiceRebuilder`
    - Not so long from now, ServiceFileAccessObsidian might be abstracted to a more general FileAccessService, and make more testable and maintainable.
    - These properties are initialised in `initialiseServiceModules` on `ObsidianLiveSyncPlugin`.
    - They are `ServiceModule`s.
        - Which means they do not use dynamic binding themselves, but they use bound services.
    - ServiceModules are in src/lib/src/serviceModules for common implementations, and src/serviceModules for Obsidian-specific implementations.
    - Hence, now all ambiguous properties of `ObsidianLiveSyncPlugin` are initialised explicitly. We can proceed to testing.
        - Well, I will release v0.25.44 after testing this.

- Conflict service is now responsible for `resolveAllConflictedFilesByNewerOnes` function, which has been in the rebuilder.
- New functions `updateSettings`, and `applyPartial` have been added to the setting service. We should use these functions instead of directly writing the settings on `ObsidianLiveSyncPlugin.setting`.
- Some interfaces for services have been moved to src/lib/src/interfaces.
- `RemoteService.tryResetDatabase` and `tryCreateDatabase` are now moved to the replicator service.
    - You know that these functions are surely performed by the replicator.
    - Probably, most of the functions in `RemoteService` should be moved to the replicator service, but for now, these two functions are moved as they are the most related ones, to rewrite the rebuilder service.
- Common functions are gradually moved to the common library.
- Now, binding functions on modules have been delayed until the services and service modules are initialised, to avoid fragile behaviour.

## 0.25.43-patched-4

16th February, 2026

I have been working on it little by little in my spare time. Sorry for the delayed response for issues! ! However, thanks for your patience, we seems the `revert to 0.25.43` is not necessary, and I will keep going with this version.

### Refactored

- No longer `DatabaseService` is an injectable service. It is now actually a service which has its own handlers. No dynamic binding for necessary functions.
- Now the following properties of `ObsidianLiveSyncPlugin` belong to each service:
    - `replicator` : `services.replicator` (still we can access `ObsidianLiveSyncPlugin.replicator` for the active replicator)
- A Handy class `UnresolvedErrorManager` has been added, which is responsible for managing unresolved errors and their handlers (we will see `unresolved errors` on a red-background-banner in the editor when they occur).
    - This manager can be used to handle unresolved errors in a unified way, and it can also be used to display notifications or something when unresolved errors occur.

## 0.25.43-patched-3

16th February, 2026

### Refactored

- Now following properties of `ObsidianLiveSyncPlugin` belong to each service:
    - property : service (still we can access these properties from `ObsidianLiveSyncPlugin` for better usability, but probably we should access these from services to clarify the dependencies)
    - `localDatabase` : `services.database`
    - `managers` : `services.database`
    - `simpleStore` : `services.keyValueDB`
    - `kvDB`: `services.keyValueDB`
- Initialising modules, addOns, and services are now explicitly separated in the `_startUp` function of the main plug-in class.
- LiveSyncLocalDB now depends more explicitly on specified services, not the whole `ServiceHub`.
- New service `keyValueDB` has been added. This had been separated from the `database` service.
- Non-trivial modules, such as `ModuleExtraSyncObsidian` (which only holds deviceAndVaultName), are simply implemented in the service.
- Add `logUtils` for unifying logging method injection and formatting. This utility is able to accept the API service for log writing.
- `ModuleKeyValueDB` has been removed, and its functionality is now implemented in the `keyValueDB` service.
- `ModulePouchDB` and `ModuleLocalDatabaseObsidian` have been removed, and their functionality is now implemented in the `database` service.
    - Please be aware that you have overridden createPouchDBInstance or something by dynamic binding; you should now override the createPouchDBInstance in the database service instead of using the module.
    - You can refer to the `DirectFileManipulatorV2` for an example of how to override the createPouchDBInstance function in the database service.

## 0.25.43-patched-2

14th February, 2026

### Fixed

- Application LifeCycle has now started in Main, not ServiceHub.
    - Indeed, ServiceHub cannot be known other things in main have got ready, so it is quite natural to start the lifecycle in main.

## 0.25.43-patched-1

13th February, 2026

**NOTE: Hidden File Sync and Customisation Sync may not work in this version.**

Just a heads-up: this is a patch version, which is essentially a beta release. Do not worry about the following memos, as they are indeed freaking us out. I trust that you have thought this was too large; you're right.

If this cannot be stable, I will revert to 0.24.43 and try again.

### Refactored

- Now resolving unexpected and inexplicable dependency order issues...
- The function which is able to implement to the service is now moved to each service.
    - AppLifecycleService.performRestart
- VaultService.isTargetFile is now using multiple checkers instead of a single function.
    - This change allows better separation of concerns and easier extension in the future.
- Application LifeCycle has now started in ServiceHub, not ObsidianMenuModule.

    - It was in a QUITE unexpected place..., isn't it?
    - Instead of, we should call `await this.services.appLifecycle.onReady()` in other platforms.
    - As in the browser platform, it will be called at `DOMContentLoaded` event.

- ModuleTargetFilter, which is responsible for parsing ignore files, has been refined.
    - This should be separated to a TargetFilter and an IgnoreFileFilter for better maintainability.
- Using `API.addCommand` or some Obsidian API and shimmer APIs, Many modules have been refactored to be derived to AbstractModule from AbstractObsidianModule, to clarify the dependencies. (we should make `app` usage clearer...)
- Fixed initialising `storageAccess` too late in `FileAccessObsidian` module (I am still wondering why it worked before...).
- Remove some redundant overrides in modules.

### Planned

- Some services have an ambiguous name, such as `Injectable`. These will be renamed in the future for better clarity.
- Following properties of `ObsidianLiveSyncPlugin` should be initialised more explicitly:
    - property : where it is initialised currently
    - `localDatabase` : `ModuleLocalDatabaseObsidian`
    - `managers` : `ModuleLocalDatabaseObsidian`
    - `replicator` : `ModuleReplicator`
    - `simpleStore` : `ModuleKeyValueDB`
    - `storageAccess` : `ModuleFileAccessObsidian`
    - `databaseFileAccess` : `ModuleDatabaseFileAccess`
    - `fileHandler` : `ModuleFileHandler`
    - `rebuilder` : `ModuleRebuilder`
    - `kvDB`: `ModuleKeyValueDB`
    - And I think that having a feature in modules directly is not good for maintainability, these should be separated to some module (loader) and implementation (not only service, but also independent something).
- Plug-in statuses such as requestCount, responseCount... should be moved to a status service or somewhere for better separation of concerns.

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

## 0.25.33

05th December, 2025

### New feature

- We can analyse the local database with the `Analyse database usage` command.
    - This command makes a TSV-style report of the database usage, which can be pasted into spreadsheet applications.
        - The report contains the number of unique chunks and shared chunks for each document revision.
            - Unique chunks indicate the actual consumption.
            - Shared chunks indicate the reference counts from other chunks with no consumption.
        - We can find which notes or files are using large amounts of storage in the database. Or which notes cannot share chunks effectively.
        - This command is useful when optimising the database size or investigating an unexpectedly large database size.
- We can reset the notification threshold and check the remote usage at once with the `Reset notification threshold and check the remote database usage` command.
- Commands are available from the Command Palette, or `Hatch` pane in the settings dialogue.

### Fixed

- Now the plug-in resets the remote size notification threshold after rebuild.

## 0.25.32

02nd December, 2025

Now I am back from a short (?) break! Thank you all for your patience. (It is nothing major, but the first half of the year has finally come to an end).
Anyway, I will release the things a bit by bit. I think that we need a rehabilitation or getting gears in again.

### Improved

- Now the plugin warns when we are in several file-related situations that may cause unexpected behaviour (#300).
    - These errors are displayed alongside issues such as file size exceeding limits.
    - Such situations include:
        - When the document has a name which is not supported by some file systems.
        - When the vault has the same file names with different letter cases.

## 0.25.31

18th November, 2025

### Fixed

- Now fetching configuration from the server can handle the empty remote correctly (reported on #756).
- No longer asking to switch adapters during rebuilding.

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
