# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

### Fixed

#### Translations

- The notice shown when a translation is available now displays the **Display Language** setting label correctly in English, French, Hebrew, Russian, and Simplified Chinese. (#1298) Thank you to @cwatanab for the contribution!
    - Hebrew interface messages also display their referenced labels correctly.

## 1.0.44

1st November, 2026

Recently, I have been concentrating on maintenance and improvements to individual features. I began to wonder whether I had been focusing a little too closely on the details and could give more attention to the overall picture. That led me to a somewhat broader round of changes, including reworking parts of the architecture. Along the way, I was able to bring several implementations of the same concepts together, introduce shared abstractions, and tidy up the codebase a little.

Please let me know if any problems arise from these changes.

### Fixed

#### Synchronisation

- Files containing a raw unit separator (`U+001F`) are no longer truncated when received through S3-compatible Object Storage. (#1303)
    - Update every participating client to prevent further truncation. Updating alone does not repair copies already damaged.
    - Before recovery, preserve verified intact copies, unique unsynchronised edits, and any required history, then follow the [recovery procedure](docs/recovery.md#recover-files-truncated-during-object-storage-reception).
    - Rebuild and Fetch leave Hidden File Sync and Customisation Sync disabled. Initialise them deliberately after ordinary file recovery is complete.

- We can continue CouchDB synchronisation after rebuilding an encrypted remote when **Use Internal API** is enabled. (#1234)
    - Cached responses encrypted with the previous Security Seed no longer interfere with subsequent reads.

#### Conflict resolution

- A queued conflict check no longer gets stuck waiting for a response to an outdated comparison of the same file.

#### Hidden File Sync and Customisation Sync

- Newer local hidden files are no longer omitted when initialising Hidden File Sync with `Merge`.
- Refreshing the Customisation Sync catalogue no longer brings back outdated items from an earlier scan.

### Improved

#### Hidden File Sync

- We can review the latest hidden-file revisions when changes arrive during a manual JSON comparison.
    - The earlier comparison closes, and the latest revisions are checked again. If another device has resolved the conflict, the comparison closes without asking for another selection.

### Sunset

#### Recovery

- Recovery from old cleanup locks is now unified around the standard recovery dialogue, including on devices using the legacy IndexedDB adapter.
    - Use Fetch to reconstruct the local database from the remote, unlock the device when both databases are already aligned, or dismiss the dialogue.
    - These choices replace the legacy in-place `Cleanup` operation. Garbage Collection V3 remains available.
    - Before Fetch, preserve unsynchronised work and any required local history, as it replaces the local database.

### CLI

#### Fixed

- We can continue using the reconstructed database after CLI `fetch` or `rebuild`, avoiding the empty-database restart and file deletion reported in #1304.
    - Subsequent commands retain the selected database even without `--write-settings`. Interrupted reconstruction blocks ordinary synchronisation until recovery.
    - Older runtime state with no recorded owner requires explicit reconstruction from a verified source. Back up unique edits before choosing Fetch or Rebuild.

- The CLI mirror starts correctly on Windows when the Vault path is omitted and the database directory is also used as the Vault.

### Miscellaneous

- Installation and update downloads are smaller.
- Database initialisation handles encrypted change notifications more reliably. (Commonlib #191)

### Acknowledgements

Thank you for your contributions!

- @AdrianNicu, for improving decryption handling during database initialisation (Commonlib #191).

## 1.0.43

30th October, 2026

### Synchronisation

#### New Feature

- We can avoid accidentally editing out-of-date notes while a large CouchDB catch-up is in progress. (#1241, #1275)
    - Turn on **Enable SyncGuard** under **General Settings** → **Appearance** to cover the workspace until incoming changes have been received and applied to the Vault.
    - Disabled by default. During CouchDB LiveSync mode start-up or resume, protection begins after a configurable number of distinct incoming notes is detected (default: 20).
    - **Continue without waiting** releases the workspace, including after a failed or interrupted transfer. Synchronisation can continue, and some notes may still be out of date.
    - The settings apply only to this device.
    - Small catch-up transfers and ordinary live changes remain uninterrupted. Some changes can arrive before the guard activates; it does not prevent other plug-ins or external tools from editing files.

#### Improved

- We can tell that CouchDB synchronisation is progressing while it compares existing revisions, even before any files are uploaded. (#1293, #1294)
    - Separate `⏩↑` and `⏩↓` counts show the change-feed entries compared for push and pull. These are comparison counts; the upload and download totals remain separate.
    - Existing CSS snippets which target `livesync-stat-ff` to hide comparison progress need to target both `livesync-stat-ff-push` and `livesync-stat-ff-pull`. The status display guide includes updated examples.

### Setup and recovery

#### Fixed

- We can choose how a new Join or scheduled Fetch handles our existing files, without silently reusing choices from an earlier Fetch. (#1244, #1296)
    - Each new operation asks again, including after a previous Fetch changed the local database suffix. Fast Setup retains interrupted choices in an editable code block in the fetch flag.
    - On restart, we confirm the current remote and saved choices, choose again, or cancel; a remaining flag never reapplies choices silently.
    - If the saved selection cannot be read, we can choose new options for that attempt without repairing or rewriting the flag. Completing or cancelling the operation removes the whole flag.
    - After updating during an interrupted Fetch, confirm the choices once more. Older separately stored choices are ignored; downloaded data and the existing checkpoint are not removed by this change.

### Dialogues

#### Fixed

- Confirmation and setup actions are easier to follow, and keyboard focus remains visible. (#1297)
    - Buttons align with the content above them, with room for confirmation buttons' focus outlines.
- Mobile dialogues retain Obsidian's standard spacing and leave more usable space above the software keyboard. (#1297)

### Translations

- More settings, setup, recovery, and configuration messages are available in Simplified Chinese. (#1258)
    - Expanded the translation catalogue to include previously untranslated messages and shared-library labels.

### Miscellaneous

- Docker setup now handles shell-sensitive characters in health-check credentials correctly, avoiding false authentication failures which could prevent CouchDB initialisation. (#1295)

### Acknowledgements

Thank you for your contributions!

- @Akilaydin, for adding the optional SyncGuard workspace protection (#1275).
- @ARCJ137442, for adding separate push and pull comparison progress displays (#1294).
- @Jovlang, for correcting Docker health-check credential quoting and authenticated readiness checks (#1295).
- @kannazuki-c, for expanding the Simplified Chinese translations (#1258).

## 1.0.42

27th October, 2026

Making content checks mandatory in the 1.0.41 pre-release came with a little too much overhead, so 1.0.42 makes them optional. This has turned into a slightly larger release.

### Synchronisation

#### New Feature

- Rapid edits can produce fewer intermediate versions on other devices while LiveSync mode remains active.
    - Enable **Batch database updates in LiveSync mode** to group successive local edits.
        - Disabled by default; each synchronisation mode keeps its own choice.
        - Updates reach other devices later. Batching does not detect template completion or prevent genuine concurrent-edit conflicts.
- CouchDB synchronisation no longer looks idle while it is comparing change history.
    - A ⏩ icon and comparison count show activity before documents are transferred.
        - This count represents history entries, not files remaining to synchronise.
- Status counts are easier to follow, with less movement as values change.
    - CSS snippets can hide unwanted items or style individual `livesync-stat-` items, including inactive ones.

- We can choose stricter content checks at start-up.
    - Enable **Strict content check on startup** to compare file contents even when their modification times and sizes match the recorded local database state. This can increase start-up time in large Vaults.
    - The setting is disabled by default. Ordinary start-up can skip content reads when the exact modification time, file size, and recorded database revision match, with no conflicts or pending file changes.
    - While the setting is disabled, an edit which preserves its exact size and modification time can go undetected during start-up. Manual scans and explicit recovery operations remain strict.

#### Fixed

- Recent Vault edits remain recoverable after an interrupted local database save.
    - This includes edits whose modification times compare equal to the database copy, and pending Hidden File Sync and Customisation Sync changes.
- Manual synchronisation no longer starts before already accepted local changes finish saving to the database.
    - Settings application also waits for those saves. Failed saves stay pending and report a failure.
- Text from third-party tools is handled more robustly.
    - Characters split across Chunks no longer trigger false corruption warnings.
- Start-up integrity checks use less memory for healthy Vault files. (#1283)
- Start-up checks avoid false repair warnings for files that change during inspection. (#1283)
    - This applies when the final size matches the database and there are no conflicts.

### Customisation Sync

#### Fixed

- Applying a multi-file customisation no longer skips files after the list is refreshed. (#1271)
- Choosing **Automatic** now explains a missing Hidden File Sync prerequisite instead of proceeding into a failed initialisation. (#1270)
    - Enable and initialise Hidden File Sync on this device first. The current mode is kept when the prerequisite is missing.
- Initialising a whole plug-in in **Automatic** mode no longer omits its selected **MAIN** or **DATA** files.

### Setup tools

#### Fixed

- Setup URI generation can avoid shell-variable collisions and unintended use of the operating-system username. (#817, #1274)
    - Use `LIVESYNC_HOST`, `LIVESYNC_USER`, `LIVESYNC_PASS`, `LIVESYNC_DB`, and `LIVESYNC_PASSPHRASE` for connection and encryption values.
        - Existing scripts remain supported: the previous names are used when the corresponding prefixed value is unset or blank.

### Miscellaneous

- Dependencies have been updated, including security fixes.

### Acknowledgements

Thank you for your contributions!

- @rwbru, for the original Setup URI environment-variable fix (#817).
- @junkerderprovinz, for adapting that fix to the current generator while preserving compatibility with existing scripts (#1274).
- @s-qin, for reducing memory use during start-up checks and avoiding repeated content decoding in Commonlib (#1283, Commonlib #184).

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
