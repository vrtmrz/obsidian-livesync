# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

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
    - When one live, unconflicted entry has an unambiguous target, its wrench menu can repair that one local Metadata document after separate confirmation. The target is written and verified before the mismatched source ID is removed; ambiguous or otherwise unsafe entries remain read-only.
 
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
