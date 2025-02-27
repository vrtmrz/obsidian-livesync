## 0.24.11

Peer-to-peer synchronisation has been implemented!

Until now, I have not provided a synchronisation server. More people may not even know that I have shut down the test server. I confess that this is a bit repetitive, but I confess it is a cautionary tale. This is out of a sense of self-discipline that someone has occurred who could see your data. Even if the 'someone' is me. I should not be unaware of its superiority, even though well-meaning and am a servant of all. (Half joking, but also serious).
However, now I can provide you with a signalling server. Because, to the best of my knowledge, it is only the network that is connected to your device.
Also, this signalling server is just a Nostr relay, not my implementation. You can run your implementation, which you consider trustworthy, on a trustworthy server. You do not even have to trust me. Mate, it is great, isn't it? For your information, strfry is running on my signalling server.

Nevertheless, that being said, to be more honest, I still have not decided what to do with this signalling server if too much traffic comes in.

Note: Already you have noticed this, but let me mention it again, this is a significantly large update. If you have noticed anything, please let me know. I will try to fix it as soon as possible (Some address is on my [profile](https://github.com/vrtmrz)).

## 0.24.17

Confession. I got the default values wrong. So scary and sorry.

### Behaviour and default changed

- **NOW INDEED AND ACTUALLY** `Compute revisions for chunks` are backed into enabled again. it is necessary for garbage collection of chunks.
    - As far as existing users are concerned, this will not automatically change, but the Doctor will inform us.


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

Older notes are in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
