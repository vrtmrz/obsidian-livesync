## 0.25.1
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

## 0.24.30

9th July, 2025

### New Feature

- New chunking algorithm `V3: Fine deduplication` has been added, and will be recommended after updates.
    - The Rabin-Karp algorithm is used for efficient chunking.
    - This will be the default in the new installations.
    - It is more robust and faster than the previous one.
    - We can change it in the `Advanced` pane of the settings.
- New language `ko` (Korean) has been added.
    - Thank you for your contribution, [@ellixspace](https://x.com/ellixspace)!
        - Any contributions are welcome, from any route. Please let me know if I seem to be unaware of this. It is often the case that I am not really aware of it.
- Chinese (Simplified) translation has been updated.
    - Thank you for your contribution, [@52sanmao](https://github.com/52sanmao)!

### Fixed

- Numeric settings are now never lost the focus during value changing.
- Doctor now redacts more sensitive information on error reports.

### Improved

- All translations have been rewritten into YAML format, to easier to manage and contribute.
    - We can write them with comments, newlines, and other YAML features.
- Doctor recommendations are now shown in a user-friendly notation.
    - We can now see the recommended as `V3: Fine deduplication` instead of `v3-rabin-karp`.

### Refactored

- Never-ending `ObsidianLiveSyncSettingTab.ts` has finally been separated into each pane's file.
- Some commented-out code has been removed.

### Acknowledgement

- Jun Murakami, Shun Ishiguro, and Yoshihiro Oyama. 2012. Implementation and Evaluation of a Cache Deduplication Mechanism with Content-Defined Chunking. In _IPSJ SIG Technical Report_, Vol.2012-ARC-202, No.4. Information Processing Society of Japan, 1-7.

## 0.24.29

20th June, 2025

### Fixed

- Synchronisation with buckets now works correctly, regardless of whether a prefix is set or the bucket has been (re-) initialised (#664).
- An information message is now displayed again, during any automatic synchronisation is enabled (#662).

### Tidied up

- Importing paths have been tidied up.

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
