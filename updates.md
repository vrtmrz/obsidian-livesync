## 0.24.11

Peer-to-peer synchronisation has been implemented!

Until now, I have not provided a synchronisation server. More people may not even know that I have shut down the test server. I confess that this is a bit repetitive, but I confess it is a cautionary tale. This is out of a sense of self-discipline that someone has occurred who could see your data. Even if the 'someone' is me. I should not be unaware of its superiority, even though well-meaning and am a servant of all. (Half joking, but also serious).
However, now I can provide you with a signalling server. Because, to the best of my knowledge, it is only the network that is connected to your device.
Also, this signalling server is just a Nostr relay, not my implementation. You can run your implementation, which you consider trustworthy, on a trustworthy server. You do not even have to trust me. Mate, it is great, isn't it? For your information, strfry is running on my signalling server.

Nevertheless, that being said, to be more honest, I still have not decided what to do with this signalling server if too much traffic comes in.

Note: Already you have noticed this, but let me mention it again, this is a significantly large update. If you have noticed anything, please let me know. I will try to fix it as soon as possible (Some address is on my [profile](https://github.com/vrtmrz)).

## 0.24.21

### Fixed

- No longer conflicted files are handled in the boot-up process. No more unexpected overwriting.
    - It ignores `Always overwrite with a newer file`, and always be prevented for the safety. Please pick it manually or open the file.
- Some log messages on conflict resolution has been corrected.
- Automatic merge notifications, displayed on the grounds of `same`, have been degraded to logs.

### Improved

- Now we can fetch the remote database with keeping local files completely intact.
    - In new option, all files are stored into the local database before the fetching, and will be merged automatically or detected as conflicts.
- The dialogue presenting options when performing `Fetch` are now more informative.

### Refactored

- Some class methods have been fixed its arguments to be more consistent.
- Types have been defined for some conditional results.

## 0.24.20

### Improved

- Now we can see the detail of `TypeError` using Obsidian API during remote database access.

## 0.24.19

### New Feature

- Now we can generate a QR Code for transferring the configuration to another device.
    - This QR Code can be scanned by the camera app or something QR Code Reader of another device, and via Obsidian URL, the configuration will be transferred.
    - Note: This QR Code is not encrypted. So, please be careful when transferring the configuration.

## 0.24.18

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

Older notes are in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
