# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 0.25 release history and the legacy release history.

## Unreleased

### Synchronisation and storage

#### Fixed

- Start-up and recovery scans now keep failed database-to-Vault writes retryable instead of recording them as successful and later mistaking the still-missing file for a local deletion ([Commonlib PR #106](https://github.com/vrtmrz/livesync-commonlib/pull/106)).
    - Files over the size limit or in conflict remain deliberate skips, while actual write failures are reported to Fast Setup, CLI mirror, and daemon callers.

## 1.0.11

9th August, 2026

### Setup and compatibility

#### Fixed

- Fast Setup now uses Standard Fetch when CouchDB's 'Use Internal API' setting is enabled, avoiding a streaming request path which Obsidian's buffered API cannot support (#1020).
    - Custom headers alone continue to use Fast Fetch when browser CORS permits them; Standard Fetch clears any obsolete Fast Fetch checkpoint after resetting the local database.

### Synchronisation and storage

#### Fixed

- Fractional file timestamps no longer cause affected mobile clients to crash after synchronisation (#1087, PR #1039). Thank you to @andrewleech for the contribution!
    - Timestamps are now normalised in the command-line tool and before Obsidian's native file-system writes.

## 1.0.10

9th August, 2026

### Setup and compatibility

#### Fixed

- Fast Setup now sends configured CouchDB custom headers with every changes-feed request, allowing reverse proxies such as Cloudflare Access to authenticate initial setup in the same way as ordinary synchronisation ([Commonlib PR #82](https://github.com/vrtmrz/livesync-commonlib/pull/82)). Thank you to @nimula for the contribution!

## 1.0.9

8th August, 2026

For the first time in a while, I published a release that could not be promoted to a stable release. Sorry about that! I am glad that we caught it while it was still a pre-release.

### Setup and compatibility

#### Fixed

- Multi-part settings QR codes now preserve special characters in passwords, passphrases, and other settings (PR #1083). Thank you to @calvinbui for the improvement!
- Fast Setup now sizes each finite CouchDB changes page from a one-row status probe, counts the returned result together with `pending`, and resumes from the page's opaque `last_seq` without comparing token representations. Each page uses a one-second idle timeout instead of a heartbeat, allowing CouchDB 3.2 to return its terminator after the currently available rows have been persisted.

## 1.0.8

8th August, 2026

This version was published for pre-release validation only and was not promoted to a stable release.

### Setup and compatibility

#### Fixed

- Fast Setup now sizes each finite CouchDB changes page from a one-row status probe, counts the returned result together with `pending`, and resumes from the page's opaque `last_seq` without comparing token representations. Heartbeat-enabled feeds no longer wait for future writes after the currently available rows have been persisted (#1065).
- Cancelling remote selection during a scheduled Fetch now removes the Fetch flag before restarting with file and database reflection paused, preventing the same selection dialogue from reopening on every start-up.

## 1.0.7

8th August, 2026

### Setup and compatibility

#### Fixed

- Fast Setup now completes only after the captured CouchDB changes target has been persisted. Decryption, protocol, and local write failures stop the operation without finalising an incomplete database, while transient interruptions resume from the last durable checkpoint (#1065).

## 1.0.6

6th August, 2026

I know that onboarding, and other parts which feel unclear or confusing, still need improvement. Please do report any such cases.

### Setup and compatibility

#### Fixed

- Initial setup now distinguishes an empty remote with no saved synchronisation settings from a failed remote read. New remotes can use this device's settings without an unnecessary retry; Fetch pauses on unreadable settings, while Rebuild can explicitly continue with this device's settings. Cancelling preserves the selected automatic synchronisation mode and restarts with Vault and database reflection paused (#1064). Thank you to @mateus2k2 for the follow-up report!

## 1.0.5

5th August, 2026

### Synchronisation and storage

#### Improved

- Added settings to control whether finite synchronisation operations keep the screen awake. Desktop devices now allow automatic sleep by default, while mobile devices retain screen-awake protection unless the general option is enabled (#1073).

### Interface and translation

#### Improved

- Korean translations now cover the complete current catalogue across Setup, P2P, remote configuration, diagnostics, and maintenance (PR #1075). Thank you to @motolies for the improvement!

#### Fixed

- The in-editor LiveSync status on iOS now remains below the view-header controls instead of overlapping them (PR #1067). Thank you to @Hsiii for the improvement!

## 1.0.4

5th August, 2026

### Synchronisation and storage

#### Fixed

- Testing or saving a fresh remote configuration no longer tries to access the local database while constructing a replicator, avoiding 'Local database is not ready yet' failures before local database initialisation (#1064).

### Command-line tool

#### Fixed

- Successful setup and remote-configuration commands now retain their settings changes. Other commands leave the settings file unchanged unless `--write-settings` is supplied, and temporary CLI suspension values are never written (#1070).

## 1.0.3

3rd August, 2026

### Synchronisation and storage

#### Fixed

- File consistency checks no longer read older revisions after the current Vault content matches known synchronised history, avoiding unnecessary 'Missing document content' warnings from obsolete unreadable revisions.
- Remote chunk fetching now retains chunks which were returned successfully when another chunk in the same request is unavailable, so the available content can still be processed (#771).

### Interface

#### Fixed

- The Remediation setting now displays its configured modification-time limit without raising a `HierarchyRequestError`.

## 1.0.2

31st July, 2026

I am aware that some of the Community Directory review checks have become a little more sensitive again. I will watch them for a little longer, then consider the most appropriate way to adapt.

### Synchronisation and storage

#### Improved

- Downloaded document batches retain best-effort screen-awake and lifecycle protection until every queued file has been applied to local storage, without extending the remote-activity indicator (#1031, PR #1032). Thank you to @apple-ouyang for the improvement!

#### Fixed

- Leading UTF-8 byte order marks are preserved during Vault ingestion, keeping stored content sizes consistent with file metadata and preventing persistent three-byte integrity mismatches (#1056, PR #1058).

### Interface and translation

#### Improved

- Document History now provides previous and next revision controls, reports the current revision position, and disables navigation at the oldest and newest boundaries without changing search-result navigation (#990, PR #1009). Thank you to @SeleiXi for the improvement!
- Remaining user-visible text in Setup, P2P, Customisation Sync, Global History, JSON conflict handling, and remote configuration now uses the translation catalogue (PR #1015). Thank you to @zeedif for the improvement!
- Korean translations have broader coverage and corrections for placeholders, punctuation, and established terminology (PR #1055). Thank you to @motolies for the improvement!
- Spanish translation coverage has been expanded across settings, Setup, P2P, maintenance, and newly catalogued interface text (PR #1059). Thank you to @zeedif for the improvement!

### Command-line tool

#### Fixed

- Large-buffer base64 encoding under Node.js now uses the published `octagonal-wheels` fallback when `FileReader` is unavailable, including correctly handling sliced binary views (#1036, PR #1060; [Fancy Kit PR #44](https://github.com/vrtmrz/fancy-kit/pull/44)).

## 1.0.1

29th July, 2026

I am taking this opportunity to update the experimental features as well.

This maintenance release mainly improves the robustness and maintainability of the experimental WebApp, WebPeer, and shared dialogue composition. Most plug-in users can skip it. I have reviewed the changes through CI and a real Obsidian instance, and I will validate the exact published build before merging the release commit.

### Interface

#### Improved

- Removed a custom positioning workaround from the onboarding Notice so that it follows Obsidian's standard placement and dismissal behaviour.
- WebApp now points users to **Scan local files** when automatic file observation is unavailable, instead of relying on a fixed browser-version recommendation.

## 1.0.0

27th July, 2026

The work towards 1.0 has become so substantial that I have written [an article about it](https://fancy-syncing.vrtmrz.net/blog/0036-livesync-1_0_0-en.html) (linked again here).

### Setup and compatibility

#### Improved

- An unconfigured Vault now waits for the user to start setup. Onboarding is offered through a persistent Notice and remains available from **Self-hosted LiveSync settings** → **Setup**.
- Setup now creates named CouchDB, Object Storage, and P2P connections. Setup URIs preserve their connection names and selections, and reserve Fetch or Rebuild before the ordinary start-up scan begins.
- Manual CouchDB setup distinguishes creating the first database from connecting another device. Onboarding requires a successful connection, while Settings can explicitly save an unverified connection and offers each server-setting correction separately.
- Compatible differences limited to the chunk hash algorithm, chunk size, or splitter version are aligned automatically by default. Existing chunks remain readable, an explicit opt-out remains available, and differences involving incompatible settings still require review.

#### Fixed

- Existing Vaults retain their effective legacy settings, including the case-insensitive file-name fallback used when an older release had no explicit case setting.

#### Security

- Fly.io setup generates CouchDB and Vault encryption secrets with cryptographically secure randomness.
- Dependency updates address excessive CPU use from crafted path patterns and `mailto:` links.

### Conflict handling and recovery

#### Improved

- **Not now** postpones repeated automatic merge dialogues while retaining the unresolved-conflict warning. Three or more live revisions are reviewed one reproducible pair at a time, completed pairs remain resolved across restart, and explicit commands can reopen a postponed conflict.
- **Inspect conflicts and file/database differences** compares the Vault with the database winner and every live conflict revision. Compact indicators show missing chunks, `Δsize`, `Δtime`, whether the Vault matches the winner, and whether conflicts remain.
- Each reported file and live revision has a compact wrench menu for comparison, applying an exact readable revision, recording an exact byte match, storing the Vault content as a child of a selected branch, retrying missing chunks without changing the tree, or explicitly discarding one selected live branch.

#### Fixed

- Automatic text and structured-data merge now uses the nearest revision actually shared by both branches. A resolution received from another device no longer recreates the same conflict merely because the Vault still contains the exact content of the removed branch.
- Edits, logical deletions, and renames made while a file remains conflicted extend the revision displayed on that device. When the relationship cannot be proved, LiveSync preserves the branches for review.
- Unreadable live revisions are preserved during automatic handling. An absent Vault file and a winning logical deletion are treated as agreement unless another live branch still requires attention.
- Garbage Collection V3 is limited to CouchDB and now protects every live conflict branch, required shared ancestry, and shared chunks. It stops when device progress cannot be verified and reports compaction failure without a contradictory success message.

### P2P and optional synchronisation features

#### Improved

- P2P and Hidden File Sync remain supported opt-in features. Customisation Sync remains a supported Advanced workflow, while Data Compression remains available but disabled by default.
- P2P controls remain outside the ordinary CouchDB experience until P2P is configured. The current status pane distinguishes announcing changes, following a peer, and persistent per-device actions.
- P2P setup and guidance now distinguish the required signalling relay from optional TURN and describe the replaceable public relay's privacy and availability limits.
- Enabling Hidden File Sync opens one progress Notice before saving the setting and reuses it until the initial scan has finished instead of stacking phase, reload, and restart messages.

#### Fixed

- First-device P2P setup can complete its signalling test without another peer online. Fetch on an additional device still requires an available source peer and a completed P2P Rebuild.
- P2P relay connections now close and are recreated reliably after settings changes and database resets.

### Interface, translation, and operations

#### Improved

- Command-palette actions now use clearer names and appear only when their feature and current context make them usable. Renamed commands retain their identifiers so that existing hotkeys continue to work.
- Setup and review dialogue text can be selected for copying or translation.
- Remote-size warnings use persistent clickable Notices. Initial uploads and Rebuild no longer ask to send every chunk in advance; ordinary replication completes the transfer.
- Obsolete controls for the plug-in trash setting and fixed chunk revisions were removed. The Change Log remains available but no longer opens automatically or tracks an unread count.
- Self-hosted LiveSync now owns its translation catalogue. Commonlib supplies canonical English to other consumers, while translation contributions can be made in the main Self-hosted LiveSync repository.

#### Fixed

- Applying an available interface translation no longer holds start-up behind an unsolicited dialogue; a persistent Notice opens the existing details on demand.
- Action buttons are arranged for narrow mobile screens, long dialogues keep their controls reachable, and persistent Notices no longer cover close controls.

### Storage and file selection

#### Fixed

- The optional Custom HTTP Handler used by Object Storage sends the correct byte range from binary request bodies and reports unsupported body types instead of silently sending an empty request.
- Broadening selectors, ignore rules, size or modification-time limits, or file-name case handling now rechecks previously received files without requiring another remote update.
- Start-up and full-inspection scans omit built-in legacy LiveSync log files and recovery flag files before comparing Vault and local-database state. Existing ignored database records remain untouched, and user-configured ignore behaviour is unchanged.

### Command-line tool

#### Fixed

- CLI Setup URI validation now uses the supported Commonlib ESM package interface.
- The non-root Docker image no longer depends on permissions inherited from the source checkout.

#### Security

- The CLI rejects detected path traversal and symbolic-link components before Vault operations.

### Validation

#### Testing

- Expanded automated Real Obsidian coverage for upgrades, two-device synchronisation, CouchDB, Object Storage, P2P, Hidden File Sync, mobile dialogues, conflict and revision recovery, failure diagnostics, and strict clean-up.
- Real CouchDB integration coverage verifies logical deletion, shared and conflict chunk retention, compaction, downstream replication, and recreation of content-addressed chunks.
- An encrypted Real Obsidian reconnect scenario replaces the remote Security Seed while one client retains the previous value, verifies that synchronisation adopts the replacement without restoring the old value, and proves a bidirectional encrypted round-trip.
- The plug-in code in this release was installed through BRAT and validated on macOS, iOS, and Android, including upgrade from 0.25.83, bidirectional synchronisation, P2P setup, conflict handling, recovery controls, mobile layouts, and start-up with existing configurations.
- Native and non-root Docker CLI scenarios cover setup, write, read, list, information, deletion, conflict resolution, and revision retrieval with the packaged Commonlib dependency.
