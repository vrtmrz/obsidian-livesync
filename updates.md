### 0.22.0
A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history
- 0.22.13:
  - Improved:
    - Now using HTTP for the remote database URI warns of an error (on mobile) or notice (on desktop).
  - Refactored:
    - Dependencies have been polished.
- 0.22.12:
  - Changed:
    - The default settings has been changed.
  - Improved:
    - Default and preferred settings are applied on completion of the wizard.
  - Fixed:
    - Now Initialisation `Fetch` will be performed smoothly and there will be fewer conflicts.
    - No longer stuck while Handling transferred or initialised documents.
- 0.22.11:
  - Fixed:
    - `Verify and repair all files` is no longer broken.
  - New feature:
    - Now `Verify and repair all files` is able to...
      - Restore if the file only in the local database.
      - Show the history.
  - Improved:
    - Performance improved.
- 0.22.10
  - Fixed:
    - No longer unchanged hidden files and customisations are saved and transferred now.
    - File integrity of vault history indicates the integrity correctly.
  - Improved:
    - In the report, the schema of the remote database URI is now printed.
- 0.22.9
  - Fixed:
    - Fixed a bug on `fetch chunks on demand` that could not fetch the chunks on demand.
  - Improved:
    - `fetch chunks on demand` works more smoothly.
    - Initialisation `Fetch` is now more efficient.
  - Tidied:
    - Removed some meaningless codes.
- 0.22.8
  - Fixed:
    - Now fetch and unlock the locked remote database works well again.
    - No longer crash on symbolic links inside hidden folders.
  - Improved:
    - Chunks are now created more efficiently.
      - Splitting old notes into a larger chunk.
    - Better performance in saving notes.
    - Network activities are indicated as an icon.
    - Less memory used for binary processing.
  - Tidied:
    - Cleaned unused functions up.
    - Sorting out the codes that have become nonsense.
  - Changed:
    - Now no longer `fetch chunks on demand` needs `Pacing replication`
      - The setting `Do not pace synchronization` has been deleted.
... To continue on to `updates_old.md`.