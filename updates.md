# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

### Synchronisation

- We can run startup integrity checks with lower memory use for healthy Vault files. Files that change between the size check and content reading no longer trigger an unnecessary repair warning when their actual sizes agree and there are no conflicts. (#1283)

## 1.0.40

24th October, 2026

This has turned into a slightly larger set of changes overall, but I have finally been able to implement the features I felt we would need.

### Synchronisation

#### New Feature

- We can choose **Review devices** in Remote Configuration, the command palette, or a version Notice to review participating devices.
    - Our device appears first, with its lockout state. Other records show the platform, plug-in version, app version, and last recorded connection time when available.
    - An advisory Notice identifies Self-hosted LiveSync and lists newer and older versions separately, with one shared recommendation and **Review devices** action. The dialogue explains possible storage costs and P2P compatibility limits.
- We can forget records belonging to lost or retired devices while preserving the remote lock state and other devices.
    - Forgetting a record does not delete Vault files or revoke credentials. A returning device can register again on an unlocked remote.

#### Fixed

- We can reuse unchanged content more reliably after edits with the V3 Rabin–Karp chunk splitter.
    - Corrected rolling-window processing lets boundary detection recover after an insertion. Existing content remains readable, and installing this update does not trigger a full re-chunk of our Vaults.
    - Chunk-size values 0 and 1 now use content-defined binary boundaries below their maximum lengths, improving reuse after an insertion instead of producing fixed-length pieces.
    - Editing or explicitly rewriting a file, recreating its chunks, or rebuilding from our files can produce different chunk boundaries and additional chunks. Older and updated devices can retain different chunk layouts; this affects reuse and storage, not the file contents.
- We can preserve all conflict branches, including deleted branches, during Fast Setup.
    - A fresh, complete Fast Fetch can also hand its verified progress to ordinary synchronisation before file watching resumes, reducing the first subsequent identifier scan. Existing resume cursors and On Demand chunk retrieval retain their existing behaviour.

#### Changed

- New setup uses the same Chunk-size recommendation of 0 across remote types, and Setting Doctor no longer recommends increasing every self-hosted V3 configuration to 60.
    - Setting Doctor no longer flags the saved **Enhance chunk size** value. When rebuilding with V3 Rabin–Karp, we recommend setting it to 0. This is now an efficient choice across all supported remote types.
    - Existing explicit and agreed values are retained. Smaller Chunks favour reuse during editing, but increase document counts and can make first uploads and large rebuilds slower. Mostly immutable binary Vaults can still benefit from a larger explicit value.

### Hidden File Sync

#### Fixed

- We can synchronise selected hidden files while the normal-file allow-list is set. (#1272)
    - Normal-file exclusion patterns still apply to hidden files, and the Selector descriptions now explain their scope.

### CLI

- Unreadable or malformed device-local state now stops initialisation instead of being treated as empty. Existing valid state files keep their format.

## 1.0.39

20th October, 2026

I have been finding troubleshooting difficult, so I decided to go back to basics and prepare the tools we need.

### Synchronisation

#### Fixed

- We can migrate to NFC path identity when deletion or rename history would otherwise block Rebuild or Fetch. (#1259)
    - Logical deletions without unresolved conflicts no longer block operations which replace the local database. Conflicting histories and ambiguous current files still require review.

### Diagnostics

- We can inspect file differences and current conflicts across the local database, CouchDB, and the Vault without changing databases or settings.
    - Integrity inspection compares Metadata for normal files and checks content for suspect groups. **Include remote database** is enabled by default and can be cleared for one run. Reports distinguish an excluded remote from an unavailable source and retain the evidence collected so far.
- We can share reports using pseudonyms and find the affected files locally for follow-up.
    - Integrity and Usage offer original names or pseudonyms before each run, and omit file contents and credentials in both modes. Path pseudonyms use a random public salt for each report; revision pseudonyms retain their generation number.
    - The Hatch lookup searches current Vault paths and local Metadata for normal files. It preserves separate document IDs for the same path and can prepare a report for the selected document using the original salt. Public salts permit guessed-path checks.
- We can follow progress in large inspections and stop work when enough evidence has been collected.
    - Integrity shows counts and a gauge for each stage, reduces remote requests with bulk reads and bounded concurrency, and logs read and request timings. Usage shows revision discovery with a growing total, followed by cancellable accounting.
    - Closing a follow-up dialogue stops further reads after the active read settles. Complete Usage reports retain the existing TSV columns; partial reports use JSON to retain their status and reasons.
- We can read and share large Integrity reports more easily.
    - Compact Markdown retains every observation and its follow-up references, with state counts, a review index, and a field guide. It includes available size, modification-time, Chunk-reference, and case/NFC evidence without additional database or Vault reads. JSON retains the full structure.
    - Markdown reports use a collapsible code block for sharing in issues. Review candidates indicate where to investigate; they do not establish corruption, and unchecked content remains distinct from healthy content.
- We can find reporting actions more easily in Hatch and keep report controls visible in smaller windows.
    - The five reporting tools are grouped separately from checks, recovery, and reset operations. Name and format choices remain visible, and the report preview resizes around the controls.
- We can request and provide targeted troubleshooting evidence through the issue-reporting guide.
    - Direct links cover Integrity, Usage, pseudonym lookup, and follow-up reports, with request examples for issue discussions.

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
