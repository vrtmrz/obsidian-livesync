# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## 0.25.41

24th January, 2026

### Fixed

- No longer `No available splitter for settings!!` errors occur after fetching old remote settings while rebuilding local database. (#748)

### Improved

- Boot sequence warning is now kept in the in-editor notification area.

### New feature

- We can now set the maximum modified time for reflect events in the settings. (for #754)
    - This setting can be configured from  `Patches` -> `Remediation` in the settings dialogue.
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
