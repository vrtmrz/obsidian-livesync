## 0.24.11

Peer-to-peer synchronisation has been implemented!

Until now, I have not provided a synchronisation server. More people may not even know that I have shut down the test server. I confess that this is a bit repetitive, but I confess it is a cautionary tale. This is out of a sense of self-discipline that someone has occurred who could see your data. Even if the 'someone' is me. I should not be unaware of its superiority, even though well-meaning and am a servant of all. (Half joking, but also serious).
However, now I can provide you with a signalling server. Because, to the best of my knowledge, it is only the network that is connected to your device.
Also, this signalling server is just a Nostr relay, not my implementation. You can run your implementation, which you consider trustworthy, on a trustworthy server. You do not even have to trust me. Mate, it is great, isn't it? For your information, strfry is running on my signalling server.

Nevertheless, that being said, to be more honest, I still have not decided what to do with this signalling server if too much traffic comes in.

Note: Already you have noticed this, but let me mention it again, this is a significantly large update. If you have noticed anything, please let me know. I will try to fix it as soon as possible (Some address is on my [profile](https://github.com/vrtmrz)).

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

Older notes are in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
