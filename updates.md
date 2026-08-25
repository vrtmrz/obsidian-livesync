# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

### Interface and translation

#### Fixed

- Compatibility pause warnings now direct you to the dedicated compatibility review instead of the Change Log.

#### Improved

- Settings pages, General controls, Quick Setup actions, and Advanced controls now use Obsidian 1.13's native settings interface and global search, while retaining their familiar icons. The landing page keeps Remote Configuration and Sync Settings together, places Appearance, Logging, and Extra menus under General Settings, and groups maintenance, optional features, advanced settings, and help by purpose. Earlier supported Obsidian versions continue to use the pane-based interface.
- Settings changes which require database initialisation now use a focused Setup Manager dialogue to choose between existing synchronisation data and the files in the current Vault. The selected reset or rebuild is reserved before the settings are saved, while cancelling offers a separate, explicit settings-only fallback.

## 1.0.18

24th August, 2026

### Synchronisation and storage

#### Fixed

- Reset and rebuild workflows now use the local database selected by their updated settings, preventing stale data from reopening after a **Database Suffix** change. If database initialisation does not complete, the workflow remains paused instead of continuing with incomplete state.

#### Improved

- Rebuilds now recheck restored file events against the current Vault, use current file contents, and finish processing them before the plug-in reports readiness.

## 1.0.17

23rd August, 2026

### Interface and translation

#### Fixed

- Settings generated from the settings manifest, Setup Wizard configuration summaries, and warnings about externally changed settings now honour **Display language** when a translation is available, instead of remaining in English (PR #1123). Thank you to @nimula for the contribution!

### Peer-to-peer synchronisation

#### Improved

- P2P connection profiles now provide four **P2P message size** presets and a **Connection path** choice between **Automatic** and **TURN relay only**. Smaller messages can improve compatibility on paths which fragment or drop larger WebRTC messages, while relay-only routing requires a configured TURN server. P2P connection strings and encrypted Setup URIs preserve both choices.
    - Thank you to @andrewschreiber for the detailed fragmentation diagnosis and working 800-byte threshold in vrtmrz/livesync-commonlib#97, which informed this compatibility design.
- An optional self-hosted Coturn Compose starter is now available for P2P deployments that need a TURN relay. It uses a pinned upstream image and documents its network, credential, security, and verification boundaries.

## 1.0.16

19th August, 2026

### Conflict handling and recovery

#### Fixed

- **Back to this revision** in Document History now restores the selected content as a new non-deleted successor revision before reflecting it to the Vault. A readable revision restored after a logical deletion therefore remains restored through later synchronisation instead of being overwritten by the deletion.
    - If the file changes while restoration is in progress, the operation stops instead of extending a stale revision. Existing conflicts remain available through **Inspect conflicts and file/database differences**.

### Synchronisation and storage

#### Improved

- One-shot CouchDB synchronisation now releases stalled web-compatible connection checks before replication starts, so a later synchronisation can make a fresh attempt (Commonlib 0.1.16).
    - The 60-second safeguard applies only to pre-replication checks. It does not limit ordinary synchronisation, and the **Use Internal API** path is unchanged.

## 1.0.15

15th August, 2026

### Synchronisation and storage

#### Improved

- Start-up offline scanning is now faster, especially for larger Vaults using path obfuscation (Commonlib 0.1.15).

### Interface and translation

#### Improved

- The Traditional Chinese translation catalogue has been completed and polished for broader coverage and more natural, consistent terminology (PR #1106). Thank you to @nimula for the contribution!

## 1.0.14

14th August, 2026

Thank you for your patience. At last, it looks as though we can clear some of the Community Review warnings.

### Synchronisation and storage

#### Fixed

- CouchDB operations which run to completion now close their temporary remote database connections after use across both Commonlib and LiveSync, including Setup Wizard and settings probes, command-line milestone verification, database maintenance, Security Seed refreshes, status queries, and retry and error paths (Commonlib PR #112).
    - This covers every temporary connection currently identified as a possible contributor to the long-running resource growth tracked in #1034. Validation over extended sessions is continuing.
    - Thank you to @apple-ouyang for the contribution!

## 1.0.13

13th August, 2026

### Conflict handling and recovery

#### Improved

- **Inspect conflicts and file/database differences** now reports local Metadata whose stored document ID does not match the ID derived from its recorded path. Ordinary scans leave unresolved entries and their corresponding Vault paths unchanged, while allowing consistently addressed Metadata for the same logical path to proceed normally.
    - When the current winner has no conflict leaves and has an unambiguous target, its wrench menu can repair that one local Metadata document after separate confirmation. The target is written and verified before the mismatched source ID is removed; ambiguous or otherwise unsafe entries remain read-only.

#### Fixed

- Fast Fetch now writes deletion tombstones to the local database without attempting to decrypt them. A tombstone has no encrypted payload, and decryption previously aborted the whole fetch at the first deleted document. New devices could not complete their initial sync on vaults that contain old deletions (Commonlib PR #108).
    - Thank you to @KennethLloyd for the contribution!

## 1.0.12

11th August, 2026

### Synchronisation and storage

#### Fixed

- One-shot CouchDB replication now closes its temporary remote database after each run and before retrying, preventing inactive PouchDB instances from accumulating during long-running periodic synchronisation (Commonlib PR #75). Thank you to @apple-ouyang for the contribution!
- Start-up and recovery scans now keep failed database-to-Vault writes retryable instead of recording them as successful and later mistaking the still-missing file for a local deletion (Commonlib PR #106).
    - Files over the size limit or in conflict remain deliberately skipped, while actual write failures are reported to Fast Setup, CLI mirror, and daemon callers.
