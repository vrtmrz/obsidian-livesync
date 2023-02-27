### 0.17.0
- 0.17.0 has no surfaced changes but the design of saving chunks has been changed. They have compatibility but changing files after upgrading makes different chunks than before 0.16.x.
  Please rebuild databases once if you have been worried about storage usage.

  - Improved:
    - Splitting markdown
    - Saving chunks

  - Changed:
    - Chunk ID numbering rules

#### Minors
- __0.17.1 to 0.17.15 has been moved into `update_old.md`__

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
- 0.17.18
  - Fixed: Fixed lack of error handling.
- 0.17.19 
  - Fixed: Error reporting has been ensured.
- 0.17.20
  - Improved: Changes of hidden files will be notified to Obsidian.
- 0.17.21
  - Fixed: Skip patterns now handle capital letters.
  - Improved
    - New configuration to avoid exceeding throttle capacity.
      - We have been grateful to @karasevm!
    - The conflicted `data.json` is no longer merged automatically.
      - This behaviour is not configurable, unlike the `Use newer file if conflicted` of normal files.
- 0.17.22
  - Fixed:
    - Now hidden files will not be synchronised while we are not configured.
    - Some processes could start without waiting for synchronisation to complete, but now they will wait for.
  - Improved
    - Now, by placing `redflag3.md`, we can discard the local database and fetch again.
    - The document has been updated! Thanks to @hilsonp!
- 0.17.23
  - Improved:
    - Now we can preserve the logs into the file.
      - Note: This option will be enabled automatically also when we flagging a red flag.
    - File names can now be made platform-appropriate.
  - Refactored:
    - Some redundant implementations have been sorted out.
- 0.17.24
  - New feature:
    - If any conflicted files have been left, they will be reported.
  - Fixed:
    - Now the name of the conflicting file is shown on the conflict-resolving dialogue.
    - Hidden files are now able to be merged again.
    - No longer error caused at plug-in being loaded.
  - Improved:
    - Caching chunks are now limited in total size of cached chunks.
- 0.17.25
  - Fixed:
    - Now reading error will be reported.
- 0.17.26
  - Fixed(Urgent):
    - The modified document will be reflected in the storage now.
- 0.17.27
  - Improved:
    - Now, the filename of the conflicted settings will be shown on the merging dialogue
    - The plugin data can be resolved when conflicted.
    - The semaphore status display has been changed to count only.
    - Applying to the storage will be concurrent with a few files.

... To continue on to `updates_old.md`.