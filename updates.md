# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 0.25 release history and the legacy release history.

## Unreleased

### Improved

- **Verify and repair all files** now reports the database winner, every conflict revision, missing chunks, and unavailable shared ancestors separately. It can retry an exact revision without changing the tree, while discarding an unreadable live revision requires explicit confirmation.
- Command-palette actions now use clearer names and appear only when their feature and current context make them usable. Renamed commands keep their identifiers, so hotkeys already assigned to them continue to work. The onboarding wizard can be reopened from **Self-hosted LiveSync settings** → **Setup**.
- Enabling Hidden File Sync now opens one progress Notice before its setting is saved and reuses that Notice throughout the initial file scan, instead of stacking separate phase and restart Notices.
- P2P is now presented only after it has been configured: its status pane no longer opens at start-up, its ribbon icon remains hidden for CouchDB-only Vaults, and the retired P2P pane command has been removed. The current pane distinguishes announcing changes, following a peer, and persistent per-device actions. Setup and guidance now distinguish the required signalling relay from optional TURN, and describe the public signalling relay's privacy and availability limits.
- First-device P2P setup now accepts a successfully opened signalling room without requiring another peer to be online. Additional-device Fetch still requires selecting a source peer and completing `P2P Rebuild`.
- Manual CouchDB setup now distinguishes creating a first database from connecting an additional device to an existing one. Settings mode can save an unverified profile explicitly, while onboarding requires a successful connection, and each proposed server-configuration fix requires separate confirmation.
- Differences limited to the chunk hash algorithm, chunk size, or splitter version are now aligned automatically by default. Existing content remains readable, while an explicit opt-out and any difference which also involves an incompatible setting retain manual review.

### Fixed

- An unreadable conflict revision is no longer deleted automatically merely because its chunks are unavailable on the current device.
- Garbage Collection V3 now protects chunks required by every live conflict branch and the available revision ancestry needed to review and merge conflicts, instead of considering only the database winner. The action is offered only for CouchDB because P2P has no central database to compact and does not provide the device inventory required by the workflow.
- Choosing **Apply settings to this device, and fetch again** for a compatible configuration mismatch now applies the remote settings before Fetch, instead of updating the remote database with this device's settings.
- Accepted settings which control how new chunks are created now take effect before synchronisation is retried, rather than leaving the previous hash or splitter active until restart.

### Testing

- Added regressions for revision repair, P2P configuration, the distinction between setting up the first device and using Fetch on an additional device, the P2P status pane, CouchDB setup policy, mobile dialogues, conflict-aware chunk reachability, shared chunks, collection propagation, and content-addressed chunk recreation.

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
