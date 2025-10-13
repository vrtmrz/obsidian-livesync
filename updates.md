# 0.25

Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

<!--
## 0.25.22 (Upcoming)

### Notes
- The checking algorithm implemented in 0.25.20 is also raised as PR (#237). And completely I merged it manually.
  - Sorry for lacking merging this PR, and let me say thanks to the great contribution, @bioluks !

-->
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

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
