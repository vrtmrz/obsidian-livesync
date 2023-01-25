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

- 0.17.3
  - Now we supported canvas! And conflicted JSON files are also synchronised with merging its content if they are obvious.

- 0.17.4
  - Canvases are now treated as a sort of plain text file. now we transfer only the metadata and chunks that have differences.

- 0.17.5 Now `read chunks online` had been fixed, and a new feature: `Use dynamic iteration count` to reduce the load on encryption/decryption.
  Note: `Use dynamic iteration count` is not compatible with earlier versions.
- 0.17.6 Now our renamed/deleted files have been surely deleted again.
- 0.17.7
  - Fixed:
    - Fixed merging issues.
    - Fixed button styling.
  - Changed:
    - Conflict checking on synchronising has been enabled for every note in default.
- 0.17.8
  - Improved: Performance improved. Prebuilt PouchDB is no longer used.
  - Fixed: Merging hidden files is also fixed.
  - New Feature: Now we can synchronise automatically after merging conflicts.
- 0.17.9
  - Fixed: Conflict merge of internal files is no longer broken.
  - Improved: Smoother status display inside the editor.
- 0.17.10
  - Fixed: Large file synchronising has been now addressed!
  Note: When synchronising large files, we have to set `Chunk size` to lower than 50, disable `Read chunks online`, `Batch size` should be set 50-100, and `Batch limit` could be around 20.
- 0.17.11
  - Fixed:
    - Performance improvement
    - Now `Chunk size` can be set to under one hundred.
  - New feature:
    - The number of transfers required before replication stabilises is now displayed.
- 0.17.12: Skipped.
- 0.17.13
  - Fixed: Document history is now displayed again.
  - Reorganised: Many files have been refactored.
- 0.17.14: Skipped.
- 0.17.15
  - Improved:
    - Confidential information has no longer stored in data.json as is.
    - Synchronising progress has been shown in the notification.
    - We can commit passphrases with a keyboard.
    - Configuration which had not been saved yet is marked now.
    - Now the filename is shown on the Conflict resolving dialog
  - Fixed:
    - Hidden files have been synchronised again.
    - Rename of files has been fixed again.
  And, minor changes have been included.

- 0.17.16:
  - Improved:
    - Plugins and their settings no longer need scanning if changes are monitored.
    - Now synchronising plugins and their settings are performed parallelly and faster.
    - We can place `redflag2.md` to rebuild the database automatically while the boot sequence.
  - Experimental:
    - We can use a new adapter on PouchDB. This will make us smoother. 
      - Note: Not compatible with the older version. 
  - Fixed:
    - The default batch size is smaller again.
    - Plugins and their setting can be synchronised again.
    - Hidden files and plugins are correctly scanned while rebuilding.
    - Files with the name started `_` are also being performed conflict-checking.    
- 0.17.17
  - Fixed: Now we can merge JSON files even if we failed to compare items like null.

... To continue on to `updates_old.md`.