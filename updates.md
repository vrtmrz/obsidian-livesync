### 0.22.0
A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history
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
- 0.22.7
  - Fixed:
    - No longer deleted hidden files were ignored.
    - The document history dialogue is now able to process the deleted revisions.
    - Deletion of a hidden file is now surely performed even if the file is already conflicted.
- 0.22.6
  - Fixed:
    - Fixed a problem with synchronisation taking a long time to start in some cases.
      - The first synchronisation after update might take a bit longer.
    - Now we can disable E2EE encryption.
  - Improved:
    - `Setup Wizard` is now more clear.
    - `Minimal Setup` is now more simple.
    - Self-hosted LiveSync now be able to use even if there are vaults with the same name.
      - Database suffix will automatically added.
    - Now Self-hosted LiveSync waits until set-up is complete.
    - Show reload prompts when possibly recommended while settings.
  - New feature:
    - A guidance dialogue prompting for settings will be shown after the installation.
  - Changed
    - `Open setup URI` is now `Use the copied setup URI`
    - `Copy setup URI` is now `Copy current settings as a new setup URI`
    - `Setup Wizard` is now `Minimal Setup`
    - `Check database configuration` is now `Check and Fix database configuration`

... To continue on to `updates_old.md`.