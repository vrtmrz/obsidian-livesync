### 0.17.0
- 0.17.0 has no surfaced changes but the design of saving chunks has been changed. They have compatibility but changing files after upgrading makes different chunks than before 0.16.x.
  Please rebuild databases once if you have been worried about storage usage.

  - Improved:
    - Splitting markdown
    - Saving chunks

  - Changed:
    - Chunk ID numbering rules

#### Minors
- 0.17.1
  - Fixed: Now we can verify and repair the database.
  - Refactored inside.

- 0.17.2
  - New feature
    - We can merge conflicted documents automatically if sensible.
  - Fixed
    - Writing to the storage will be pended while they have conflicts after replication.

### 0.16.0
- Now hidden files need not be scanned. Changes will be detected automatically.
  - If you want it to back to its previous behaviour, please disable `Monitor changes to internal files`.
  - Due to using an internal API, this feature may become unusable with a major update. If this happens, please disable this once.

#### Minors

- 0.16.1 Added missing log updates.
- 0.16.2 Fixed many problems caused by combinations of `Sync On Save` and the tracking logic that changed at 0.15.6.
- 0.16.3
  - Fixed detection of IBM Cloudant (And if there are some issues, be fixed automatically).
  - A configuration information reporting tool has been implemented.
- 0.16.4 Fixed detection failure. Please set the `Chunk size` again when using a self-hosted database.
- 0.16.5
  - Fixed
    - Conflict detection and merging now be able to treat deleted files.
    - Logs while the boot-up sequence has been tidied up.
    - Fixed incorrect log entries.
  - New Feature
    - The feature of automatically deleting old expired metadata has been implemented.
    We can configure it in `Delete old metadata of deleted files on start-up` in the `General Settings` pane.
- 0.16.6
  - Fixed
    - Automatic (temporary) batch size adjustment has been restored to work correctly.
    - Chunk splitting has been backed to the previous behaviour for saving them correctly.
  - Improved
    - Corrupted chunks will be detected automatically.
    - Now on the case-insensitive system, `aaa.md` and `AAA.md` will be treated as the same file or path at applying changesets.
- 0.16.7 Nothing has been changed except toolsets, framework library, and as like them. Please inform me if something had been getting strange!
- 0.16.8 Now we can synchronise without `bad_request:invalid UTF-8 JSON` even while end-to-end encryption has been disabled.

Note:
Before 0.16.5, LiveSync had some issues making chunks. In this case, synchronisation had became been always failing after a corrupted one should be made. After 0.16.6, the corrupted chunk is automatically detected. Sorry for troubling you but please do `rebuild everything` when this plug-in notified so.
