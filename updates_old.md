# 0.25

Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

After reading Issue #668, I conducted another self-review of the E2EE-related code. In retrospect, it was clearly written by someone inexperienced, which is understandable, but it is still rather embarrassing. Three years is certainly enough time for growth.

I have now rewritten the E2EE code to be more robust and easier to understand. It is significantly more readable and should be easier to maintain in the future. The performance issue, previously considered a concern, has been addressed by introducing a master key and deriving keys using HKDF. This approach is both fast and robust, and it provides protection against rainbow table attacks. (In addition, this implementation has been [a dedicated package on the npm registry](https://github.com/vrtmrz/octagonal-wheels), and tested in 100% branch-coverage).

As a result, this is the first time in a while that forward compatibility has been broken. We have also taken the opportunity to change all metadata to use encryption rather than obfuscation. Furthermore, the `Dynamic Iteration Count` setting is now redundant and has been moved to the `Patches` pane in the settings. Thanks to Rabin-Karp, the eden setting is also no longer necessary and has been relocated accordingly. Therefore, v0.25.0 represents a legitimate and correct evolution.

---
## 0.25.30

17th November, 2025

So sorry for the quick follow-up release, due to a humble mistake in a quick causing a matter.

### Fixed

- Now we can save settings correctly again (#756).

## ~~0.25.28~~ 0.25.29

(0.25.28 was skipped due to a packaging issue.)

17th November, 2025

### New feature

- We can now configure hidden file synchronisation to always overwrite with the latest version (#579).

### Fixed

- Timing dependency issues during initialisation have been mitigated (#714)

### Improved

- Error logs now contain stack-traces for better inspection.

## 0.25.27

12th November, 2025

### Improved

- Now we can switch the database adapter between IndexedDB and IDB without rebuilding (#747).
    - Just a local migration will be required, but faster than a full rebuild.
- No longer checking for the adapter by `Doctor`.

### Changes

- The default adapter is reverted to IDB to avoid memory leaks (#747).

### Fixed (?)

- Reverted QR code library to v1.4.4 (To make sure #752).

## 0.25.26

07th November, 2025

### Improved

- Some JWT notes have been added to the setting dialogue (#742).

### Fixed

- No longer wrong values encoded into the QR code.
- We can acknowledge why the QR codes have not been generated.
    - Probably too large a dataset to encode. When this happens, please consider using Setup-URI via text instead of QR code, or reduce the settings temporarily.

### Refactored

- Some dependencies have been updated.
- Internal functions have been modularised into `octagonal-wheels` packages and are well tested.
    - `dataobject/Computed` for caching computed values.
    - `encodeAnyArray/decodeAnyArray` for encoding and decoding any array-like data into compact strings (#729).
- Fixed importing from the parent project in library codes. (#729).

## 0.25.25

06th November, 2025

### Fixed

#### JWT Authentication

- Now we can use JWT Authentication ES512 correctly (#742).
- Several misdirections in the Setting dialogues have been fixed (i.e., seconds and minutes confusion...).
- The key area in the Setting dialogue has been enlarged and accepts newlines correctly.
- Caching of JWT tokens now works correctly
    - Tokens are now cached and reused until they expire.
    - They will be kept until 10% of the expiration duration is remaining or 10 seconds, whichever is longer (but at a maximum of 1 minute).
- JWT settings are now correctly displayed on the Setting dialogue.

And, tips about JWT Authentication on CouchDB have been added to the documentation (docs/tips/jwt-on-couchdb.md).

#### Other fixes

- Receiving non-latest revisions no longer causes unexpected overwrites.
    - On receiving revisions that made conflicting changes, we are still able to handle them.

### Improved

- No longer duplicated message notifications are shown when a connection to the remote server fails.
    - Instead, a single notification is shown, and it will be kept on the notification area inside the editor until the situation is resolved.
- The notification area is no longer imposing, distracting, and overwhelming.
    - With a pale background, but bordered and with icons.

## 0.25.24

04th November, 2025

(Beta release notes have been consolidated to this note).

### Guidance and UI improvements!

Since several issues were pointed out, our setup procedure had been quite `system-oriented`. This is not good for users. Therefore, I have changed the procedure to be more `goal-oriented`. I have made extensive use of Svelte, resulting in a very straightforward setup.
While I would like to accelerate documentation and i18n adoption, I do not want to confuse everyone who's already working on it. Therefore, I have decided to release a Beta version at this stage. Significant changes are not expected from this point onward, so I will proceed to stabilise the codebase. (However, this is significant).

### TURN server support and important notice

TURN server settings are only necessary if you are behind a strict NAT or firewall that prevents direct P2P
connections. In most cases, you do not need to set up a TURN server.

Using public TURN servers may have privacy implications, as your data will be relayed through third-party
servers. Even if your data are encrypted, your existence may be known to them. Please ensure you trust the TURN
server provider before using their services. Also your `network administrator` too. You should consider setting
up your own TURN server for your FQDN, if possible.

### New features

- We can use the TURN server for P2P connections now.

### Fixed

- P2P Replication got more robust and stable.
    - Update [Trystero](https://github.com/dmotz/trystero) to the official v0.22.0!
    - Fixed a bug that caused P2P connections to drop or (unwanted reconnection to the relay server) unexpectedly in some environments.
    - Now, the connection status is more accurately reported.
    - While in the background, the connection to the signalling server is now disconnected to save resources.
        - When returning to the foreground, it will not reconnect automatically for safety. Please reconnect manually.
- All connection configurations should be edited in each dedicated dialogue now.
- No longer will larger files create chunks during preparing `Reset Synchronisation on This Device`.
- Now hidden file synchronisation respects the filters correctly (#631, #735)
    - And `ignore-files` settings are also respected and surely read during the start-up.

### Behaviour changes

- The setup wizard is now more `goal-oriented`. Brand-new screens are introduced.
- `Fetch everything` and `Rebuild everything` are now `Reset Synchronisation on This Device` and `Overwrite Server Data with This Device's Files`.
- Remote configuration and E2EE settings are now separated into each modal dialogue.
    - Remote configuration is now more straightforward. And if we need the rebuild (No... `Overwrite Server Data with This Device's Files`), it is now clearly indicated.
- Peer-to-Peer settings are also separated into their own modal dialogue (still in progress, and we need to open a P2P pane, still).
- Setup-URI, and Report for the Issue are now not copied to the clipboard automatically. Instead, there are copy-dialogue and buttons to copy them explicitly.
    - This is to avoid confusion for users who do not want to use these features.
- No longer optional features are introduced during the setup, or `Reset Synchronisation on This Device`, `Overwrite Server Data with This Device's Files`.
    - This is to avoid confusion for users who do not want to use these features. Instead, we will be informed that optional features are available after the setup is completed.
- We cannot perform `Fetch everything` and `Rebuild everything` (Removed, so the old name) without restarting Obsidian now.

### Miscellaneous

- Setup QR Code generation is separated into a src/lib/src/API/processSetting.ts file. Please use it as a subrepository if you want to generate QR codes in your own application.
- Setup-URI is also separated into a src/lib/src/API/processSetting.ts
- Some direct access to web APIs is now wrapped into the services layer.

### Dependency updates

- Many dependencies are updated. Please see `package.json`.
    - This is the hardest part of this update. I read most of the changes in the dependencies. If you find any extra information, please let me know.
- As upgrading TypeScript, Fixed many UInt8Array<ArrayBuffer> and Uint8Array type mismatches.
-

### Breaking changes

- Sending configuration via Peer-to-Peer connection is not compatible with older versions.
    - Please upgrade all devices to v0.25.24.beta1 or later to use this feature again.
    - This is due to security improvements in the encryption scheme.

## 0.25.23

26th October, 2025

The next version we are preparing (you know that as 0.25.23.beta1) is now still on beta, resulting in this rather unfortunate versioning situation. Apologies for the confusion. The next v0.25.23.beta2 will be v0.25.24.beta1. In other words, this is a v0.25.22.patch-1 actually, but possibly not allowed by Obsidian's rule.
(Perhaps we ought to declare 1.0.0 with a little more confidence. The current minor part has been effectively a major one for a long time. If it were 1.22.1 and 1.23.0.beta1, no confusion ).

### Fixed

- We are now able to enable optional features correctly again (#732).
- No longer oversized files have been processed, furthermore.

    - Before creating a chunk, the file is verified as the target.
    - The behaviour upon receiving replication has been changed as follows:
        - If the remote file is oversized, it is ignored.
        - If not, but while the local file is oversized, it is also ignored.

- We are now able to enable optional features correctly again (#732).
- No longer oversized files have been processed, furthermore.
    - Before creating a chunk, the file is verified as the target.
    - The behaviour upon receiving replication has been changed as follows:
        - If the remote file is oversized, it is ignored.
        - If not, but while the local file is oversized, it is also ignored.

## 0.25.22

15th October, 2025

### Fixed

- Fixed a bug that caused wrong event bindings and flag inversion (#727)
    - This caused following issues:
        - In some cases, settings changes were not applied or saved correctly.
        - Automatic synchronisation did not begin correctly.

### Improved

- Too large diffs are not shown in the file comparison view, due to performance reasons.

### Notes

- The checking algorithm implemented in 0.25.20 is also raised as PR (#237). And completely I merged it manually.
    - Sorry for lacking merging this PR, and let me say thanks to the great contribution, @bioluks !
- Known issues:
    - Sync on Editor save seems not to work correctly in some cases.
        - I am investigating this issue. If you have any information, please let me know.

## 0.25.21

13th October, 2025

This release including 0.25.21.beta1 and 0.25.21.beta2.

Apologies for taking a little time. I was seriously tackling this.
(Of course, being caught up in an unfamiliar structure due to personnel changes on my workplace played a part, but fortunately I have returned to a place where I can do research and development rather than production. Completely beside the point, though).
Now then, this time, moving away from 'convention over configuration', I have changed to a mechanism for manually binding events. This makes it much easier to leverage IDE assistance.
And, also, we are ready to separate `Features` and `APIs` from `Module`. Features are still in the module, but APIs will be moved to a Service layer. This will make it easier to maintain and extend the codebase in the future.

If you have found any issues, please let me know. I am now on the following:

- GitHub [Issues](https://github.com/vrtmrz/obsidian-livesync/issues) Excellent! May the other contributors will help you too.
- Twitter [@vorotamoroz](https://twitter.com/vorotamoroz) Quickest!
- Matrix [@vrtmrz:matrix.org](https://matrix.to/#/@vrtmrz:matrix.org) Also quick, and if you need to keep it private!
  I am creating rooms too, but I'm struggling to figure out how to use them effectively because I cannot tell the difference of use-case between them and discussions. However, if you want to use Discord, this is a answer; We should on E2E encrypted platform.

## 0.25.21.beta2

8th October, 2025

### Fixed

- Fixed wrong event type bindings (which caused some events not to be handled correctly).
- Fixed detected a timing issue in StorageEventManager
    - When multiple events for the same file are fired in quick succession, metadata has been kept older information. This induces unexpected wrong notifications and write prevention.

## 0.25.21.beta1

6th October, 2025

### Refactored

- Event handling now does not rely on 'convention over configuration'.
    - Services.ts now have a proper event handler registration system.

## 0.25.20

26th September, 2025

### Fixed

- Chunk fetching no longer reports errors when the fetched chunk could not be saved (#710).
    - Just using the fetched chunk temporarily.
- Chunk fetching reports errors when the fetched chunk is surely corrupted (#710, #712).
- It no longer detects files that the plug-in has modified.
    - It may reduce unnecessary file comparisons and unexpected file states.

### Improved

- Now checking the remote database configuration respecting the CouchDB version (#714).

## 0.25.19

18th September, 2025

### Improved

- Now encoding/decoding for chunk data and encryption/decryption are performed in native functions (if they were available).
    - This uses Uint8Array.fromBase64 and Uint8Array.toBase64, which are natively available in iOS 18.2+ and Android with Chrome 140+.
        - In Android, WebView is by default updated with Chrome, so it should be available in most cases.
    - Note that this is not available in Desktop yet (due to being based on Electron). We are staying tuned for future updates.
    - This realised by an external(?) package [octagonal-wheels](https://github.com/vrtmrz/octagonal-wheels). Therefore, this update only updates the dependency.

## 0.25.18

17th September, 2025

### Fixed

- Property encryption detection now works correctly (On Self-hosted LiveSync, it was not broken, but as a library, it was not working correctly).
- Initialising the chunk splitter is now surely performed.
- DirectFileManipulator now works fine (as a library)
    - Old `DirectFileManipulatorV1` is now removed.

### Refactored

- Removed some unnecessary intermediate files.

## 0.25.17

16th September, 2025

### Fixed

- No longer information-level logs have produced during toggling `Show only notifications` in the settings (#708).
- Ignoring filters for Hidden file sync now works correctly (#709).

### Refactored

- Removed some unnecessary intermediate files.

## 0.25.16

4th September, 2025

### Improved

- Improved connectivity for P2P connections
- The connection to the signalling server can now be disconnected while in the background or when explicitly disconnected.
    - These features use a patch that has not been incorporated upstream.
    - This patch is available at [vrtmrz/trystero](https://github.com/vrtmrz/trystero).

## 0.25.15

3rd September, 2025

### Improved

- Now we can configure `forcePathStyle` for bucket synchronisation (#707).

## 0.25.14

2nd September, 2025

### Fixed

- Opening IndexedDB handling has been ensured.
- Migration check of corrupted files detection has been fixed.
    - Now informs us about conflicted files as non-recoverable, but noted so.
    - No longer errors on not-found files.

## 0.25.13

1st September, 2025

### Fixed

- Conflict resolving dialogue now properly displays the changeset name instead of A or B (#691).

## 0.25.12

29th August, 2025

### Fixed

- Fixed an issue with automatic synchronisation starting (#702).

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

### Fixed

- Unexpected `Failed to obtain PBKDF2 salt` or similar errors during bucket-synchronisation no longer occur.
- Unexpected long delays for chunk-missing documents when using bucket-synchronisation have been resolved.
- Fetched remote chunks are now properly stored in the local database if `Fetch chunks on demand` is enabled.
- The 'fetch' dialogue's message has been refined.
- No longer overwriting any corrupted documents to the storage on boot-sequence.

### Refactored

- Type errors have been corrected.

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

## 0.24.0

I know that we have been waiting for a long time. It is finally released!

Over the past three years since the inception of the plugin, various features have been implemented to address diverse user needs. This is truly honourable, and I am grateful for your years of support. However, this process has led to an increasingly disorganised codebase, with features becoming entangled. Consequently, this has led to a situation where bugs can go unnoticed and resolving one issue may inadvertently introduce another.

In 0.24.0, I reorganised the previously jumbled main codebase into clearly defined modules. Although I had assumed that the total size of the code would not increase, I discovered that it has in fact increased. While the complexity is still considerable, the refactoring has improved the clarity of the code's structure. Additionally, while testing the release candidates, we still found many bugs to fix, which helped to make this plug-in robust and stable. Therefore, we are now ready to use the updated plug-in, and in addition to that, proceed to the next step.

This is also the first step towards a fully-fledged-fancy LiveSync, not just a plug-in from Obsidian. Of course, it will still be a plug-in primarily and foremost, but this development marks a significant step towards the self-hosting concept.

Finally, I would like to once again express my respect and gratitude to all of you. My gratitude extends to all of the dev testers! Your contributions have certainly made the plug-in robust and stable!

Thank you, and I hope your troubles will be resolved!

---

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

## 0.24.28

15th June, 2025

### Fixed

- Batch Update is no longer available in LiveSync mode to avoid unexpected behaviour. (#653)
- Now compatible with Cloudflare R2 again for bucket synchronisation.
    - @edo-bari-ikutsu, thank you for [your contribution](https://github.com/vrtmrz/livesync-commonlib/pull/12)!
- Prevention of broken behaviour due to database connection failures added (#649).

## 0.24.27

10th June, 2025

### Improved

- We can use prefix for path for the Bucket synchronisation.
    - For example, if you set the `vaultName/` as a prefix for the bucket in the root directory, all data will be transferred to the bucket under the `vaultName/` directory.
- The "Use Request API to avoid `inevitable` CORS problem" option is now promoted to the normal setting, not a niche patch.

### Fixed

- Now switching replicators applied immediately, without the need to restart Obsidian.

### Tidied up

- Some dependencies have been updated to the latest version.

## 0.24.26

14th May, 2025

This update introduces an option to circumvent Cross-Origin Resource Sharing
(CORS) constraints for CouchDB requests, by leveraging Obsidian's native request
API. The implementation of such a feature had previously been deferred due to
significant security considerations.

CORS is a vital security mechanism, enabling servers like CouchDB -- which
functions as a sophisticated REST API -- to control access from different
origins, thereby ensuring secure communication across trust boundaries. I had
long hesitated to offer a CORS circumvention method, as it deviates from
security best practices; My preference was for users to configure CORS correctly
on the server-side.

However, this policy has shifted due to specific reports of intractable
CORS-related configuration issues, particularly within enterprise proxy
environments where proxy servers can unpredictably alter or block
communications. Given that a primary objective of the "Self-hosted LiveSync"
plugin is to facilitate secure Obsidian usage within stringent corporate
settings, addressing these 'unavoidable' user-reported problems became
essential. Mostly raison d'être of this plugin.

Consequently, the option "Use Request API to avoid `inevitable` CORS problem"
has been implemented. Users are strongly advised to enable this _only_ when
operating within a trusted environment. We can enable this option in the `Patch` pane.

However, just to whisper, this is tremendously fast.

### New Features

- Automatic display-language changing according to the Obsidian language
  setting.
    - We will be asked on the migration or first startup.
    - **Note: Please revert to the default language if you report any issues.**
    - Not all messages are translated yet. We welcome your contribution!
- Now we can limit files to be synchronised even in the hidden files.
- "Use Request API to avoid `inevitable` CORS problem" has been implemented.
    - Less secure, please use it only if you are sure that you are in the trusted
      environment and be able to ignore the CORS. No `Web viewer` or similar tools
      are recommended. (To avoid the origin forged attack). If you are able to
      configure the server setting, always that is recommended.
- `Show status icon instead of file warnings banner` has been implemented.
    - If enabled, the ⛔ icon will be shown inside the status instead of the file
      warnings banner. No details will be shown.

### Improved

- All regular expressions can be inverted by prefixing `!!` now.

### Fixed

- No longer unexpected files will be gathered during hidden file sync.
- No longer broken `\n` and new-line characters during the bucket
  synchronisation.
- We can purge the remote bucket again if we using MinIO instead of AWS S3 or
  Cloudflare R2.
- Purging the remote bucket is now more reliable.
    - 100 files are purged at a time.
- Some wrong messages have been fixed.

### Behaviour changed

- Entering into the deeper directories to gather the hidden files is now limited
  by `/` or `\/` prefixed ignore filters. (It means that directories are scanned
  deeper than before).
    - However, inside the these directories, the files are still limited by the
      ignore filters.

### Etcetera

- Some code has been tidied up.
- Trying less warning-suppressing and be more safer-coding.
- Dependent libraries have been updated to the latest version.
- Some build processes have been separated to `pre` and `post` processes.

## 0.24.25

22nd April, 2025

### Improved

- Peer-to-peer synchronisation has been got more robust.

### Fixed

- No longer broken falsy values in settings during set-up by the QR code
  generation.

### Refactored

- Some `window` references now have pointed to `globalThis`.
- Some sloppy-import has been fixed.
- A server side implementation `Synchromesh` has been suffixed with `deno`
  instead of `server` now.

## 0.24.24

15th April, 2025

### Fixed

- No longer broken JSON files including `\n`, during the bucket synchronisation.
  (#623)
- Custom headers and JWT tokens are now correctly sent to the server during
  configuration checking. (#624)

### Improved

- Bucket synchronisation has been enhanced for better performance and
  reliability.
    - Now less duplicated chunks are sent to the server. Note: If you have
      encountered about too less chunks, please let me know. However, you can send
      it to the server by `Overwrite remote`.
    - Fetching conflicted files from the server is now more reliable.
    - Dependent libraries have been updated to the latest version.
        - Also, let me know if you have encountered any issues with this update.
          Especially you are using a device that has been in use for a little
          longer.

## 0.24.23

10th April, 2025

### New Feature

- Now, we can send custom headers to the server.
    - They can be sent to either CouchDB or Object Storage.
- Authentication with JWT in CouchDB is now supported.
    - I will describe steps later, but please refer to the
      [CouchDB document](https://docs.couchdb.org/en/stable/config/auth.html#authentication-configuration).
    - A JWT keypair for testing can be generated in the setting dialogue.

### Improved

- The QR Code for set-up can be shown also from the setting dialogue now.
- Conflict checking for preventing unexpected overwriting on the boot-up process
  has been quite faster.

### Fixed

- Some bugs on Dev and Testing modules have been fixed.

## 0.24.22 ~~0.24.21~~

1st April, 2025

(Really sorry for the confusion. I have got a miss at releasing...).

### Fixed

- No longer conflicted files are handled in the boot-up process. No more
  unexpected overwriting.
    - It ignores `Always overwrite with a newer file`, and always be prevented for
      the safety. Please pick it manually or open the file.
- Some log messages on conflict resolution has been corrected.
- Automatic merge notifications, displayed on the grounds of `same`, have been
  degraded to logs.

### Improved

- Now we can fetch the remote database with keeping local files completely
  intact.
    - In new option, all files are stored into the local database before the
      fetching, and will be merged automatically or detected as conflicts.
- The dialogue presenting options when performing `Fetch` are now more
  informative.

### Refactored

- Some class methods have been fixed its arguments to be more consistent.
- Types have been defined for some conditional results.

## 0.24.20

24th March, 2025

### Improved

- Now we can see the detail of `TypeError` using Obsidian API during remote
  database access.

### Behaviour and default changed

- **NOW INDEED AND ACTUALLY** `Compute revisions for chunks` are backed into
  enabled again. it is necessary for garbage collection of chunks.
    - As far as existing users are concerned, this will not automatically change,
      but the Doctor will inform us.

## 0.24.19

5th March, 2025

### New Feature

- Now we can generate a QR Code for transferring the configuration to another device.
    - This QR Code can be scanned by the camera app or something QR Code Reader of another device, and via Obsidian URL, the configuration will be transferred.
    - Note: This QR Code is not encrypted. So, please be careful when transferring the configuration.

## 0.24.18

28th February, 2025

### Fixed

- Now no chunk creation errors will be raised after switching `Compute revisions for chunks`.
- Some invisible file can be handled correctly (e.g., `writing-goals-history.csv`).
- Fetching configuration from the server is now saves the configuration immediately (if we are not in the wizard).

### Improved

- Mismatched configuration dialogue is now more informative, and rewritten to more user-friendly.
- Applying configuration mismatch is now without rebuilding (at our own risks).
- Now, rebuilding is decided more fine grained.

### Improved internally

- Translations can be nested. i.e., task:`Some procedure`, check: `%{task} checking`, checkfailed: `%{check} failed` produces `Some procedure checking failed`.
    - Max to 10 levels of nesting

## 0.24.17

27th February, 2025

Confession. I got the default values wrong. So scary and sorry.

## 0.24.16

### Improved

#### Peer-to-Peer

- Now peer-to-peer synchronisation checks the settings are compatible with each other.
    - No longer unexpected database broken, phew.
- Peer-to-peer synchronisation now handles the platform and detects pseudo-clients.
    - Pseudo clients will not decrypt/encrypt anything, just relay the data. Hence, always settings are not compatible. Therefore, we have to accept the incompatibility for pseudo clients.

#### General

- New migration method has been implemented, that called `Doctor`.

    - `Doctor` checks the difference between the ideal and actual values and encourages corrective action. To facilitate our decision, the reasons for this and the recommendations are also presented.
    - This can be used not only during migration. We can invoke the doctor from the settings for trouble-shooting.

- The minimum interval for replication to be caused when an event occurs can now be configurable.
- Some detail note has been added and change nuance about the `Report` in the setting dialogue, which had less informative.

### Behaviour and default changed

- `Compute revisions for chunks` are backed into enabled again. it is necessary for garbage collection of chunks.
    - As far as existing users are concerned, this will not automatically change, but the Doctor will inform us.

### Refactored

- Platform specific codes are more separated. No longer `node` modules were used in the browser and Obsidian.

## 0.24.15

### Fixed

- Now, even without WeakRef, Polyfill is used and the whole thing works without error. However, if you can switch WebView Engine, it is recommended to switch to a WebView Engine that supports WeakRef.

## 0.24.14

### Fixed

- Resolving conflicts of JSON files (and sensibly merging them) is now working fine, again!
    - And, failure logs are more informative.
- More robust to release the event listeners on unwatching the local database.

### Refactored

- JSON file conflict resolution dialogue has been rewritten into svelte v5.
- Upgrade eslint.
- Remove unnecessary pragma comments for eslint.

## 0.24.13

Sorry for the lack of replies. The ones that were not good are popping up, so I am just going to go ahead and get this one... However, they realised that refactoring and restructuring is about clarifying the problem. Your patience and understanding is much appreciated.

### Fixed

#### General Replication

- No longer unexpected errors occur when the replication is stopped during for some reason (e.g., network disconnection).

#### Peer-to-Peer Synchronisation

- Set-up process will not receive data from unexpected sources.
- No longer resource leaks while enabling the `broadcasting changes`
- Logs are less verbose.
- Received data is now correctly dispatched to other devices.
- `Timeout` error now more informative.
- No longer timeout error occurs for reporting the progress to other devices.
- Decision dialogues for the same thing are not shown multiply at the same time anymore.
- Disconnection of the peer-to-peer synchronisation is now more robust and less error-prone.

#### Webpeer

- Now we can toggle Peers' configuration.

### Refactored

- Cross-platform compatibility layer has been improved.
- Common events are moved to the common library.
- Displaying replication status of the peer-to-peer synchronisation is separated from the main-log-logic.
- Some file names have been changed to be more consistent.

## 0.24.12

I created a SPA called [webpeer](https://github.com/vrtmrz/livesync-commonlib/tree/main/apps/webpeer) (well, right... I will think of a name again), which replaces the server when using Peer-to-Peer synchronisation. This is a pseudo-client that appears to other devices as if it were one of the clients. . As with the client, it receives and sends data without storing it as a file.
And, this is just a single web page, without any server-side code. It is a static web page that can be hosted on any static web server, such as GitHub Pages, Netlify, or Vercel. All you have to do is to open the page and enter several items, and leave it open.

### Fixed

- No longer unnecessary acknowledgements are sent when starting peer-to-peer synchronisation.

### Refactored

- Platform impedance-matching-layer has been improved.
    - And you can see the actual usage of this on [webpeer](https://github.com/vrtmrz/livesync-commonlib/tree/main/apps/webpeer) that a pseudo client for peer-to-peer synchronisation.
- Some UIs have been got isomorphic among Obsidian and web applications (for `webpeer`).

## 0.24.11

Peer-to-peer synchronisation has been implemented!

Until now, I have not provided a synchronisation server. More people may not
even know that I have shut down the test server. I confess that this is a bit
repetitive, but I confess it is a cautionary tale. This is out of a sense of
self-discipline that someone has occurred who could see your data. Even if the
'someone' is me. I should not be unaware of its superiority, even though
well-meaning and am a servant of all. (Half joking, but also serious). However,
now I can provide you with a signalling server. Because, to the best of my
knowledge, it is only the network that is connected to your device. Also, this
signalling server is just a Nostr relay, not my implementation. You can run your
implementation, which you consider trustworthy, on a trustworthy server. You do
not even have to trust me. Mate, it is great, isn't it? For your information,
strfry is running on my signalling server.

Nevertheless, that being said, to be more honest, I still have not decided what
to do with this signalling server if too much traffic comes in.

Note: Already you have noticed this, but let me mention it again, this is a
significantly large update. If you have noticed anything, please let me know. I
will try to fix it as soon as possible (Some address is on my
[profile](https://github.com/vrtmrz)).

### Improved

- New Translation: `es` (Spanish) by @zeedif (Thank you so much)!
- Now all of messages can be selectable and copyable, also on the iPhone, iPad, and Android devices. Now we can copy or share the messages easily.

### New Feature

- Peer-to-Peer Synchronisation has been implemented!
    - This feature is still in early beta, and it is recommended to use it with caution.
    - However, it is a significant step towards the self-hosting concept. It is now possible to synchronise your data without using any remote database or storage. It is a direct connection between your devices.
    - Note: We should keep the device online to synchronise the data. It is not a background synchronisation. Also it needs a signalling server to establish the connection. But, the signalling server is used only for establishing the connection, and it does not store any data.

### Fixed

- No longer memory or resource leaks when the plug-in is disabled.
- Now deleted chunks are correctly detected on conflict resolution, and we are guided to resurrect them.
- Hanging issue during the initial synchronisation has been fixed.
- Some unnecessary logs have been removed.
- Now all modal dialogues are correctly closed when the plug-in is disabled.

### Refactor

- Several interfaces have been moved to the separated library.
- Translations have been moved to each language file, and during the build, they are merged into one file.
- Non-mobile friendly code has been removed and replaced with the safer code.
    - (Now a days, mostly server-side engine can use webcrypto, so it will be rewritten in the future more).
- Started writing Platform impedance-matching-layer.
- Svelte has been updated to v5.
- Some function have got more robust type definitions.
- Terser optimisation has slightly improved.
- During the build, analysis meta-file of the bundled codes will be generated.

## 0.24.10

### Fixed

- Fixed the issue which the filename is shown as `undefined`.
- Fixed the issue where files transferred at short intervals were not reflected.

### Improved

- Add more translations: `ja-JP` (Japanese) by @kohki-shikata (Thank you so much)!

### Internal

- Some files have been prettified.

## 0.24.9

Skipped.

## 0.24.8

### Fixed

- Some parallel-processing tasks are now performed more safely.
- Some error messages has been fixed.

### Improved

- Synchronisation is now more efficient and faster.
- Saving chunks is a bit more robust.

### New Feature

- We can remove orphaned chunks again, now!
    - Without rebuilding the database!
    - Note: Please synchronise devices completely before removing orphaned chunks.
    - Note2: Deleted files are using chunks, if you want to remove them, please commit the deletion first. (`Commit File Deletion`)
    - Note3: If you lost some chunks, do not worry. They will be resurrected if not so much time has passed. Try `Resurrect deleted chunks`.
    - Note4: This feature is still beta. Please report any issues you encounter.
    - Note5: Please disable `On demand chunk fetching`, and enable `Compute revisions for each chunk` before using this feature.
        - These settings is going to be default in the future.

## 0.24.7

### Fixed (Security)

- Assigning IDs to chunks has been corrected for more safety.
    - Before version 0.24.6, there were possibilities in End-to-End encryption where a brute-force attack could be carried out against an E2EE passphrase via a chunk ID if a zero-byte file was present. Now the chunk ID should be assigned more safely, and not all of passphrases are used for generating the chunk ID.
    - This is a security fix, and it is recommended to update and rebuild database to this version as soon as possible.
    - Note: It keeps the compatibility with the previous versions, but the chunk ID will be changed for the new files and modified files. Hence, deduplication will not work for the files which are modified after the update. It is recommended to rebuild the database to avoid the potential issues, and reduce the database size.
    - Note2: This fix is only for with E2EE. Plain synchronisation is not affected by this issue.

### Fixed

- Now the conflict resolving dialogue is automatically closed after the conflict has been resolved (and transferred from other devices; or written by some other resolution).
- Resolving conflicts by timestamp is now working correctly.
    - It also fixes customisation sync.

### Improved

- Notifications can be suppressed for the hidden files update now.
- No longer uses the old-xxhash and sha1 for generating the chunk ID. Chunk ID is now generated with the new algorithm (Pure JavaScript hash implementation; which is using Murmur3Hash and FNV-1a now used).

## 0.24.6

### Fixed (Quick Fix)

- Fixed the issue of log is not displayed on the log pane if the pane has not been shown on startup.
    - This release is only for it. However, fixing this had been necessary to report any other issues.

## 0.24.5

### Fixed

- Fixed incorrect behaviour when comparing objects with undefined as a property value.

### Improved

- The status line and the log summary are now displayed more smoothly and efficiently.
    - This improvement has also been applied to the logs displayed in the log pane.

## 0.24.4

### Fixed

- Fixed so many inefficient and buggy modules inherited from the past.

### Improved

- Tasks are now executed in an efficient asynchronous library.
- On-demand chunk fetching is now more efficient and keeps the interval between requests.
    - This will reduce the load on the server and the network.
    - And, safe for the Cloudant.

## 0.24.3

### Improved

- Many messages have been improved for better understanding as thanks to the fine works of @Volkor3-16! Thank you so much!
- Documentations also have been updated to reflect the changes in the messages.
- Now the style of In-Editor Status has been solid for some Android devices.

## 0.24.2

### Rewritten

- Hidden File Sync is now respects the file changes on the storage. Not simply comparing modified times.
    - This makes hidden file sync more robust and reliable.

### Fixed

- `Scan hidden files before replication` is now configurable again.
- Some unexpected errors are now handled more gracefully.
- Meaningless event passing during boot sequence is now prevented.
- Error handling for non-existing files has been fixed.
- Hidden files will not be batched to avoid the potential error.
    - This behaviour had been causing the error in the previous versions in specific situations.
- The log which checking automatic conflict resolution is now in verbose level.
- Replication log (skipping non-targetting files) shows the correct information.
- The dialogue that asking enabling optional feature during `Rebuild Everything` now prevents to show the `overwrite` option.
    - The rebuilding device is the first, meaningless.
- Files with different modified time but identical content are no longer processed repeatedly.
- Some unexpected errors which caused after terminating plug-in are now avoided.
-

### Improved

- JSON files are now more transferred efficiently.
    - Now the JSON files are transferred in more fine chunks, which makes the transfer more efficient.

## 0.24.1

### Fixed

- Vault History can show the correct information of match-or-not for each file and database even if it is a binary file.
- `Sync settings via markdown` is now hidden during the setup wizard.
- Verify and Fix will ignore the hidden files if the hidden file sync is disabled.

#### New feature

- Now we can fetch the tweaks from the remote database while the setting dialogue and wizard are processing.

### Improved

- More things are moved to the modules.
    - Includes the Main codebase. Now `main.ts` is almost stub.
- EventHub is now more robust and typesafe.

## 0.24.0

### Improved

- The welcome message is now more simple to encourage the use of the Setup-URI.
    - The secondary message is also simpler to guide users to Minimal Setup.
        - But Setup-URI will be recommended again, due to its importance.
    - These dialogues contain a link to the documentation which can be clicked.
- The minimal setup is more minimal now. And, the setup is more user-friendly.
    - Now the Configuration of the remote database is checked more robustly, but we can ignore the warning and proceed with the setup.
- Before we are asked about each feature, we are asked if we want to use optional features in the first place.
    - This is to prevent the user from being overwhelmed by the features.
    - And made it clear that it is not recommended for new users.
- Many messages have been improved for better understanding.
    - Ridiculous messages have been (carefully) refined.
    - Dialogues are more informative and friendly.
        - A lot of messages have been mostly rewritten, leveraging Markdown.
        - Especially auto-closing dialogues are now explicitly labelled: `To stop the countdown, tap anywhere on the dialogue`.
- Now if the is plugin configured to ignore some events, we will get a chance to fix it, in addition to the warning.
    - And why that has happened is also explained in the dialogue.
- A note relating to device names has been added to Customisation Sync on the setting dialogue.
- We can verify and resolve also the hidden files now.

### Fixed

- We can resolve the conflict of the JSON file correctly now.
- Verifying files between the local database and storage is now working correctly.
- While restarting the plug-in, the shown dialogues will be automatically closed to avoid unexpected behaviour.
- Replicated documents that the local device has configured to ignore are now correctly ignored.
- The chunks of the document on the local device during the first transfer will be created correctly.
    - And why we should create them is now explained in the dialogue.
- If optional features have been enabled in the wizard, `Enable advanced features` will be toggled correctly.
  The hidden file sync is now working correctly. - Now the deletion of hidden files is correctly synchronised.
- Customisation Sync is now working correctly together with hidden file sync.
- No longer database suffix is stored in the setting sharing markdown.
- A fair number of bugs have been fixed.

### Changed

- Some default settings have been changed for an easier new user experience.
    - Preventing the meaningless migration of the settings.

### Tiding

- The codebase has been reorganised into clearly defined modules.
- Commented-out codes have been gradually removed.

### 0.23.0

Incredibly new features!

Now, we can use object storage (MinIO, S3, R2 or anything you like) for synchronising! Moreover, despite that, we can use all the features as if we were using CouchDB.
Note: As this is a pretty experimental feature, hence we have some limitations.

- This is built on the append-only architecture. It will not shrink used storage if we do not perform a rebuild.
- A bit fragile. However, our version x.yy.0 is always so.
- When the first synchronisation, the entire history to date is transferred. For this reason, it is preferable to do this under the WiFi network.
- Do not worry, from the second synchronisation, we always transfer only differences.

I hope this feature empowers users to maintain independence and self-host their data, offering an alternative for those who prefer to manage their own storage solutions and avoid being stuck on the right side of a sudden change in business model.

Of course, I use Self-hosted MinIO for testing and recommend this. It is for the same reason as using CouchDB. -- open, controllable, auditable and indeed already audited by numerous eyes.

Let me write one more acknowledgement.

I have a lot of respect for that plugin, even though it is sometimes treated as if it is a competitor, remotely-save. I think it is a great architecture that embodies a different approach to my approach of recreating history. This time, with all due respect, I have used some of its code as a reference.
Hooray for open source, and generous licences, and the sharing of knowledge by experts.

#### Version history

- 0.23.23:
    - Refined:
        - Setting dialogue very slightly refined.
            - The hodgepodge inside the `Hatch` pane has been sorted into more explicit categorised panes.
                - Now we have new panes for:
                    - `Selector`
                    - `Advanced`
                    - `Power users`
                    - `Patches (Edge case)`
            - Applying the settings will now be more informative.
                - The header bar will be shown for applying the settings which needs a database rebuild.
                - Applying methods are now more clearly navigated.
            - Definitely, drastic change. I hope this will be more user-friendly. However, if you notice any issues, please let me know. I hope that nothing missed.
    - New features:
        - Word-segmented chunk building on users language
            - Chunks can now be built with word-segmented data, enhancing efficiency for markdown files which contains the multiple sentences in a single line.
            - This feature is enabled by default through `Use Segmented-splitter`.
                - (Default: Disabled, Please be relived, I have learnt).
    - Fixed:
        - Sending chunks on `Send chunk in bulk` are now buffered to avoid the out-of-memory error.
        - `Send chunk in bulk` is back to default disabled. (Sorry, not applied to the migrated users; I did not think we should deepen the wound any further "automatically").
        - Merging conflicts of JSON files are now works fine even if it contains `null`.
    - Development:
        - Implemented the logic for automatically generating the stub of document for the setting dialogue.
- 0.23.22:
    - Fixed:
        - Case-insensitive file handling
            - Full-lower-case files are no longer created during database checking.
        - Bulk chunk transfer
            - The default value will automatically adjust to an acceptable size when using IBM Cloudant.
- 0.23.21:
    - New Features:
        - Case-insensitive file handling
            - Files can now be handled case-insensitively.
            - This behaviour can be modified in the settings under `Handle files as Case-Sensitive` (Default: Prompt, Enabled for previous behaviour).
        - Improved chunk revision fixing
            - Revisions for chunks can now be fixed for faster chunk creation.
            - This can be adjusted in the settings under `Compute revisions for chunks` (Default: Prompt, Enabled for previous behaviour).
        - Bulk chunk transfer
            - Chunks can now be transferred in bulk during uploads.
            - This feature is enabled by default through `Send chunks in bulk`.
        - Creation of missing chunks without
            - Missing chunks can be created without storing notes, enhancing efficiency for first synchronisation or after prolonged periods without synchronisation.
    - Improvements:
        - File status scanning on the startup
            - Quite significant performance improvements.
            - No more missing scans of some files.
        - Status in editor enhancements
            - Significant performance improvements in the status display within the editor.
            - Notifications for files that will not be synchronised will now be properly communicated.
        - Encryption and Decryption
            - These processes are now performed in background threads to ensure fast and stable transfers.
        - Verify and repair all files
            - Got faster through parallel checking.
        - Migration on update
            - Migration messages and wizards have become more helpful.
    - Behavioural changes:
        - Chunk size adjustments
            - Large chunks will no longer be created for older, stable files, addressing storage consumption issues.
        - Flag file automation
            - Confirmation will be shown and we can cancel it.
    - Fixed:
        - Database File Scanning
            - All files in the database will now be enumerated correctly.
    - Miscellaneous
        - Dependency updated.
        - Now, tree shaking is left to terser, from esbuild.
- 0.23.20:
    - Fixed:
        - Customisation Sync now checks the difference while storing or applying the configuration.
            - No longer storing the same configuration multiple times.
        - Time difference in the dialogue has been fixed.
        - Remote Storage Limit Notification dialogue has been fixed, now the chosen value is saved.
    - Improved:
        - The Enlarging button on the enlarging threshold dialogue now displays the new value.
- 0.23.19:
    - Not released.
- 0.23.18:
    - New feature:
        - Per-file-saved customization sync has been shipped.
            - We can synchronise plug-igs etc., more smoothly.
            - Default: disabled. We need a small migration when enabling this. And all devices should be updated to v0.23.18. Once we enabled this, we lost compatibility with old versions.
        - Customisation sync has got beta3.
            - We can set `Flag` to each item to select the newest, automatically.
                - This configuration is per device.
    - Improved:
        - Start-up speed has been improved.
    - Fixed:
        - On the customisation sync dialogue, buttons are kept within the screen.
        - No more unnecessary entries on `data.json` for customisation sync.
        - Selections are no longer lost while updating customisation items.
    - Tidied on source codes:
        - Many typos have been fixed.
        - Some unnecessary type casting removed.
- 0.23.17:
    - Improved:
        - Overall performance has been improved by using PouchDB 9.0.0.
        - Configuration mismatch detection is refined. We can resolve mismatches more smoothly and naturally.
          More detail is on `troubleshooting.md` on the repository.
    - Fixed:
        - Customisation Sync will be disabled when a corrupted configuration is detected.
          Therefore, the Device Name can be changed even in the event of a configuration mismatch.
    - New feature:
        - We can get a notification about the storage usage of the remote database.
            - Default: We will be asked.
            - If the remote storage usage approaches the configured value, we will be asked whether we want to Rebuild or increase the limit.
- 0.23.16:
    - Maintenance Update:
        - Library refining (Phase 1 - step 2). There are no significant changes on the user side.
        - Including the following fixes of potentially problems:
            - the problem which the path had been obfuscating twice has been resolved.
            - Note: Potential problems of the library; which has not happened in Self-hosted LiveSync for some reasons.
- 0.23.15:
    - Maintenance Update:
        - Library refining (Phase 1). There are no significant changes on the user side.
- 0.23.14:
    - Fixed:
        - No longer batch-saving ignores editor inputs.
        - The file-watching and serialisation processes have been changed to the one which is similar to previous implementations.
        - We can configure the settings (Especially about text-boxes) even if we have configured the device name.
    - Improved:
        - We can configure the delay of batch-saving.
            - Default: 5 seconds, the same as the previous hard-coded value. (Note: also, the previous behaviour was not correct).
        - Also, we can configure the limit of delaying batch-saving.
        - The performance of showing status indicators has been improved.
- 0.23.13:
    - Fixed:
        - No longer files have been trimmed even delimiters have been continuous.
        - Fixed the toggle title to `Do not split chunks in the background` from `Do not split chunks in the foreground`.
        - Non-configured item mismatches are no longer detected.
- 0.23.12:
    - Improved:
        - Now notes will be split into chunks in the background thread to improve smoothness.
            - Default enabled, to disable, toggle `Do not split chunks in the foreground` on `Hatch` -> `Compatibility`.
            - If you want to process very small notes in the foreground, please enable `Process small files in the foreground` on `Hatch` -> `Compatibility`.
        - We can use a `splitting-limit-capped chunk splitter`; which performs more simple and make less amount of chunks.
            - Default disabled, to enable, toggle `Use splitting-limit-capped chunk splitter` on `Sync settings` -> `Performance tweaks`
    - Tidied
        - Some files have been separated into multiple files to make them more explicit in what they are responsible for.
- 0.23.11:
    - Fixed:
        - Now we _surely_ can set the device name and enable customised synchronisation.
        - Unnecessary dialogue update processes have been eliminated.
        - Customisation sync no longer stores half-collected files.
        - No longer hangs up when removing or renaming files with the `Sync on Save` toggle enabled.
    - Improved:
        - Customisation sync now performs data deserialization more smoothly.
        - New translations have been merged.
- 0.23.10
    - Fixed:
        - No longer configurations have been locked in the minimal setup.
- 0.23.9
    - Fixed:
        - No longer unexpected parallel replication is performed.
        - Now we can set the device name and enable customised synchronisation again.
- 0.23.8
    - New feature:
        - Now we are ready for i18n.
            - Patch or PR of `rosetta.ts` are welcome!
        - The setting dialogue has been refined. Very controllable, clearly displayed disabled items, and ready to i18n.
    - Fixed:
        - Many memory leaks have been rescued.
        - Chunk caches now work well.
        - Many trivial but potential bugs are fixed.
        - No longer error messages will be shown on retrieving checkpoint or server information.
        - Now we can check and correct tweak mismatch during the setup
    - Improved:
        - Customisation synchronisation has got more smoother.
    - Tidied
        - Practically unused functions have been removed or are being prepared for removal.
        - Many of the type-errors and lint errors have been corrected.
        - Unused files have been removed.
    - Note:
        - From this version, some test files have been included. However, they are not enabled and released in the release build.
            - To try them, please run Self-hosted LiveSync in the dev build.
- 0.23.7
    - Fixed:
        - No longer missing tasks which have queued as the same key (e.g., for the same operation to the same file).
            - This occurs, for example, with hidden files that have been changed multiple times in a very short period of time, such as `appearance.json`. Thanks for the report!
        - Some trivial issues have been fixed.
    - New feature:
        - Reloading Obsidian can be scheduled until that file and database operations are stable.
- 0.23.6:
    - Fixed:
        - Now the remote chunks could be decrypted even if we are using `Incubate chunks in Document`. (The note of 0.23.6 has been fixed).
        - Chunk retrieving with `Incubate chunks in document` got more efficiently.
        - No longer task processor misses the completed tasks.
        - Replication is no longer started automatically during changes in window visibility (e.g., task switching on the desktop) when off-focused.
- 0.23.5:
    - New feature:
        - Now we can check configuration mismatching between clients before synchronisation.
            - Default: enabled / Preferred: enabled / We can disable this by the `Do not check configuration mismatch before replication` toggle in the `Hatch` pane.
            - It detects configuration mismatches and prevents synchronisation failures and wasted storage.
        - Now we can perform remote database compaction from the `Maintenance` pane.
    - Fixed:
        - We can detect the bucket could not be reachable.
    - Note:
        - Known inexplicable behaviour: Recently, (Maybe while enabling `Incubate chunks in Document` and `Fetch chunks on demand` or some more toggles), our customisation sync data is sometimes corrupted. It will be addressed by the next release.
- 0.23.4
    - Fixed:
        - No longer experimental configuration is shown on the Minimal Setup.
    - New feature:
        - We can now use `Incubate Chunks in Document` to reduce non-well-formed chunks.
            - Default: disabled / Preferred: enabled in all devices.
            - When we enabled this toggle, newly created chunks are temporarily kept within the document, and graduated to become independent chunks once stabilised.
            - The [design document](https://github.com/vrtmrz/obsidian-livesync/blob/3925052f9290b3579e45a4b716b3679c833d8ca0/docs/design_docs_of_keep_newborn_chunks.md) has been also available..
- 0.23.3
    - Fixed: No longer unwanted `\f` in journal sync.
- 0.23.2
    - Sorry for all the fixes to experimental features. (These things were also critical for dogfooding). The next release would be the main fixes! Thank you for your patience and understanding!
    - Fixed:
        - Journal Sync will not hang up during big replication, especially the initial one.
        - All changes which have been replicated while rebuilding will not be postponed (Previous behaviour).
    - Improved:
        - Now Journal Sync works efficiently in download and parse, or pack and upload.
        - Less server storage and faster packing/unpacking usage by the new chunk format.
- 0.23.1

    - Fixed:
        - Now journal synchronisation considers untransferred each from sent and received.
        - Journal sync now handles retrying.
        - Journal synchronisation no longer considers the synchronisation of chunks as revision updates (Simply ignored).
        - Journal sync now splits the journal pack to prevent mobile device rebooting.
        - Maintenance menus which had been on the command palette are now back in the maintain pane on the setting dialogue.
    - Improved:
        - Now all changes which have been replicated while rebuilding will be postponed.

- 0.23.0
    - New feature:
        - Now we can use Object Storage.

### 0.22.0

A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history

- 0.22.19
    - Fixed:
        - No longer data corrupting due to false BASE64 detections.
    - Improved:
        - A bit more efficient in Automatic data compression.
- 0.22.18
    - New feature (Very Experimental):
        - Now we can use `Automatic data compression` to reduce amount of traffic and the usage of remote database.
            - Please make sure all devices are updated to v0.22.18 before trying this feature.
            - If you are using some other utilities which connected to your vault, please make sure that they have compatibilities.
            - Note: Setting `File Compression` on the remote database works for shrink the size of remote database. Please refer the [Doc](https://docs.couchdb.org/en/stable/config/couchdb.html#couchdb/file_compression).
- 0.22.17:
    - Fixed:
        - Error handling on booting now works fine.
        - Replication is now started automatically in LiveSync mode.
        - Batch database update is now disabled in LiveSync mode.
        - No longer automatically reconnection while off-focused.
        - Status saves are thinned out.
        - Now Self-hosted LiveSync waits for all files between the local database and storage to be surely checked.
    - Improved:
        - The job scheduler is now more robust and stable.
        - The status indicator no longer flickers and keeps zero for a while.
        - No longer meaningless frequent updates of status indicators.
        - Now we can configure regular expression filters in handy UI. Thank you so much, @eth-p!
        - `Fetch` or `Rebuild everything` is now more safely performed.
    - Minor things
        - Some utility function has been added.
        - Customisation sync now less wrong messages.
        - Digging the weeds for eradication of type errors.
- 0.22.16:
    - Fixed:
        - Fixed the issue that binary files were sometimes corrupted.
        - Fixed customisation sync data could be corrupted.
    - Improved:
        - Now the remote database costs lower memory.
            - This release requires a brief wait on the first synchronisation, to track the latest changeset again.
        - Description added for the `Device name`.
    - Refactored:
        - Many type-errors have been resolved.
        - Obsolete file has been deleted.
- 0.22.15:
    - Improved: - Faster start-up by removing too many logs which indicates normality - By streamlined scanning of customised synchronisation extra phases have been deleted.
      ... To continue on to `updates_old.md`.
- 0.22.14:
    - New feature:
        - We can disable the status bar in the setting dialogue.
    - Improved:
        - Now some files are handled as correct data type.
        - Customisation sync now uses the digest of each file for better performance.
        - The status in the Editor now works performant.
    - Refactored:
        - Common functions have been ready and the codebase has been organised.
        - Stricter type checking following TypeScript updates.
        - Remove old iOS workaround for simplicity and performance.
- 0.22.13:
    - Improved:
        - Now using HTTP for the remote database URI warns of an error (on mobile) or notice (on desktop).
    - Refactored:
        - Dependencies have been polished.
- 0.22.12:
    - Changed:
        - The default settings has been changed.
    - Improved:
        - Default and preferred settings are applied on completion of the wizard.
    - Fixed:
        - Now Initialisation `Fetch` will be performed smoothly and there will be fewer conflicts.
        - No longer stuck while Handling transferred or initialised documents.
- 0.22.11:
    - Fixed:
        - `Verify and repair all files` is no longer broken.
    - New feature:
        - Now `Verify and repair all files` is able to...
            - Restore if the file only in the local database.
            - Show the history.
    - Improved:
        - Performance improved.
- 0.22.10
    - Fixed:
        - No longer unchanged hidden files and customisations are saved and transferred now.
        - File integrity of vault history indicates the integrity correctly.
    - Improved:
        - In the report, the schema of the remote database URI is now printed.
- 0.22.9
    - Fixed:
        - Fixed a bug on `fetch chunks on demand` that could not fetch the chunks on demand.
    - Improved:
        - `fetch chunks on demand` works more smoothly.
        - Initialisation `Fetch` is now more efficient.
    - Tidied:
        - Removed some meaningless codes.
- 0.22.8
    - Fixed:
        - Now fetch and unlock the locked remote database works well again.
        - No longer crash on symbolic links inside hidden folders.
    - Improved:
        - Chunks are now created more efficiently.
            - Splitting old notes into a larger chunk.
        - Better performance in saving notes.
        - Network activities are indicated as an icon.
        - Less memory used for binary processing.
    - Tidied:
        - Cleaned unused functions up.
        - Sorting out the codes that have become nonsense.
    - Changed:
        - Now no longer `fetch chunks on demand` needs `Pacing replication`
            - The setting `Do not pace synchronization` has been deleted.
- 0.22.7
    - Fixed:
        - No longer deleted hidden files were ignored.
        - The document history dialogue is now able to process the deleted revisions.
        - Deletion of a hidden file is now surely performed even if the file is already conflicted.
- 0.22.6
    - Fixed:
        - Fixed a problem with synchronisation taking a long time to start in some cases.
            - The first synchronisation after update might take a bit longer.
        - Now we can disable E2EE encryption.
    - Improved:
        - `Setup Wizard` is now more clear.
        - `Minimal Setup` is now more simple.
        - Self-hosted LiveSync now be able to use even if there are vaults with the same name.
            - Database suffix will automatically added.
        - Now Self-hosted LiveSync waits until set-up is complete.
        - Show reload prompts when possibly recommended while settings.
    - New feature:
        - A guidance dialogue prompting for settings will be shown after the installation.
    - Changed
        - `Open setup URI` is now `Use the copied setup URI`
        - `Copy setup URI` is now `Copy current settings as a new setup URI`
        - `Setup Wizard` is now `Minimal Setup`
        - `Check database configuration` is now `Check and Fix database configuration`
- 0.22.5
    - Fixed:
        - Some description of settings have been refined
    - New feature:
        - TroubleShooting is now shown in the setting dialogue.
- 0.22.4
    - Fixed:
        - Now the result of conflict resolution could be surely written into the storage.
        - Deleted files can be handled correctly again in the history dialogue and conflict dialogue.
        - Some wrong log messages were fixed.
        - Change handling now has become more stable.
        - Some event handling became to be safer.
    - Improved:
        - Dumping document information shows conflicts and revisions.
        - The timestamp-only differences can be surely cached.
        - Timestamp difference detection can be rounded by two seconds.
    - Refactored:
        - A bit of organisation to write the test.
- 0.22.3
    - Fixed:
        - No longer detects storage changes which have been caused by Self-hosted LiveSync itself.
        - Setting sync file will be detected only if it has been configured now.
            - And its log will be shown only while the verbose log is enabled.
        - Customisation file enumeration has got less blingy.
        - Deletion of files is now reliably synchronised.
    - Fixed and improved:
        - In-editor-status is now shown in the following areas:
            - Note editing pane (Source mode and live-preview mode).
            - New tab pane.
            - Canvas pane.
- 0.22.2
    - Fixed:
        - Now the results of resolving conflicts are surely synchronised.
    - Modified:
        - Some setting items got new clear names. (`Sync Settings` -> `Targets`).
    - New feature:
        - We can limit the synchronising files by their size. (`Sync Settings` -> `Targets` -> `Maximum file size`).
            - It depends on the size of the newer one.
            - At Obsidian 1.5.3 on mobile, we should set this to around 50MB to avoid restarting Obsidian.
        - Now the settings could be stored in a specific markdown file to synchronise or switch it (`General Setting` -> `Share settings via markdown`).
            - [Screwdriver](https://github.com/vrtmrz/obsidian-screwdriver) is quite good, but mostly we only need this.
        - Customisation of the obsoleted device is now able to be deleted at once.
            - We have to put the maintenance mode in at the Customisation sync dialogue.
- 0.22.1
    - New feature:
        - We can perform automatic conflict resolution for inactive files, and postpone only manual ones by `Postpone manual resolution of inactive files`.
        - Now we can see the image in the document history dialogue.
            - We can see the difference of the image, in the document history dialogue.
                - And also we can highlight differences.
    - Improved:
        - Hidden file sync has been stabilised.
        - Now automatically reloads the conflict-resolution dialogue when new conflicted revisions have arrived.
    - Fixed:
        - No longer periodic process runs after unloading the plug-in.
        - Now the modification of binary files is surely stored in the storage.
- 0.22.0
    - Refined:
        - Task scheduling logics has been rewritten.
        - Screen updates are also now efficient.
        - Possibly many bugs and fragile behaviour has been fixed.
        - Status updates and logging have been thinned out to display.
    - Fixed:
        - Remote-chunk-fetching now works with keeping request intervals
    - New feature:
        - We can show only the icons in the editor.
        - Progress indicators have been more meaningful:
            - 📥 Unprocessed transferred items
            - 📄 Working database operation
            - 💾 Working write storage processes
            - ⏳ Working read storage processes
            - 🛫 Pending read storage processes
            - ⚙️ Working or pending storage processes of hidden files
            - 🧩 Waiting chunks
            - 🔌 Working Customisation items (Configuration, snippets and plug-ins)

... To continue on to `updates_old.md`.

### 0.21.0

The E2EE encryption V2 format has been reverted. That was probably the cause of the glitch.
Instead, to maintain efficiency, files are treated with Blob until just before saving. Along with this, the old-fashioned encryption format has also been discontinued.
There are both forward and backwards compatibilities, with recent versions. However, unfortunately, we lost compatibility with filesystem-livesync or some.
It will be addressed soon. Please be patient if you are using filesystem-livesync with E2EE.

- 0.21.5
    - Improved:
        - Now all revisions will be shown only its first a few letters.
        - Now ID of the documents is shown in the log with the first 8 letters.
    - Fixed:
        - Check before modifying files has been implemented.
        - Content change detection has been improved.
- 0.21.4
    - This release had been skipped.
- 0.21.3
    - Implemented:
        - Now we can use SHA1 for hash function as fallback.
- 0.21.2
    - IMPORTANT NOTICE: **0.21.1 CONTAINS A BUG WHILE REBUILDING THE DATABASE. IF YOU HAVE BEEN REBUILT, PLEASE MAKE SURE THAT ALL FILES ARE SANE.**
        - This has been fixed in this version.
    - Fixed:
        - No longer files are broken while rebuilding.
        - Now, Large binary files can be written correctly on a mobile platform.
        - Any decoding errors now make zero-byte files.
    - Modified:
        - All files are processed sequentially for each.
- 0.21.1
    - Fixed:
        - No more infinity loops on larger files.
        - Show message on decode error.
    - Refactored:
        - Fixed to avoid obsolete global variables.
- 0.21.0
    - Changes and performance improvements:
        - Now the saving files are processed by Blob.
        - The V2-Format has been reverted.
        - New encoding format has been enabled in default.
        - WARNING: Since this version, the compatibilities with older Filesystem LiveSync have been lost.

## 0.20.0

At 0.20.0, Self-hosted LiveSync has changed the binary file format and encrypting format, for efficient synchronisation.  
The dialogue will be shown and asks us to decide whether to keep v1 or use v2. Once we have enabled v2, all subsequent edits will be saved in v2. Therefore, devices running 0.19 or below cannot understand this and they might say that decryption error. Please update all devices.  
Then we will have an impressive performance.

Of course, these are very impactful changes. If you have any questions or troubled things, please feel free to open an issue and mention me.

Note: if you want to roll it back to v1, please enable `Use binary and encryption version 1` on the `Hatch` pane and perform the `rebuild everything` once.

Extra but notable information:

This format change gives us the ability to detect some `marks` in the binary files as same as text files. Therefore, we can split binary files and some specific sort of them (i.e., PDF files) at the specific character. It means that editing the middle of files could be detected with marks.

Now only a few chunks are transferred, even if we add a comment to the PDF or put new files into the ZIP archives.

- 0.20.7
    - Fixed
        - To better replication, path obfuscation is now deterministic even if with E2EE.  
          Note: Compatible with previous database without any conversion. Only new files will be obfuscated in deterministic.
- 0.20.6
    - Fixed
        - Now empty file could be decoded.
        - Local files are no longer pre-saved before fetching from a remote database.
        - No longer deadlock while applying customisation sync.
        - Configuration with multiple files is now able to be applied correctly.
        - Deleting folder propagation now works without enabling the use of a trash bin.
- 0.20.5
    - Fixed
        - Now the files which having digit or character prefixes in the path will not be ignored.
- 0.20.4
    - Fixed
        - The text-input-dialogue is no longer broken.
            - Finally, we can use the Setup URI again on mobile.
- 0.20.3
    - New feature:
        - We can launch Customization sync from the Ribbon if we enabled it.
    - Fixed:
        - Setup URI is now back to the previous spec; be encrypted by V1.
            - It may avoid the trouble with iOS 17.
        - The Settings dialogue is now registered at the beginning of the start-up process.
            - We can change the configuration even though LiveSync could not be launched in normal.
    - Improved:
        - Enumerating documents has been faster.
- 0.20.2
    - New feature:
        - We can delete all data of customization sync from the `Delete all customization sync data` on the `Hatch` pane.
    - Fixed:
        - Prevent keep restarting on iOS by yielding microtasks.
- 0.20.1
    - Fixed:
        - No more UI freezing and keep restarting on iOS.
        - Diff of Non-markdown documents are now shown correctly.
    - Improved:
        - Performance has been a bit improved.
        - Customization sync has gotten faster.
            - However, We lost forward compatibility again (only for this feature). Please update all devices.
    - Misc
        - Terser configuration has been more aggressive.
- 0.20.0
    - Improved:
        - A New binary file handling implemented
        - A new encrypted format has been implemented
        - Now the chunk sizes will be adjusted for efficient sync
    - Fixed:
        - levels of exception in some logs have been fixed
    - Tidied:
        - Some Lint warnings have been suppressed.

### 0.19.0

#### Customization sync

Since `Plugin and their settings` have been broken, so I tried to fix it, not just fix it, but fix it the way it should be.

Now, we have `Customization sync`.

It is a real shame that the compatibility between these features has been broken. However, this new feature is surely useful and I believe that worth getting over the pain.
We can use the new feature with the same configuration. Only the menu on the command palette has been changed. The dialog can be opened by `Show customization sync dialog`.

I hope you will give it a try.

#### Minors

- 0.19.1
    - Fixed: Fixed hidden file handling on Linux
    - Improved: Now customization sync works more smoothly.
- 0.19.2
    - Fixed:
        - Fixed garbage collection error while unreferenced chunks exist many.
        - Fixed filename validation on Linux.
    - Improved:
        - Showing status is now thinned for performance.
        - Enhance caching while collecting chunks.
- 0.19.3
    - Improved:
        - Now replication will be paced by collecting chunks. If synchronisation has been deadlocked, please enable `Do not pace synchronization` once.
- 0.19.4
    - Improved:
        - Reduced remote database checking to improve speed and reduce bandwidth.
    - Fixed:
        - Chunks which previously misinterpreted are now interpreted correctly.
            - No more missing chunks which not be found forever, except if it has been actually missing.
        - Deleted file detection on hidden file synchronising now works fine.
        - Now the Customisation sync is surely quiet while it has been disabled.
- 0.19.5
    - Fixed:
        - Now hidden file synchronisation would not be hanged, even if so many files exist.
    - Improved:
        - Customisation sync works more smoothly.
    - Note: Concurrent processing has been rollbacked into the original implementation. As a result, the total number of processes is no longer shown next to the hourglass icon. However, only the processes that are running concurrently are shown.
- 0.19.6
    - Fixed:
        - Logging has been tweaked.
        - No more too many planes and rockets.
        - The batch database update now surely only works in non-live mode.
    - Internal things:
        - Some frameworks has been upgraded.
        - Import declaration has been fixed.
    - Improved:
        - The plug-in now asks to enable a new adaptor, when rebuilding, if it is not enabled yet.
        - The setting dialogue refined.
            - Configurations for compatibilities have been moved under the hatch.
            - Made it clear that disabled is the default.
            - Ambiguous names configuration have been renamed.
            - Items that have no meaning in the settings are no longer displayed.
            - Some items have been reordered for clarity.
            - Each configuration has been grouped.
- 0.19.7
    - Fixed:
        - The initial pane of Setting dialogue is now changed to General Settings.
        - The Setup Wizard is now able to flush existing settings and get into the mode again.
- 0.19.8
    - New feature:
        - Vault history: A tab has been implemented to give a birds-eye view of the changes that have occurred in the vault.
    - Improved:
        - Now the passphrases on the dialogue masked out. Thank you @antoKeinanen!
        - Log dialogue is now shown as one of tabs.
    - Fixed:
        - Some minor issues has been fixed.
- 0.19.9
    - New feature (For fixing a problem):
        - We can fix the database obfuscated and plain paths that have been mixed up.
    - Improvements
        - Customisation Sync performance has been improved.
- 0.19.10
    - Fixed
        - Fixed the issue about fixing the database.
- 0.19.11
    - Improvements:
        - Hashing ChunkID has been improved.
        - Logging keeps 400 lines now.
    - Refactored:
        - Import statement has been fixed about types.
- 0.19.12
    - Improved:
        - Boot-up performance has been improved.
        - Customisation sync performance has been improved.
        - Synchronising performance has been improved.
- 0.19.13
    - Implemented:
        - Database clean-up is now in beta 2!
          We can shrink the remote database by deleting unused chunks, with keeping history.
          Note: Local database is not cleaned up totally. We have to `Fetch` again to let it done.
          **Note2**: Still in beta. Please back your vault up anything before.
    - Fixed:
        - The log updates are not thinned out now.
- 0.19.14
    - Fixed:
        - Internal documents are now ignored.
        - Merge dialogue now respond immediately to button pressing.
        - Periodic processing now works fine.
        - The checking interval of detecting conflicted has got shorter.
        - Replication is now cancelled while cleaning up.
        - The database locking by the cleaning up is now carefully unlocked.
        - Missing chunks message is correctly reported.
    - New feature:
        - Suspend database reflecting has been implemented.
            - This can be disabled by `Fetch database with previous behaviour`.
        - Now fetch suspends the reflecting database and storage changes temporarily to improve the performance.
        - We can choose the action when the remote database has been cleaned
        - Merge dialogue now show `↲` before the new line.
    - Improved:
        - Now progress is reported while the cleaning up and fetch process.
        - Cancelled replication is now detected.
- 0.19.15
    - Fixed:
        - Now storing files after cleaning up is correct works.
    - Improved:
        - Cleaning the local database up got incredibly fastened.
          Now we can clean instead of fetching again when synchronising with the remote which has been cleaned up.
- 0.19.16
    - Many upgrades on this release. I have tried not to let that happen, if something got corrupted, please feel free to notify me.
    - New feature:
        - (Beta) ignore files handling
          We can use `.gitignore`, `.dockerignore`, and anything you like to filter the synchronising files.
    - Fixed:
        - Buttons on lock-detected-dialogue now can be shown in narrow-width devices.
    - Improved:
        - Some constant has been flattened to be evaluated.
        - The usage of the deprecated API of obsidian has been reduced.
        - Now the indexedDB adapter will be enabled while the importing configuration.
    - Misc:
    - Compiler, framework, and dependencies have been upgraded.
    - Due to standing for these impacts (especially in esbuild and svelte,) terser has been introduced.
      Feel free to notify your opinion to me! I do not like to obfuscate the code too.
- 0.19.17
    - Fixed:
        - Now nested ignore files could be parsed correctly.
        - The unexpected deletion of hidden files in some cases has been corrected.
        - Hidden file change is no longer reflected on the device which has made the change itself.
    - Behaviour changed:
        - From this version, the file which has `:` in its name should be ignored even if on Linux devices.
- 0.19.18
    - Fixed:
        - Now the empty (or deleted) file could be conflict-resolved.
- 0.19.19
    - Fixed:
        - Resolving conflicted revision has become more robust.
        - LiveSync now try to keep local changes when fetching from the rebuilt remote database.
          Local changes now have been kept as a revision and fetched things will be new revisions.
        - Now, all files will be restored after performing `fetch` immediately.
- 0.19.20
    - New feature:
        - `Sync on Editor save` has been implemented
            - We can start synchronisation when we save from the Obsidian explicitly.
        - Now we can use the `Hidden file sync` and the `Customization sync` cooperatively.
            - We can exclude files from `Hidden file sync` which is already handled in Customization sync.
        - We can ignore specific plugins in Customization sync.
        - Now the message of leftover conflicted files accepts our click.
            - We can open `Resolve all conflicted files` in an instant.
    - Refactored:
        - Parallelism functions made more explicit.
        - Type errors have been reduced.
    - Fixed:
        - Now documents would not be overwritten if they are conflicted.
          It will be saved as a new conflicted revision.
        - Some error messages have been fixed.
        - Missing dialogue titles have been shown now.
            - We can click close buttons on mobile now.
        - Conflicted Customisation sync files will be resolved automatically by their modified time.
- 0.19.21
    - Fixed:
        - Hidden files are no longer handled in the initial replication.
        - Report from `Making report` fixed
            - No longer contains customisation sync information.
            - Version of LiveSync has been added.
- 0.19.22
    - Fixed:
        - Now the synchronisation will begin without our interaction.
        - No longer puts the configuration of the remote database into the log while checking configuration.
        - Some outdated description notes have been removed.
        - Options that are meaningless depending on other settings configured are now hidden.
            - Scan for hidden files before replication
            - Scan customization periodically
- 0.19.23
  -Improved:
    - We can open the log pane also from the command palette now.
    - Now, the hidden file scanning interval could be configured to 0.
    - `Check database configuration` now points out that we do not have administrator permission.

### 0.18.0

#### Now, paths of files in the database can now be obfuscated. (Experimental Feature)

At before v0.18.0, Self-hosted LiveSync used the path of files, to detect and resolve conflicts. In naive. The ID of the document stored in the CouchDB was naturally the filename.
However, it means a sort of lacking confidentiality. If the credentials of the database have been leaked, the attacker (or an innocent bystander) can read the path of files. So we could not use confidential things in the filename in some environments.
Since v0.18.0, they can be obfuscated. so it is no longer possible to decipher the path from the ID. Instead of that, it costs a bit CPU load than before, and the data structure has been changed a bit.

We can configure the `Path Obfuscation` in the `Remote database configuration` pane.  
Note: **When changing this configuration, we need to rebuild both of the local and the remote databases**.

#### Minors

- 0.18.1
    - Fixed:
        - Some messages are fixed (Typo)
        - File type detection now works fine!
- 0.18.2
    - Improved:
        - The setting pane has been refined.
        - We can enable `hidden files sync` with several initial behaviours; `Merge`, `Fetch` remote, and `Overwrite` remote.
        - No longer `Touch hidden files`.
- 0.18.3
    - Fixed Pop-up is now correctly shown after hidden file synchronisation.
- 0.18.4
    - Fixed:
        - `Fetch` and `Rebuild database` will work more safely.
        - Case-sensitive renaming now works fine.
          Revoked the logic which was made at #130, however, looks fine now.
- 0.18.5

    - Improved:
        - Actions for maintaining databases moved to the `🎛️Maintain databases`.
        - Clean-up of unreferenced chunks has been implemented on an **experimental**.
            - This feature requires enabling `Use new adapter`.
            - Be sure to fully all devices synchronised before perform it.
            - After cleaning up the remote, all devices will be locked out. If we are sure had it be synchronised, we can perform only cleaning-up locally. If not, we have to perform `Fetch`.

- 0.18.6
    - New features:
        - Now remote database cleaning-up will be detected automatically.
        - A solution selection dialogue will be shown if synchronisation is rejected after cleaning or rebuilding the remote database.
        - During fetching or rebuilding, we can configure `Hidden file synchronisation` on the spot.
            - It let us free from conflict resolution on initial synchronising.

### 0.17.0

- 0.17.0 has no surfaced changes but the design of saving chunks has been changed. They have compatibility but changing files after upgrading makes different chunks than before 0.16.x.
  Please rebuild databases once if you have been worried about storage usage.

    - Improved:

        - Splitting markdown
        - Saving chunks

    - Changed:
        - Chunk ID numbering rules

#### Minors

- 0.17.1

    - Fixed: Now we can verify and repair the database.
    - Refactored inside.

- 0.17.2

    - New feature
        - We can merge conflicted documents automatically if sensible.
    - Fixed
        - Writing to the storage will be pended while they have conflicts after replication.

- 0.17.3

    - Now we supported canvas! And conflicted JSON files are also synchronised with merging its content if they are obvious.

- 0.17.4

    - Canvases are now treated as a sort of plain text file. now we transfer only the metadata and chunks that have differences.

- 0.17.5 Now `read chunks online` had been fixed, and a new feature: `Use dynamic iteration count` to reduce the load on encryption/decryption.
  Note: `Use dynamic iteration count` is not compatible with earlier versions.
- 0.17.6 Now our renamed/deleted files have been surely deleted again.
- 0.17.7
    - Fixed:
        - Fixed merging issues.
        - Fixed button styling.
    - Changed:
        - Conflict checking on synchronising has been enabled for every note in default.
- 0.17.8
    - Improved: Performance improved. Prebuilt PouchDB is no longer used.
    - Fixed: Merging hidden files is also fixed.
    - New Feature: Now we can synchronise automatically after merging conflicts.
- 0.17.9
    - Fixed: Conflict merge of internal files is no longer broken.
    - Improved: Smoother status display inside the editor.
- 0.17.10
    - Fixed: Large file synchronising has been now addressed!
      Note: When synchronising large files, we have to set `Chunk size` to lower than 50, disable `Read chunks online`, `Batch size` should be set 50-100, and `Batch limit` could be around 20.
- 0.17.11
    - Fixed:
        - Performance improvement
        - Now `Chunk size` can be set to under one hundred.
    - New feature:
        - The number of transfers required before replication stabilises is now displayed.
- 0.17.12: Skipped.
- 0.17.13
    - Fixed: Document history is now displayed again.
    - Reorganised: Many files have been refactored.
- 0.17.14: Skipped.
- 0.17.15
    - Improved:
        - Confidential information has no longer stored in data.json as is.
        - Synchronising progress has been shown in the notification.
        - We can commit passphrases with a keyboard.
        - Configuration which had not been saved yet is marked now.
        - Now the filename is shown on the Conflict resolving dialog
    - Fixed:
        - Hidden files have been synchronised again.
        - Rename of files has been fixed again.
          And, minor changes have been included.
- 0.17.16:
    - Improved:
        - Plugins and their settings no longer need scanning if changes are monitored.
        - Now synchronising plugins and their settings are performed parallelly and faster.
        - We can place `redflag2.md` to rebuild the database automatically while the boot sequence.
    - Experimental:
        - We can use a new adapter on PouchDB. This will make us smoother.
            - Note: Not compatible with the older version.
    - Fixed:
        - The default batch size is smaller again.
        - Plugins and their setting can be synchronised again.
        - Hidden files and plugins are correctly scanned while rebuilding.
        - Files with the name started `_` are also being performed conflict-checking.
- 0.17.17
    - Fixed: Now we can merge JSON files even if we failed to compare items like null.
- 0.17.18
    - Fixed: Fixed lack of error handling.
- 0.17.19
    - Fixed: Error reporting has been ensured.
- 0.17.20
    - Improved: Changes of hidden files will be notified to Obsidian.
- 0.17.21
    - Fixed: Skip patterns now handle capital letters.
    - Improved
        - New configuration to avoid exceeding throttle capacity.
            - We have been grateful to @karasevm!
        - The conflicted `data.json` is no longer merged automatically.
            - This behaviour is not configurable, unlike the `Use newer file if conflicted` of normal files.
- 0.17.22
    - Fixed:
        - Now hidden files will not be synchronised while we are not configured.
        - Some processes could start without waiting for synchronisation to complete, but now they will wait for.
    - Improved
        - Now, by placing `redflag3.md`, we can discard the local database and fetch again.
        - The document has been updated! Thanks to @hilsonp!
- 0.17.23
    - Improved:
        - Now we can preserve the logs into the file.
            - Note: This option will be enabled automatically also when we flagging a red flag.
        - File names can now be made platform-appropriate.
    - Refactored:
        - Some redundant implementations have been sorted out.
- 0.17.24
    - New feature:
        - If any conflicted files have been left, they will be reported.
    - Fixed:
        - Now the name of the conflicting file is shown on the conflict-resolving dialogue.
        - Hidden files are now able to be merged again.
        - No longer error caused at plug-in being loaded.
    - Improved:
        - Caching chunks are now limited in total size of cached chunks.
- 0.17.25
    - Fixed:
        - Now reading error will be reported.
- 0.17.26
    - Fixed(Urgent):
        - The modified document will be reflected in the storage now.
- 0.17.27
    - Improved:
        - Now, the filename of the conflicted settings will be shown on the merging dialogue
        - The plugin data can be resolved when conflicted.
        - The semaphore status display has been changed to count only.
        - Applying to the storage will be concurrent with a few files.
- 0.17.28
  -Fixed:
    - Some messages have been refined.
    - Boot sequence has been speeded up.
    - Opening the local database multiple times in a short duration has been suppressed.
    - Older migration logic.
        - Note: If you have used 0.10.0 or lower and have not upgraded, you will need to run 0.17.27 or earlier once or reinstall Obsidian.
- 0.17.29
    - Fixed:
        - Requests of reading chunks online are now split into a reasonable(and configurable) size.
        - No longer error message will be shown on Linux devices with hidden file synchronisation.
    - Improved:
        - The interval of reading chunks online is now configurable.
        - Boot sequence has been speeded up, more.
    - Misc:
        - Messages on the boot sequence will now be more detailed. If you want to see them, please enable the verbose log.
        - Logs became be kept for 1000 lines while the verbose log is enabled.
- 0.17.30
    - Implemented:
        - `Resolve all conflicted files` has been implemented.
    - Fixed:
        - Fixed a problem about reading chunks online when a file has more chunks than the concurrency limit.
    - Rollbacked:
        - Logs are kept only for 100 lines, again.
- 0.17.31
    - Fixed:
        - Now `redflag3` can be run surely.
        - Synchronisation can now be aborted.
    - Note: The synchronisation flow has been rewritten drastically. Please do not haste to inform me if you have noticed anything.
- 0.17.32
    - Fixed:
        - Now periodic internal file scanning works well.
        - The handler of Window-visibility-changed has been fixed.
        - And minor fixes possibly included.
    - Refactored:
        - Unused logic has been removed.
        - Some utility functions have been moved into suitable files.
        - Function names have been renamed.
- 0.17.33
    - Maintenance update: Refactored; the responsibilities that `LocalDatabase` had were shared. (Hoping) No changes in behaviour.
- 0.17.34
    - Fixed: The `Fetch` that was broken at 0.17.33 has been fixed.
    - Refactored again: Internal file sync, plug-in sync and Set up URI have been moved into each file.

### 0.16.0

- Now hidden files need not be scanned. Changes will be detected automatically.
    - If you want it to back to its previous behaviour, please disable `Monitor changes to internal files`.
    - Due to using an internal API, this feature may become unusable with a major update. If this happens, please disable this once.

#### Minors

- 0.16.1 Added missing log updates.
- 0.16.2 Fixed many problems caused by combinations of `Sync On Save` and the tracking logic that changed at 0.15.6.
- 0.16.3
    - Fixed detection of IBM Cloudant (And if there are some issues, be fixed automatically).
    - A configuration information reporting tool has been implemented.
- 0.16.4 Fixed detection failure. Please set the `Chunk size` again when using a self-hosted database.
- 0.16.5
    - Fixed
        - Conflict detection and merging now be able to treat deleted files.
        - Logs while the boot-up sequence has been tidied up.
        - Fixed incorrect log entries.
    - New Feature
        - The feature of automatically deleting old expired metadata has been implemented.
          We can configure it in `Delete old metadata of deleted files on start-up` in the `General Settings` pane.
- 0.16.6
    - Fixed
        - Automatic (temporary) batch size adjustment has been restored to work correctly.
        - Chunk splitting has been backed to the previous behaviour for saving them correctly.
    - Improved
        - Corrupted chunks will be detected automatically.
        - Now on the case-insensitive system, `aaa.md` and `AAA.md` will be treated as the same file or path at applying changesets.
- 0.16.7 Nothing has been changed except toolsets, framework library, and as like them. Please inform me if something had been getting strange!
- 0.16.8 Now we can synchronise without `bad_request:invalid UTF-8 JSON` even while end-to-end encryption has been disabled.

Note:
Before 0.16.5, LiveSync had some issues making chunks. In this case, synchronisation had became been always failing after a corrupted one should be made. After 0.16.6, the corrupted chunk is automatically detected. Sorry for troubling you but please do `rebuild everything` when this plug-in notified so.

### 0.15.0

- Outdated configuration items have been removed.
- Setup wizard has been implemented!

I appreciate for reviewing and giving me advice @Pouhon158!

#### Minors

- 0.15.1 Missed the stylesheet.
- 0.15.2 The wizard has been improved and documented!
- 0.15.3 Fixed the issue about locking/unlocking remote database while rebuilding in the wizard.
- 0.15.4 Fixed issues about asynchronous processing (e.g., Conflict check or hidden file detection)
- 0.15.5 Add new features for setting Self-hosted LiveSync up more easier.
- 0.15.6 File tracking logic has been refined.
- 0.15.7 Fixed bug about renaming file.
- 0.15.8 Fixed bug about deleting empty directory, weird behaviour on boot-sequence on mobile devices.
- 0.15.9 Improved chunk retrieving, now chunks are retrieved in batch on continuous requests.
- 0.15.10 Fixed:
    - The boot sequence has been corrected and now boots smoothly.
    - Auto applying of batch save will be processed earlier than before.

### 0.14.1

- The target selecting filter was implemented.
  Now we can set what files are synchronised by regular expression.
- We can configure the size of chunks.
  We can use larger chunks to improve performance.
  (This feature can not be used with IBM Cloudant)
- Read chunks online.
  Now we can synchronise only metadata and retrieve chunks on demand. It reduces local database size and time for replication.
- Added this note.
- Use local chunks in preference to remote them if present,

#### Recommended configuration for Self-hosted CouchDB

- Set chunk size to around 100 to 250 (10MB - 25MB per chunk)
- _Set batch size to 100 and batch limit to 20 (0.14.2)_
- Be sure to `Read chunks online` checked.

#### Minors

- 0.14.2 Fixed issue about retrieving files if synchronisation has been interrupted or failed
- 0.14.3 New test items have been added to `Check database configuration`.
- 0.14.4 Fixed issue of importing configurations.
- 0.14.5 Auto chunk size adjusting implemented.
- 0.14.6 Change Target to ES2018
- 0.14.7 Refactor and fix typos.
- 0.14.8 Refactored again. There should be no change in behaviour, but please let me know if there is any.

### 0.13.0

- The metadata of the deleted files will be kept on the database by default. If you want to delete this as the previous version, please turn on `Delete metadata of deleted files.`. And, if you have upgraded from the older version, please ensure every device has been upgraded.
- Please turn on `Delete metadata of deleted files.` if you are using livesync-classroom or filesystem-livesync.
- We can see the history of deleted files.
- `Pick file to show` was renamed to `Pick a file to show.
- Files in the `Pick a file to show` are now ordered by their modified date descent.
- Update information became to be shown on the major upgrade.

#### Minors

- 0.13.1 Fixed on conflict resolution.
- 0.13.2 Fixed file deletion failures.
- 0.13.4
    - Now, we can synchronise hidden files that conflicted on each devices.
    - We can search for conflicting docs.
    - Pending processes can now be run at any time.
    - Performance improved on synchronising large numbers of files at once.
