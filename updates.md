## 0.25

Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

After reading Issue #668, I conducted another self-review of the E2EE-related code. In retrospect, it was clearly written by someone inexperienced, which is understandable, but it is still rather embarrassing. Three years is certainly enough time for growth.

I have now rewritten the E2EE code to be more robust and easier to understand. It is significantly more readable and should be easier to maintain in the future. The performance issue, previously considered a concern, has been addressed by introducing a master key and deriving keys using HKDF. This approach is both fast and robust, and it provides protection against rainbow table attacks. (In addition, this implementation has been [a dedicated package on the npm registry](https://github.com/vrtmrz/octagonal-wheels), and tested in 100% branch-coverage).

As a result, this is the first time in a while that forward compatibility has been broken. We have also taken the opportunity to change all metadata to use encryption rather than obfuscation. Furthermore, the `Dynamic Iteration Count` setting is now redundant and has been moved to the `Patches` pane in the settings. Thanks to Rabin-Karp, the eden setting is also no longer necessary and has been relocated accordingly. Therefore, v0.25.0 represents a legitimate and correct evolution.

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


Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
