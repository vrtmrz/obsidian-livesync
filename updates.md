# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

### Privacy and compatibility

#### New Feature

- An optional saved ID key can generate encrypted Chunk IDs and obfuscated Metadata document IDs independently of the current E2EE passphrase.
    - New Vaults use a random key by default; existing Vaults keep their current ID configuration by default. You can also derive a key from the current E2EE passphrase, enter a separate source, or import a recovery code. The source is not retained; the saved key can be revealed locally as a recovery code.
    - The saved key stays in place when the E2EE passphrase changes or E2EE is turned off. Share it with another device through a protected Setup URI. Changing document IDs on an existing remote requires the usual Rebuild and Fetch procedure.
- We can now keep the file properties used by Hidden File Sync and Customisation Sync private in CouchDB.
    - **Encrypt internal file Properties** extends E2EE V2 and Property Encryption to their paths, times, sizes, and Chunk references.
    - Existing configurations keep this preference disabled. New Vaults enable it for use when the required encryption settings are active.
    - Update every synchronising device before enabling it. It protects future writes; a manual remote Rebuild is strongly recommended to protect existing properties.
- We can now see which unsupported feature prevents a client from synchronising with CouchDB.
    - Clients check the features required by the remote before transferring data or resetting the local database for Fast Fetch. Receiving an unsupported requirement also stops active replication.

- We can now compare ID generation performance on a desktop or mobile device through **Open review harness**, available with the developers' debug tools enabled.
    - The copied report includes legacy and independent ID timings and, where available, approximate JavaScript heap samples. The measurement uses fixed test data and keeps our Vault and settings unchanged.

#### Fixed

- We can now keep using an E2EE passphrase beginning with `%` after restarting Obsidian. (#1221)
    - LiveSync encrypts it before saving the settings. If an earlier version saved it in plain text, re-enter the passphrase used to encrypt the existing data after updating. Treat that passphrase as exposed if the affected `data.json` was shared.
- A receiving device now retries an unavailable CouchDB Chunk when file Metadata arrives before that Chunk is visible, helping rapid edits reach the Vault after an initial on-demand lookup misses it. (#1224)
    - Retries start after two seconds and continue with increasing delays while finite replication is active. When it ends, LiveSync checks locally and makes a final lookup if needed, without waiting out the remaining retry delay.
- We can now distinguish initial on-demand Chunk requests (`🛄`) from retries (`🔁`) in the status bar. These replace `🧩`; each pending Chunk appears in one category, including while a retry is waiting.

### Synchronisation and storage

#### Fixed

- Received changes held during start-up or a fetch are applied when LiveSync becomes ready, without waiting for another change or a settings save. **Suspend database reflecting** continues to hold changes (#1200).
- Customisation Sync now compares full millisecond timestamps, so the freshness labels and **Select All Shiny** no longer mistake an older copy for a newer one because of timestamp truncation. (#1194)
- **Hide not applicable items** now hides identical Customisation Sync items and refreshes the list when toggled. Items with applicable differences stay visible. (#1193)

### Interface and translation

#### Improved

- More settings and messages are now available in Russian. (#1187)
    - Dialogues show generated QR codes, key pairs, and database sizes again.
- We can now use updated Spanish translations for settings and messages. (#1212)

### Setup

#### New Feature

- We can now share a Setup URI with a displayed time limit, or choose **Compatible** for reuse without a time limit.
    - **Time-bound** uses the current fixed seven-day UTC window, so the displayed end may be less than seven days away. Compatible retains the existing URI format; receiving devices still need to support the shared settings.
    - The time condition applies when opening the URI. It does not revoke imported credentials or prevent reuse after rolling the device clock back.

#### Improved

- We can now distinguish the three Setup URI and QR code choices by their short labels and icons: initialise or overwrite the remote, join this device, or apply settings only.

#### Fixed

- We can now add a device or open a copied Vault without a compatibility pause solely because its device-local version record is absent.
    - Existing version or settings incompatibilities still require review. A pause already saved by an earlier release still needs one explicit resume action.

### Acknowledgements

Thank you for your contributions!

- [@kimjansheden](https://github.com/kimjansheden) ([#1219](https://github.com/vrtmrz/obsidian-livesync/pull/1219))
- [@Immick](https://github.com/Immick) ([#1195](https://github.com/vrtmrz/obsidian-livesync/pull/1195), [#1196](https://github.com/vrtmrz/obsidian-livesync/pull/1196))
- [@bolikcraft](https://github.com/bolikcraft) ([#1187](https://github.com/vrtmrz/obsidian-livesync/pull/1187))
- [@speedy-axolotl](https://github.com/speedy-axolotl) ([#1212](https://github.com/vrtmrz/obsidian-livesync/pull/1212))

## 1.0.32

27th September, 2026

The 1.0.31 pre-release was not promoted after validation found that a receiving device could reject encrypted CouchDB changes when Path Obfuscation was enabled. This release includes its changes and corrects that issue.

### Synchronisation and storage

#### Fixed

- The receiving device now accepts encrypted file information when both end-to-end encryption and Path Obfuscation are enabled. The 1.0.31 pre-release could reject this information, leaving files from another device absent from the Vault.
- Files with colons in their names now retain their full paths in synchronisation data instead of appearing as incorrectly named copies at the Vault root. (#1206)
    - Obsidian may refuse to create a missing file with such a name. LiveSync also treats these names as invalid on Windows and Android, so the file may not appear in those devices' Vaults. Existing misplaced copies are left for you to review; this change does not remove them automatically.
- Received changes within the configured modification-time limit are applied to the Vault again while remediation mode is active. Changes newer than the limit remain blocked; changes arriving while a fetch makes the local database unavailable are kept for a later attempt.
- A scheduled fetch no longer offers Simple Fetch while remediation mode is active. This prevents the fetch from bypassing the modification-time limit; the detailed flow explains the restriction and offers to clear it first (#1202). Thank you to @kimjansheden for both fixes and the regression tests in PR #1208!
- On start-up, an unchanged file with a missing local revision record can be recognised before newer content arrives, avoiding an unnecessary conflict. Files with actual local edits still require conflict review. (#1207)

## 1.0.31

26th September, 2026

### Synchronisation and storage

#### Fixed

- Files with colons in their names now retain their full paths in synchronisation data instead of appearing as incorrectly named copies at the Vault root. (#1206)
    - Obsidian may refuse to create a missing file with such a name. LiveSync also treats these names as invalid on Windows and Android, so the file may not appear in those devices' Vaults. Existing misplaced copies are left for you to review; this change does not remove them automatically.
- Received changes within the configured modification-time limit are applied to the Vault again while remediation mode is active. Changes newer than the limit remain blocked; changes arriving while a fetch makes the local database unavailable are kept for a later attempt.
- A scheduled fetch no longer offers Simple Fetch while remediation mode is active. This prevents the fetch from bypassing the modification-time limit; the detailed flow explains the restriction and offers to clear it first (#1202). Thank you to @kimjansheden for both fixes and the regression tests in PR #1208!
- On start-up, an unchanged file with a missing local revision record can be recognised before newer content arrives, avoiding an unnecessary conflict. Files with actual local edits still require conflict review. (#1207)

## 1.0.30

18th September, 2026

### Synchronisation

#### Fixed

- After a restart, unchanged local files no longer overwrite newer synchronised content. (#994)
    - When LiveSync cannot establish a local file's origin, it keeps the file as a conflict for you to review. This also applies to ordinary file synchronisation in the command-line tool.
- Fast Fetch completes initial setup with fewer remote requests.
- Object Storage synchronisation makes fewer remote requests while still checking its parameters before writing.

## 1.0.29

16th September, 2026

Unusually for this project, I have added a feature that relies on a particular infrastructure provider. I made this choice for the convenience it offers.

### Peer-to-peer synchronisation

#### New Feature

- P2P synchronisation now supports **Managed (Cloudflare)** TURN to help devices connect when a direct connection is unavailable. Enter your TURN Key ID and API token, and LiveSync obtains temporary TURN credentials automatically. (#1182)

    - Managed TURN settings are saved with your encrypted P2P profile and included when you share it through a Setup URI or QR code.
    - Your API token is omitted from generated reports.

### Command-line tool

#### Fixed

- The CLI daemon now synchronises files already present at start-up and picks up edits and deletions made while it was stopped.
- CLI Vault scans no longer miss files after an earlier scan or file lookup. This incorporates an adapted version of the fix proposed in PR #1188. Thank you to @YakupEmreYerli for the fix and regression tests, and to @nsanitas for the detailed report and analysis in #1143!

### Miscellaneous

In general, I would prefer to avoid features that depend on a particular service. Still, I think there is room for them when they are entirely optional, clearly explained, and maintainable. Even then, I would want open alternatives to remain available. I will write more about this principle separately.

## 1.0.28

9th September, 2026

I came across an article online that put its finger on something fundamental. Writing up the details in what seemed the most fitting format helped me organise my thoughts considerably.

The resulting manuscript and citation information are now available in the project's GitHub repository for researchers and practitioners who would like to cite Self-hosted LiveSync.

### Setup and compatibility

#### Fixed

- A missing legacy file-name case setting no longer makes the configuration mismatch dialogue require a database rebuild when this device already uses case-insensitive handling. Case-sensitive handling now correctly requires a compatibility decision when the remote omits that setting.
- Configuration review now compares the selected remote profile's trial settings, and discards a pending decision if its settings or active connection change before it can be applied.

## 1.0.27

7th September, 2026

For now, I am addressing the issues I can resolve first. I hope this helps.

### Synchronisation and storage

#### Fixed

- First-time Object Storage setup now completes when **Use Custom HTTP Handler** is enabled for an empty remote, including a new Cloudflare R2 bucket. LiveSync can now create the remote state required to begin synchronisation. (#1166)
