## 0.24.0

I know that we have been waiting for a long time. It is finally released!

Over the past three years since the inception of the plugin, various features have been implemented to address diverse user needs. This is truly honourable, and I am grateful for your years of support. However, this process has led to an increasingly disorganised codebase, with features becoming entangled. Consequently, this has led to a situation where bugs can go unnoticed and resolving one issue may inadvertently introduce another.

In 0.24.0, I reorganised the previously jumbled main codebase into clearly defined modules. Although I had assumed that the total size of the code would not increase, I discovered that it has in fact increased. While the complexity is still considerable, the refactoring has improved the clarity of the code's structure. Additionally, while testing the release candidates, we still found many bugs to fix, which helped to make this plug-in robust and stable. Therefore, we are now ready to use the updated plug-in, and in addition to that, proceed to the next step.

This is also the first step towards a fully-fledged-fancy LiveSync, not just a plug-in from Obsidian. Of course, it will still be a plug-in primarily and foremost, but this development marks a significant step towards the self-hosting concept.

Finally, I would like to once again express my respect and gratitude to all of you. My gratitude extends to all of the dev testers! Your contributions have certainly made the plug-in robust and stable!

Thank you, and I hope your troubles will be resolved!

---

## 0.24.11

Peer-to-peer synchronisation has been implemented!

Until now, I have not provided a synchronisation server. More people may not even know that I have shut down the test server. I confess that this is a bit repetitive, but I confess it is a cautionary tale. This is out of a sense of self-discipline that someone has occurred who could see your data. Even if the 'someone' is me. I should not be unaware of its superiority, even though well-meaning and am a servant of all.
However, now I can provide you with a signalling server. Because, to the best of my knowledge, it is only the network that is connected to your device.
Also, this signalling server is just a Nostr relay, not my implementation. You can run your implementation, which you consider trustworthy, on a trustworthy server. You do not even have to trust me. Mate, it is great, isn't it? For your information, strfry is running on my signalling server.

### Improved

- New Translation: `es` (Spanish) by @zeedif (Thank you so much)!
- Now all of messages can be selectable and copyable, also on the iPhone, iPad, and Android devices. Now we can copy or share the messages easily.
-

### New Feature

- Peer-to-Peer Synchronisation has been implemented!
    - This feature is still in early beta, and it is recommended to use it with caution.
    - However, it is a significant step towards the self-hosting concept. It is now possible to synchronise your data without using any remote database or storage. It is a direct connection between your devices.
    - Note: We should keep the device online to synchronise the data. It is not a background synchronisation. Also it needs a signalling server to establish the connection. But, the signalling server is used only for establishing the connection, and it does not store any data.
    -

### Fixed

- No longer memory or resource leaks when the plug-in is disabled.
- Now deleted chunks are correctly detected on conflict resolution, and we are guided to resurrect them.
- Hanging issue during the initial synchronisation has been fixed.
- Some unnecessary logs have been removed.

### Refactor

- Several interfaces have been moved to the separated library.
- Translations have been moved to each language file, and during the build, they are merged into one file.
- Non-mobile friendly code has been removed and replaced with the safer code.
    - (Now a days, mostly server-side engine can use webcrypto, so it will be rewritten in the future more).
- Started writing Platform impedance-matching-layer.
- Svelte has been updated to v5.

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

Older notes are in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
