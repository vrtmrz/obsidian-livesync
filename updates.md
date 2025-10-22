# 0.25

Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## 0.25.23.beta1

22nd October, 2025

Since several issues were pointed out, our setup procedure had been quite `system-oriented`. This is not good for users. Therefore, I have changed the procedure to be more `goal-oriented`. I have made extensive use of Svelte, resulting in a very straightforward setup.
While I would like to accelerate documentation and i18n adoption, I do not want to confuse everyone who's already working on it. Therefore, I have decided to release a Beta version at this stage. Significant changes are not expected from this point onward, so I will proceed to stabilise the codebase. (However, this is significant).

### Fixed (This should be backported to 0.25.22 if the beta phase is prolonged)

- No longer will larger files create chunks during preparing `Reset Synchronisation on This Device`.

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

## 0.25.23.beta1

22nd October, 2025

Since several issues pointed, our set-up procedure had been quite `system-oriented`. This is not good for users. Therefore, I have changed the procedure to be more `goal-oriented`. I have made extensive use of Svelte, resulting in a very straightforward setup.
While I would like to accelerate documentation and i18n adoption, I do not want to confuse everyone who's already working on it. Therefore, I have decided to release a Beta version at this stage. Significant changes are not expected from this point onward, so I will proceed to stabilise the codebase. (However, this is the significant).

### Fixed (This should be backported to 0.25.22 if the beta phase is prolonged)

- No longer larger files will not create a chunks during preparing `Reset Synchronisation on This Device`.

### Behaviour changes

- Setup wizard is now more `goal-oriented`. Brand-new screens are introduced.
- `Fetch everything` and `Rebuild everything` is now `Reset Synchronisation on This Device` and `Overwrite Server Data with This Device's Files`.
- Remote configuration and E2EE settings are now separated to each modal dialogue.
    - Remote configuration is now more straightforward. And if we need the rebuild (No... `Overwrite Server Data with This Device's Files`), it is now clearly indicated.
- Peer-to-Peer settings is also separated into its own modal dialogue (still in progress, and we need to open a P2P pane, still).
- Setup-URI, and Report for the Issue are now not copied to clipboard automatically. Instead, there are copy dialogue and buttons to copy them explicitly.
    - This is to avoid confusion for users who do not want to use these features.
- No longer optional features are introduced during the setup or `Reset Synchronisation on This Device`, `Overwrite Server Data with This Device's Files`.
    - This is to avoid confusion for users who do not want to use these features. Instead, we will noticed that optional features are available after the setup is completed.
- We cannot preform `Fetch everything` and `Rebuild everything` (Removed, so the old name) without restarting Obsidian now.

### Miscellaneous

- Setup QR Code generation is separated into a src/lib/src/API/processSetting.ts file. Please use it as a subrepository if you want to generate QR codes in your own application.
- Setup-URI is also separated into a src/lib/src/API/processSetting.ts
- Some direct access to web-APIs are now wrapped into the services layer.

### Dependency updates

- Many dependencies are updated. Please see `package.json`.
    - This is the hardest part of this update. I read mostly all changes in the dependencies. If you find any extra information, please let me know.
- As upgrading TypeScript, Fixed many UInt8Array<ArrayBuffer> and Uint8Array type mismatches.

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

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
