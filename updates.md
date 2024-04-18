### 0.22.0
A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history
- 0.22.18
  - New feature (Very Experimental):
    - Now we can use `Automatic data compression` to reduce amount of traffic and the usage of remote database.
      - Please make sure all devices are updated to v0.22.18 before trying this feature.
      - If you are using some other utilities which connected to your vault, please make sure that they have compatibilities. 
      - Note: Setting `File Compression` on the remote database works for shrink the size of remote database. Please refer the [Doc](https://docs.couchdb.org/en/stable/config/couchdb.html#couchdb/file_compression).
- 0.22.17:
  - Fixed:
    - Error handling on booting now works fine.
    - Replication is now started automatically in LiveSync mode.
    - Batch database update is now disabled in LiveSync mode.
    - No longer automatically reconnection while off-focused.
    - Status saves are thinned out.
    - Now Self-hosted LiveSync waits for all files between the local database and storage to be surely checked.
  - Improved:
    - The job scheduler is now more robust and stable.
    - The status indicator no longer flickers and keeps zero for a while.
    - No longer meaningless frequent updates of status indicators.
    - Now we can configure regular expression filters in handy UI. Thank you so much, @eth-p!
    - `Fetch` or `Rebuild everything` is now more safely performed.
  - Minor things
    - Some utility function has been added.
    - Customisation sync now less wrong messages.
    - Digging the weeds for eradication of type errors.
- 0.22.16:
  - Fixed:
    - Fixed the issue that binary files were sometimes corrupted.
    - Fixed customisation sync data could be corrupted.
  - Improved:
    - Now the remote database costs lower memory.
      - This release requires a brief wait on the first synchronisation, to track the latest changeset again.
    - Description added for the `Device name`.
  - Refactored:
    - Many type-errors have been resolved.
    - Obsolete file has been deleted.
- 0.22.15:
  - Improved:
    - Faster start-up by removing too many logs which indicates normality
    - By streamlined scanning of customised synchronisation extra phases have been deleted.
... To continue on to `updates_old.md`.