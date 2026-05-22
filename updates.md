# 0.25
Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## 0.25.69

22nd May, 2026

### Fixed
- No longer the P2P passphrase mismatch causes a server shutdown.
- Settings related to P2P synchronisation are now correctly applied on start-up and no longer reverted.

### New features
- Diagnostic P2P connection stats are now available.
  - These stats indicate the number of connection trials, successes, and, failures.

## 0.25.68

22nd May, 2026

### Improved

- P2P connections have improved slightly
  - Upgrade to `trystero` v0.24.0, and fixes event handler assignment. This should fix some edge cases where P2P connections fail to establish or messages are not properly handled.
  - Weaken terser options to avoid potential issues with minification that could cause runtime errors in some environments.

## ~~0.25.66~~ 0.25.67

20th May, 2026

0.25.66 had a bug that the auto-accept logic for compatible but lossy mismatches was not working as intended.

### New features
- Implement an auto-accept compatible tweak setting and enhance the mismatch resolution logic.

### Improved
- Many messages related to tweak mismatch resolution have been updated for clarity.

## 0.25.65

19th May, 2026

### Fixed
- Fix an issue about resuming from background on iOS (#888).
- Now Chunk Splitter: `V3: Fine Deduplication` is working fine again (#866).
  - It has some drawbacks, such as fewer chunks are generated. However, it makes less transfer and storage when the files are modified but not completely changed.
- Unsynchronised local changes (which means changes that have not been sent) are now correctly preserved as a conflict (Thank you so much for @SeleiXi!).
- Avoid creating a new revision when the current and conflicted revisions have identical content (Thank you so much for @daichi-629).

### Improved
- Improved the error verbosity on concurrent processing during the start-up process.
- Now the `report` includes recent logs (of verbosity `verbose` even settings is not set to `verbose`).
- Updating logs is now debounced to avoid excessive updates during rapid log generation.
- Added a `Generate full report for opening the issue with debug info` command to the command palette, which generates a report without opening the settings dialogue.


## 0.25.64

17th May, 2026

### P2P Status Pane

- Added active P2P remote selector (combo box) and `+` action to create/select a P2P remote from the P2P setup dialogue.
- Added per-peer immediate replication action on accepted peers.
- Updated status control icons for clarity:
  - Replicate now: `🔄` (`⏳` while running)
  - Watch: `🔔` / `🔕`
  - Sync target: `🔗` / `⛓️‍💥`
- Added warning state when no active P2P remote is selected.

### P2P Status Card

- Added stable Room ID suffix display and placed it above Peer ID for better identification.

### Non behavioural internal changes

#### P2P

- Added `P2P_ActiveRemoteConfigurationId` as a dedicated active remote selection for P2P features, separate from the normal active remote.
- Added activation logic for P2P dedicated remote configuration that reflects P2P settings while keeping `remoteType` unchanged.
- Added migration support to carry over P2P active remote selection when appropriate.
- Added shared Room ID utility functions and applied them across P2P setup and P2P panes.

#### Tests

- Added/updated unit test coverage around settings load behaviour for P2P active remote application.

## 0.25.63

17th May, 2026

### Fixed
- The issue which cannot synchronise in Only-P2P mode has been fixed.
- Fixed an issue where "Failed to connect to the remote server" was shown during the redFlag rebuild flow when P2P was the primary remote type. Remote configuration fetch is now skipped for P2P.

### P2P Replication UI Improvements
- Brand-new P2P Server Status pane has been added to provide real-time visibility into your connection status and peer network.
  - For detailed instructions on using the new P2P features, please refer to the updated [User Guide: Peer-to-Peer Synchronisation (2026 Edition)](./docs/p2p_sync_updates_2026.md).
- Now `Replicate` button or ribbon icon opens a redesigned interactive replication dialogue that performs smart bidirectional sync with a single click.
- The vault rebuild flow (`replicateAllFromServer`) now opens the redesigned P2P Replication modal instead of a plain text selection dialogue, providing a consistent UI experience.

## 0.25.62

14th May, 2026

### Fixed

- Fixed an issue where a connection could not be established when attempting to connect to a brand-new remote database without going through the set-up wizard or configuration checking (#660).

## 0.25.61

13th May, 2026

Reviews have started on the Obsidian Community, haven't they? It was quite a struggle, what with having to fix the outdated ESLint.
I am a bit nervous, but it is far better than just plodding along aimlessly, so let us get on with it. If you spot any issues, please let me know straight away.

From now on, I am avoiding committing directly to the main branch. This is because you lots have all been sending so much PRs. I wanted to keep things harmonious.
That said, I am still not used to rebasing, so there are some parts where the commit history is a right mess. I will work on improving that.

### Improved

- P2P synchronisation has been made more robust
  Now the foundation for P2P synchronisation has been rewritten, and the unit tests have been added. The foundation has been separated into the transport layer, signalling-and-connection layer, and, an RPC layers. And each layer has been unit-tested. As the result, the P2P synchronisation now uses the robust shim that uses RPC-ed PouchDB synchronisation in contrast to previous implementation.
This P2P synchronisation is not compatible with previous versions in terms of connectivity. All devices must be updated.

### Fixed

- No longer baffling errors occur when setting-update is triggered during the early stage of initialisation.
- Network error notice pop-ups are now suppressed when 'NetworkWarningStyle' is set to 'Hidden'. (Thank you so much @SeleiXi!)

### New features

- Diff navigation buttons have been added to the diff view, making it easier to move between differences. (Thank you so much @SeleiXi! #871)

### Translations

- Chinese (Simplified) translations for settings and the Setup Wizard have been added. (Thank you so much @zombiek731!)
- Common UI controls and signal words are now localised into Chinese (Simplified). (Thank you so much @zombiek731!)
- i18n runtime behaviour and locale coverage have been improved. (Thank you so much @52sanmao!)

### CLI

#### New features

- Daemon synchronisation is now supported. (Thank you so much @andrewleech! #843)
- `HeadlessConfirm` has been implemented with sensible defaults, enabling unattended operation in headless environments. (Thank you so much @andrewleech!)
- The CLI onboarding experience has been improved. (Thank you so much @OriBoharon! #872)

#### Fixed

- Sub-millisecond CLI mtimes are now truncated to prevent mobile crash. (Thank you so much @brian-spackman! #893)

## 0.25.60

29th April, 2026

### Fixed

- Now larger settings can be exported and imported via QR code without issues. (#595)
  - When the settings data exceeds the QR code capacity, it is now split into multiple QR codes.
    - These QR codes are reassembled by the aggregator page, which collects the split data and reconstructs the original settings.
    - Aggregator page is available at `https://vrtmrz.github.io/obsidian-livesync/aggregator.html`, and this file is also included in the repository.
  - We will not send the settings data to any server. The QR code data is generated and processed entirely on the client side, ensuring that your settings remain private and secure. HOWEVER, please be careful your network environment.
- Fixed some errors during serialisation and deserialisation of the settings, which caused issues in some cases when importing/exporting settings via QR code.

### Fixed (CLI)

- `ls` and `mirror` commands now provide informative feedback when no documents are found or filters skip all files, resolving the issue where they would exit silently (#860).
  - Improved the clarity of CLI command logs by including the total count of processed items.
- The command-line argument `vault` has been renamed to a more appropriate name, `databaseDir`.
- The `mirror` command now accepts a `vault` directory, which specifies the location where the actual files are stored. For compatibility reasons, the previous behaviour is still supported.

## 0.25.59

### Fixed

- No longer Setup-wizard drops username and password silently. (#865)
  - Thank you so much for @koteitan !
- Setup URI is now correctly imported (#859).
  - Also thank you so much for @koteitan !

### Improved

- now French translation is added by @foXaCe ! Thank you so much!

## 0.25.58

### Fixed

- No longer credentials are broken during object storage configuration (related: #852).
- Fixed a worker-side recursion issue that could raise `Maximum call stack size exceeded` during chunk splitting (related: #855).
- Improved background worker crash cleanup so pending split/encryption tasks are released cleanly instead of being left in a waiting state (related: #855).
- On start-up, the selected remote configuration is now applied to runtime connection fields as well, reducing intermittent authentication failures caused by stale runtime settings (related: #855).
- Issue report generation now redacts `remoteConfigurations` connection strings and keeps only the scheme (e.g. `sls+https://`), so credentials are not exposed in reports.
- Hidden file JSON conflicts no longer keep re-opening and dismissing the merge dialogue before we can act, which fixes persistent unresolvable `data.json` conflicts in plug-in settings sync (related: #850).

## 0.25.57

9th April, 2026

- Packing a batch during the journal sync now continues even if the batch contains no items to upload.
- No unexpected error (about a replicator) during the early stage of initialisation.
- Now error messages are kept hidden if the show status inside the editor is disabled (related: #829).
- Fixed an issue where devices could no longer upload after another device performed 'Fresh Start Wipe' and 'Overwrite remote' in Object Storage mode (#848).
  - Each device's local deduplication caches (`knownIDs`, `sentIDs`, `receivedFiles`, `sentFiles`) now track the remote journal epoch (derived from the encryption parameters stored on the remote).
  - When the epoch changes, the plugin verifies whether the device's last uploaded file still exists on the remote. If the file is gone, it confirms a remote wipe and automatically clears the stale caches. If the file is still present (e.g. a protocol upgrade without a wipe), the caches are preserved, and only the epoch is updated. This means normal upgrades never cause unnecessary re-processing.

### Translations

- Russian translation has been added! Thank you so much for the contribution, @vipka1n! (#845)

### New features

- Now we can configure multiple Remote Databases of the same type, e.g, multiple CouchDBs or S3 remotes.
  - A user interface for managing multiple remote databases has been added to the settings dialogue. I think no explanation is needed for the UI, but please let me know if you have any questions.
- We can switch between multiple Remote Databases in the settings dialogue.

### CLI

#### Fixed

- Replication progress is now correctly saved and restored in the CLI (related: #846).

## ~~0.25.55~~ 0.25.56

30th March, 2026

### Fixed

- No longer `Peer-to-Peer Sync is not enabled. We cannot open a new connection.` error occurs when we have not enabled P2P sync and are not expected to use it (#830).

### CLI

- Fixed incomplete localStorage support in the CLI (#831). Thank you so much @rewse !
- Fixed the issue where the CLI could not be connected to the remote which had been locked once (#833), also thanks to @rewse !

## 0.25.54

18th March, 2026

### Fixed

- Remote storage size check now works correctly again (#818).
- Some buttons on the settings dialogue now respond correctly again (#827).

### Refactored

- P2P replicator has been refactored to be a little more robust and easier to understand.
- Delete items which are no longer used that might cause potential problems

### CLI

- Fixed the corrupted display of the help message.
- Remove some unnecessary code.

### WebApp

- Fixed the issue where the detail level was not being applied in the log pane.
- Pop-ups are now shown.
- Add coverage for the test.
- Pop-ups are now shown in the web app as well.

Full notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
