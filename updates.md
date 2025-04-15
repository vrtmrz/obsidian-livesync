## 0.24.11

Peer-to-peer synchronisation has been implemented!

Until now, I have not provided a synchronisation server. More people may not even know that I have shut down the test server. I confess that this is a bit repetitive, but I confess it is a cautionary tale. This is out of a sense of self-discipline that someone has occurred who could see your data. Even if the 'someone' is me. I should not be unaware of its superiority, even though well-meaning and am a servant of all. (Half joking, but also serious).
However, now I can provide you with a signalling server. Because, to the best of my knowledge, it is only the network that is connected to your device.
Also, this signalling server is just a Nostr relay, not my implementation. You can run your implementation, which you consider trustworthy, on a trustworthy server. You do not even have to trust me. Mate, it is great, isn't it? For your information, strfry is running on my signalling server.

Nevertheless, that being said, to be more honest, I still have not decided what to do with this signalling server if too much traffic comes in.

Note: Already you have noticed this, but let me mention it again, this is a significantly large update. If you have noticed anything, please let me know. I will try to fix it as soon as possible (Some address is on my [profile](https://github.com/vrtmrz)).

## 0.24.24

### Fixed

- No longer broken JSON files including `\n`, during the bucket synchronisation. (#623)
- Custom headers and JWT tokens are now correctly sent to the server during configuration checking. (#624)

### Improved

- Bucket synchronisation has been enhanced for better performance and reliability.
    - Now less duplicated chunks are sent to the server.
      Note: If you have encountered about too less chunks, please let me know. However, you can send it to the server by `Overwrite remote`.
    - Fetching conflicted files from the server is now more reliable.
    - Dependent libraries have been updated to the latest version.
      - Also, let me know if you have encountered any issues with this update. Especially you are using a device that has been in use for a little longer.

## 0.24.23

### New Feature

- Now, we can send custom headers to the server.
    - They can be sent to either CouchDB or Object Storage.
- Authentication with JWT in CouchDB is now supported.
    - I will describe steps later, but please refer to the [CouchDB document](https://docs.couchdb.org/en/stable/config/auth.html#authentication-configuration).
    - A JWT keypair for testing can be generated in the setting dialogue.

### Improved

- The QR Code for set-up can be shown also from the setting dialogue now.
- Conflict checking for preventing unexpected overwriting on the boot-up process has been quite faster.

### Fixed

- Some bugs on Dev and Testing modules have been fixed.

## 0.24.22 ~~0.24.21~~

(Really sorry for the confusion. I have got a miss at releasing...).

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

Older notes are in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
