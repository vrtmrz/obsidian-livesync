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

### Fixed

- The encryption algorithm now uses HKDF with a master key.
    - This is more robust and faster than the previous implementation.
    - It is now more secure against rainbow table attacks.
    - The previous implementation can still be used via `Patches` -> `End-to-end encryption algorithm` -> `Force V1`.
        - Note that `V1: Legacy` can decrypt V2, but produces V1 output.
- `Fetch everything from the remote` now works correctly.
    - It no longer creates local database entries before synchronisation.
- Extra log messages during QR code decoding have been removed.

### Changed

- The following settings have been moved to the `Patches` pane:
    - `Remote Database Tweak`
        - `Incubate Chunks in Document`
        - `Data Compression`

### Behavioural and API Changes

- `DirectFileManipulatorV2` now requires new settings (as you may already know, E2EEAlgorithm).
- The database version has been increased to `12` from `10`.
    - If an older version is detected, we will be notified and synchronisation will be paused until the update is acknowledged. (It has been a long time since this behaviour was last encountered; we always err on the side of caution, even if it is less convenient.)

### Refactored

- `couchdb_utils.ts` has been separated into several explicitly named files.
- Some missing functions in `bgWorker.mock.ts` have been added.

## 0.24.31

10th July, 2025

### Fixed

- The description of `Enable Developers' Debug Tools.` has been refined.
    - Now performance impact is more clearly stated.
- Automatic conflict checking and resolution has been improved.
    - It now works parallelly for each other file, instead of sequentially. It makes significantly faster on first synchronisation when with local files information.
- Resolving conflicts dialogue will not be shown for the multiple files at once.
    - It will be shown for each file, one by one.

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
