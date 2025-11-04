# 0.25

Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

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

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
