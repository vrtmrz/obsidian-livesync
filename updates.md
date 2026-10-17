# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

## 1.0.38

17th October, 2026

### Synchronisation

#### Added

- We can opt into NFC path identity for CouchDB synchronisation between the CLI and Obsidian. This prevents decomposed or mixed Unicode file names from becoming inaccessible through a receiving device's normalised path. (#1259)
    - Existing Vaults retain their current identity rules. Migration requires updated clients, a Rebuild from a complete authoritative Vault, and a Fetch on the other devices.
    - Reconstruction stops when the supported host file listing or local Metadata exposes ambiguous files or parent folders under NFC and the configured case handling. The CLI retains existing physical file names. P2P and Object Storage do not support the new mode.

#### Fixed

- We can synchronise file deletions and renames when **Do not keep metadata of deleted files.** is enabled.
    - A file restored during the final deletion check remains in the receiving Vault.
- We can resolve configuration mismatches when **Encrypt internal file Properties** is enabled but its encryption prerequisites are inactive. (#1180)
    - Compatible chunk settings can be aligned automatically, or reviewed through `Sync now`. Applying those settings preserves our inactive encryption preference.
- We can receive synchronised updates to unchanged files even after the local database has discarded their recorded revision, avoiding unnecessary conflicts. (#1207)
    - Saved content evidence survives revision-history pruning. Genuine local edits remain protected, and older records are upgraded only after their content is verified.

### Maintenance

- The Review Harness can compare SHA-256 and xxHash64 file-content hashing on the current device, with fixed inputs from 4 KiB to 50 MiB and separate initialisation and warm-up measurements.

## 1.0.37

16th October, 2026

### Security

- Fixed an issue where synchronised changes could reach files outside the intended synchronisation scope under certain conditions. Updating is recommended.

### CLI

#### Fixed

- We can edit files through the CLI without resetting their creation time where the filesystem supplies it. (#1243)
    - Filesystems without birth-time support retain the existing change-time fallback. File replacement and restoration of a synchronised creation time remain subject to filesystem limitations.
- `p2p-host` restores configured P2P automatic synchronisation, following, and change announcements after initialisation. (#1247)
    - Headless peer acceptance follows the configured policy. Single-operation commands retain their automatic synchronisation suspension.
- We can select CLI-only Docker patches by their full release tag, such as `1.0.36-patch1-cli`, while keeping the Obsidian plug-in version.
    - Patch and RC images receive version and SHA-qualified tags. The `latest` and major-minor tags remain reserved for ordinary stable releases.

### Acknowledgements

Thank you for your contributions!

- @kimjansheden, for reporting the issue and contributing the fix and regression tests.

## 1.0.36

13th October, 2026

### Configuration Encryption

#### Fixed

- We can change the protection of sensitive configuration with Apply and keep our saved settings readable after a restart. (#1238, #1245)
    - The selected protection mode and passphrase are saved together. If Apply fails, our edits remain available to retry.
- We can enter a missing or unusable custom configuration passphrase at start-up to unlock our protected settings. (#1239, #1245)
    - Cancelling the recovery dialogue preserves the encrypted configuration and stops that start-up attempt. Headless command-line start-up cannot complete the dialogue when recovery input is required.

### Localisation

#### Fixed

- We can read more settings, maintenance controls, and Fast Setup instructions in Spanish. (#1213, #1214)
    - Remote database lock warnings now use the existing translations consistently.
    - Fast Setup follows the selected display language while preserving saved choices across restarts and language changes.
- We can read more settings, setup instructions, and messages in Simplified Chinese. (#1242)

### Maintenance

- Development tooling now uses compatible dependency versions with available security fixes. (#1245)
    - Repository-owned build and import alias helpers remove the vulnerable `braces` dependency.

### Acknowledgements

Thank you for your contributions!

- @zeedif (#1213, #1214)
- @lingting0 (#1242)

## 1.0.35

5th October, 2026

### Synchronisation

#### Fixed

- We can continue synchronising after rebuilding an encrypted CouchDB remote, including when Hidden File Sync and Customisation Sync are enabled. (#1234)
    - This plug-in reads the rebuilt data without reusing HTTP responses encrypted with the previous Security Seed.

### Customisation Sync

#### Fixed

- Customisation Sync now waits until this plug-in is ready before handling configuration file events, and applying settings while synchronisation is suspended no longer scans configuration files. (#1220)
    - Resuming synchronisation scans once and restarts the periodic scan when enabled.

### Acknowledgements

Thank you for your contributions!

- @kimjansheden (#1220)

## 1.0.34

2nd October, 2026

### Security

- Fixed an issue where sensitive information could be included in exported configuration data under certain conditions. Updating is recommended. (refs #1218)
- Improved configuration persistence and JSON conflict handling.

### Acknowledgements

Thank you for your contributions!

- @kimjansheden (#1218)
