### 0.17.0
- 0.17.0 has no surfaced changes but the design of saving chunks has been changed. They have compatibility but changing files after upgrading makes different chunks than before 0.16.x.
  Please rebuild databases once if you have been worried about storage usage.

  - Improved:
    - Splitting markdown
    - Saving chunks

  - Changed:
    - Chunk ID numbering rules

#### Minors
- __0.17.1 to 0.17.25 has been moved into `update_old.md`__
- 0.17.26
  - Fixed(Urgent):
    - The modified document will be reflected in the storage now.
- 0.17.27
  - Improved:
    - Now, the filename of the conflicted settings will be shown on the merging dialogue
    - The plugin data can be resolved when conflicted.
    - The semaphore status display has been changed to count only.
    - Applying to the storage will be concurrent with a few files.
- 0.17.28
  -Fixed:
    - Some messages have been refined.
    - Boot sequence has been speeded up.
    - Opening the local database multiple times in a short duration has been suppressed.
    - Older migration logic. 
      - Note: If you have used 0.10.0 or lower and have not upgraded, you will need to run 0.17.27 or earlier once or reinstall Obsidian.
- 0.17.29
  - Fixed:
    - Requests of reading chunks online are now split into a reasonable(and configurable) size.
    - No longer error message will be shown on Linux devices with hidden file synchronisation.
  - Improved:
    - The interval of reading chunks online is now configurable.
    - Boot sequence has been speeded up, more.
  - Misc:
    - Messages on the boot sequence will now be more detailed. If you want to see them, please enable the verbose log.
    - Logs became be kept for 1000 lines while the verbose log is enabled.
- 0.17.30
  - Implemented:
    - `Resolve all conflicted files` has been implemented.
  - Fixed:
    - Fixed a problem about reading chunks online when a file has more chunks than the concurrency limit.
  - Rollbacked:
    - Logs are kept only for 100 lines, again.
- 0.17.31
  - Fixed:
    - Now `redflag3` can be run surely.
    - Synchronisation can now be aborted.
  - Note: The synchronisation flow has been rewritten drastically. Please do not haste to inform me if you have noticed anything.
- 0.17.32
  - Fixed:
    - Now periodic internal file scanning works well.
    - The handler of Window-visibility-changed has been fixed.
    - And minor fixes possibly included.
  - Refactored:
    - Unused logic has been removed.
    - Some utility functions have been moved into suitable files.
    - Function names have been renamed.
- 0.17.33
  - Maintenance update: Refactored; the responsibilities that `LocalDatabase` had were shared. (Hoping) No changes in behaviour.

... To continue on to `updates_old.md`.