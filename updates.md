# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 0.25 release history and the legacy release history.

## Unreleased

## 1.0.0-rc.0

27th July, 2026

The work towards 1.0 has become so substantial that I have written [an article about it](https://fancy-syncing.vrtmrz.net/blog/0036-livesync-1_0_0-en.html) (linked again here).

### Important

- This is the first 1.0 release candidate. It remains an opt-in pre-release for BRAT validation and does not replace the latest stable release. Update every participating device before resuming synchronisation, and continue to use a current backup while testing with an existing Vault.
- An upgraded, copied, or restored Vault may pause replication for an explicit compatibility review. Existing automatic synchronisation choices are preserved and resume only after the decision has been saved.

### Changes consolidated from beta.0 through beta.5

#### Setup and compatibility

- An unconfigured Vault now waits for the user to start setup. Onboarding is offered through a persistent Notice and remains available from **Self-hosted LiveSync settings** → **Setup**.
- Setup now creates named CouchDB, Object Storage, and P2P connections. Setup URIs preserve their connection names and selections, and reserve Fetch or Rebuild before the ordinary start-up scan begins.
- Existing Vaults retain their effective legacy settings, including the case-insensitive file-name fallback used when an older release had no explicit case setting.
- Manual CouchDB setup distinguishes creating the first database from connecting another device. Onboarding requires a successful connection, while Settings can explicitly save an unverified connection and offers each server-setting correction separately.
- Compatible differences limited to the chunk hash algorithm, chunk size, or splitter version are aligned automatically by default. Existing chunks remain readable, an explicit opt-out remains available, and differences involving incompatible settings still require review.

#### Conflict handling and recovery

- Automatic text and structured-data merge now uses the nearest revision actually shared by both branches. A resolution received from another device no longer recreates the same conflict merely because the Vault still contains the exact content of the removed branch.
- Edits, logical deletions, and renames made while a file remains conflicted extend the revision displayed on that device. When the relationship cannot be proved, LiveSync preserves the branches for review.
- **Not now** postpones repeated automatic merge dialogues while retaining the unresolved-conflict warning. Three or more live revisions are reviewed one reproducible pair at a time, completed pairs remain resolved across restart, and explicit commands can reopen a postponed conflict.
- **Inspect conflicts and file/database differences** compares the Vault with the database winner and every live conflict revision. Compact indicators show missing chunks, `Δsize`, `Δtime`, whether the Vault matches the winner, and whether conflicts remain.
- Each reported file and live revision has a compact wrench menu for comparison, applying an exact readable revision, recording an exact byte match, storing the Vault content as a child of a selected branch, retrying missing chunks without changing the tree, or explicitly discarding one selected live branch.
- Unreadable live revisions are preserved during automatic handling. An absent Vault file and a winning logical deletion are treated as agreement unless another live branch still requires attention.
- Garbage Collection V3 is limited to CouchDB and now protects every live conflict branch, required shared ancestry, and shared chunks. It stops when device progress cannot be verified and reports compaction failure without a contradictory success message.

#### P2P and optional synchronisation features

- P2P and Hidden File Sync remain supported opt-in features. Customisation Sync remains a supported Advanced workflow, while Data Compression remains available but disabled by default.
- P2P controls remain outside the ordinary CouchDB experience until P2P is configured. The current status pane distinguishes announcing changes, following a peer, and persistent per-device actions.
- First-device P2P setup can complete its signalling test without another peer online. Fetch on an additional device still requires an available source peer and a completed P2P Rebuild.
- P2P setup and guidance now distinguish the required signalling relay from optional TURN, describe the replaceable public relay's privacy and availability limits, and reliably close and recreate relay connections across settings changes and database resets.
- Enabling Hidden File Sync opens one progress Notice before saving the setting and reuses it until the initial scan has finished instead of stacking phase, reload, and restart messages.
- Broadening selectors, ignore rules, size or modification-time limits, or file-name case handling now rechecks previously received files without requiring another remote update.

#### Interface and operations

- Command-palette actions now use clearer names and appear only when their feature and current context make them usable. Renamed commands retain their identifiers so that existing hotkeys continue to work.
- Setup and review dialogue text can be selected for copying or translation. Applying an available interface translation no longer holds start-up behind an unsolicited dialogue; a persistent Notice opens the existing details on demand.
- Action buttons are arranged for narrow mobile screens, long dialogues keep their controls reachable, and persistent Notices no longer cover close controls.
- Remote-size warnings use persistent clickable Notices. Initial uploads and Rebuild no longer ask to send every chunk in advance; ordinary replication completes the transfer.
- Obsolete controls for the plug-in trash setting and fixed chunk revisions were removed. The Change Log remains available but no longer opens automatically or tracks an unread count.

#### Other fixes and security

- The optional Custom HTTP Handler used by Object Storage sends the correct byte range from binary request bodies and reports unsupported body types instead of silently sending an empty request.
- Fly.io setup generates CouchDB and Vault encryption secrets with cryptographically secure randomness. Dependency updates address excessive CPU use from crafted path patterns and `mailto:` links, and the CLI rejects detected path traversal and symbolic-link components before Vault operations.
- Self-hosted LiveSync now owns its translation catalogue. Commonlib supplies canonical English to other consumers, while translation contributions can be made in the main Self-hosted LiveSync repository.

### Changes since beta.5

- The Hatch action for **Inspect conflicts and file/database differences** is now labelled **Begin inspection** so that its purpose is clear without repeating the setting name.
- Start-up and full-inspection scans now omit built-in legacy LiveSync log files and recovery flag files before comparing Vault and local-database state. Existing ignored database records remain untouched, and user-configured ignore behaviour is unchanged.

### Testing

- Expanded automated Real Obsidian coverage for upgrades, two-device synchronisation, CouchDB, Object Storage, P2P, Hidden File Sync, mobile dialogues, conflict and revision recovery, failure diagnostics, and strict clean-up.
- Real CouchDB integration coverage verifies logical deletion, shared and conflict chunk retention, compaction, downstream replication, and recreation of content-addressed chunks.
- An encrypted Real Obsidian reconnect scenario replaces the remote Security Seed while one client retains the previous value, verifies that synchronisation adopts the replacement without restoring the old value, and proves a bidirectional encrypted round-trip.
- The beta series was exercised through BRAT on macOS, iOS, and Android, including upgrade from 0.25.83, bidirectional synchronisation, P2P setup, conflict handling, recovery controls, mobile layouts, and start-up with existing configurations. The exact RC artefact will be validated separately after publication.

## 1.0.0-beta.5

26th July, 2026

### Improved

- **Inspect conflicts and file/database differences** now compares the current Vault file with the database winner and every live conflict revision. Compact, mobile-friendly indicators show missing chunks, `Δsize`, `Δtime`, whether the Vault matches the winner, and whether conflict branches remain.
- Each reported file and live revision now has a compact wrench menu. Its available actions can compare readable text, apply the selected revision to the Vault, record an exact byte match, store the Vault content as a child of the selected branch, retry retrieving missing chunks without changing the revision tree, or discard only the selected live branch after confirmation.

### Fixed

- A winning logical deletion is no longer reported as a missing Vault file when the file is already absent.

### Testing

- Strengthened Real Obsidian coverage for start-up with an existing configuration, Security Seed readiness, failure diagnostics, and P2P status pane placement in separate desktop and mobile sessions.

## 1.0.0-beta.4

25th July, 2026

### Improved

- **Verify and repair all files** now reports the database winner, every conflict revision, missing chunks, and unavailable shared ancestors separately. It can retry an exact revision without changing the tree, while discarding an unreadable live revision requires explicit confirmation.
- Command-palette actions now use clearer names and appear only when their feature and current context make them usable. Renamed commands keep their identifiers, so hotkeys already assigned to them continue to work. The onboarding wizard can be reopened from **Self-hosted LiveSync settings** → **Setup**.
- Text in setup and review dialogues can now be selected for copying or translation.
- When LiveSync adopts an available interface translation on first start-up, it now continues initialisation and leaves a persistent Notice from which the translation details can be opened, instead of waiting for an unsolicited dialogue.

### Fixed

- An unreadable conflict revision is no longer deleted automatically merely because its chunks are unavailable on the current device.
- Garbage Collection V3 now protects chunks required by every live conflict branch and the available revision ancestry needed to review and merge conflicts, instead of considering only the database winner. The action is offered only for CouchDB because P2P has no central database to compact and does not provide the device inventory required by the workflow. Collection now stops when device progress cannot be verified, and a compaction timeout is no longer followed by a contradictory success message.

### Testing

- Added regressions for revision repair, command availability, selectable dialogues, conflict-aware chunk reachability, device-progress safeguards, and compaction timeouts.
- Added a real CouchDB integration test for logical chunk deletion, shared and conflict chunk retention, compaction completion, downstream replication, and content-addressed chunk recreation.
- Added a real Obsidian encrypted reconnect scenario which replaces the remote Security Seed while one client retains the previous value, verifies that synchronisation refreshes it without restoring the old value, and proves a bidirectional encrypted round-trip.

## 1.0.0-beta.3

24th July, 2026

### Improved

- Enabling Hidden File Sync now opens one progress Notice before its setting is saved and reuses that Notice throughout the initial file scan, instead of stacking separate phase and restart Notices.
- P2P is now presented only after it has been configured: its status pane no longer opens at start-up, its ribbon icon remains hidden for CouchDB-only Vaults, and the retired P2P pane command has been removed. The current pane distinguishes announcing changes, following a peer, and persistent per-device actions. Setup and guidance now distinguish the required signalling relay from optional TURN, and describe the public signalling relay's privacy and availability limits.
- First-device P2P setup now accepts a successfully opened signalling room without requiring another peer to be online. Additional-device Fetch still requires selecting a source peer and completing `P2P Rebuild`.
- Manual CouchDB setup now distinguishes creating a first database from connecting an additional device to an existing one. Settings mode can save an unverified profile explicitly, while onboarding requires a successful connection, and each proposed server-configuration fix requires separate confirmation.
- Differences limited to the chunk hash algorithm, chunk size, or splitter version are now aligned automatically by default. Existing content remains readable, while an explicit opt-out and any difference which also involves an incompatible setting retain manual review.

### Fixed

- Choosing **Apply settings to this device, and fetch again** for a compatible configuration mismatch now applies the remote settings before Fetch, instead of updating the remote database with this device's settings.
- Accepted settings which control how new chunks are created now take effect before synchronisation is retried, rather than leaving the previous hash or splitter active until restart.

### Testing

- Added regressions for P2P configuration, the distinction between setting up the first device and using Fetch on an additional device, the P2P status pane, CouchDB setup policy, and mobile dialogues.

## 1.0.0-beta.2

23rd July, 2026

### Improved

- Choosing **Not now** on a merge conflict now postpones repeated dialogues for that conflict while the active file retains an unresolved-conflict warning. Three or more live versions show their current count and are reviewed one deterministic pair at a time; completed pairs remain resolved across restart. The existing conflict commands can reopen a postponed conflict explicitly, and a later conflict prompts again after the current one has been resolved.

### Fixed

- Answering or externally closing a merge dialogue immediately no longer leaves conflict processing waiting for a response which has already occurred.

### Testing

- Added revision-tree regressions and focused real-Obsidian scenarios for multiple-version review and restart between resolution stages.

## 1.0.0-beta.1

22nd July, 2026

### Important

- This corrected opt-in integration preview follows `1.0.0-beta.0` and does not replace the latest stable release. Update every participating device before resuming synchronisation, and continue to use a current backup while testing with an existing Vault.

### Fixed

- Conflict resolutions made on another device no longer recreate the same conflict when the receiving Vault still contains the exact content of the deleted losing revision. Automatic text and structured-data merge now uses the nearest revision actually shared by both branches instead of inferring ancestry from revision generation numbers.
- Edits, deletions, and renames made while a file is conflicted now extend the exact revision displayed on that device. If LiveSync cannot prove the displayed branch, it preserves the affected branches for review instead of silently applying the operation to the database winner.

### Testing

- Added revision-tree regressions and focused real-Obsidian scenarios for propagated resolutions and file operations performed while a conflict remains active.

## 1.0.0-beta.0

22nd July, 2026

### Important

- This is an opt-in 1.0 integration preview for BRAT and testing with existing Vaults. It does not replace the latest stable release. Use it with a current backup, and update every participating device before resuming synchronisation.
- An upgraded, copied, or restored Vault may pause replication for an explicit compatibility review. The review preserves the existing automatic synchronisation choices and resumes them only after the decision has been saved successfully.

### Improved

- An unconfigured installation now waits for you to start setup. A long-lived Notice offers the setup action, and **Open onboarding wizard** remains available from the command palette instead of the dialogue opening automatically.
- The setup wizard now creates named remote profiles for CouchDB, Object Storage, and P2P. Current Setup URIs preserve their profile names and selections, and the wizard reserves Rebuild or Fetch before the ordinary start-up scan begins.
- Peer-to-Peer Synchronisation (P2P) and Hidden File Sync are supported opt-in features. JWT authentication, ignore files, automatic newer-file conflict resolution, and Garbage Collection V3 remain previews. Customisation Sync remains a supported advanced workflow.
- Data Compression remains available after measurement showed a modest, workload-dependent reduction in stored and transferred chunk data. Its benefits, costs, and reason for remaining disabled by default in 1.0 are described in the Data Compression specification.
- Compatibility review now runs before Config Doctor without overlapping it. Existing Vaults retain their automatic synchronisation choices and explicit file-name case setting. For installations created by earlier releases, LiveSync preserves whether setup had been completed and saves a missing legacy case setting as case-insensitive.
- P2P connections now restart reliably after settings are reapplied or the local database is reset. Setup on an additional device asks you to select the source device once. Disconnecting leaves the LiveSync room and closes its signalling relay connections so that reconnecting can establish a new room.
- Action buttons are stacked vertically, long setup dialogues keep their controls reachable on mobile screens, and persistent Notices no longer cover close controls. Hidden File Sync reload and restart requests are grouped into one message, including the case reported in issue #555.
- Warnings about estimated remote storage size now appear as long-lived clickable Notices instead of timed dialogues. Initial uploads and Rebuild operations no longer prompt to send every chunk in advance; ordinary replication completes the transfer.
- Removed the obsolete **Use the trash bin** control and the setting for fixed chunk revisions. Remote deletion still follows Obsidian's preference, and chunk revisions remain content-derived. The Change Log remains available but no longer opens automatically or tracks unread versions.

### Fixed

- The optional Custom HTTP Handler used by Object Storage now sends the correct byte range from binary request bodies and reports unsupported body types instead of silently sending an empty request.
- When selectors, ignore files, size limits, modification-time limits, or file-name case settings are broadened, LiveSync now rechecks previously received files without requiring another remote update.
- P2P setup on the first device no longer displays reset or upload steps for a central database, and Config Doctor now offers its chunk size recommendation for CouchDB only when a CouchDB remote profile is selected.

### Security

- Fly.io setup now generates CouchDB and Vault encryption secrets with cryptographically secure randomness. Dependency updates prevent excessive CPU use from specially crafted path patterns and `mailto:` links. The CLI rejects path traversal and symbolic-link components detected before Vault operations.

### Miscellaneous

- Self-hosted LiveSync now owns its translation catalogue. Commonlib provides English messages to other applications, and translation contributions can be made directly to the Self-hosted LiveSync repository.

### Testing

- Expanded automated testing in Obsidian for upgrades, synchronisation between two devices, CouchDB, Object Storage, P2P, Hidden File Sync, mobile dialogues, and clean-up after failures.
