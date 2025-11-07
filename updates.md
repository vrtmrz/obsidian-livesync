# 0.25

Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

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

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
