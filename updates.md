### 0.17.0
- 0.17.0 has no surfaced changes but the design of saving chunks has been changed. They have compatibility but changing files after upgrading makes different chunks than before 0.16.x.
  Please rebuild databases once if you have been worried about storage usage.

  - Improved:
    - Splitting markdown
    - Saving chunks

  - Changed:
    - Chunk ID numbering rules

#### Minors
- __0.17.1 to 0.17.30 has been moved into `update_old.md`__
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
- 0.17.34
  - Fixed: The `Fetch` that was broken at 0.17.33 has been fixed.
  - Refactored again: Internal file sync, plug-in sync and Set up URI have been moved into each file.
... To continue on to `updates_old.md`.