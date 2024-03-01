### 0.22.0
A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history
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
- 0.22.5
  - Fixed:
    - Some description of settings have been refined
  - New feature:
    - TroubleShooting is now shown in the setting dialogue.
- 0.22.4
  - Fixed:
    - Now the result of conflict resolution could be surely written into the storage.
    - Deleted files can be handled correctly again in the history dialogue and conflict dialogue.
    - Some wrong log messages were fixed.
    - Change handling now has become more stable.
    - Some event handling became to be safer.
  - Improved:
    - Dumping document information shows conflicts and revisions.
    - The timestamp-only differences can be surely cached.
    - Timestamp difference detection can be rounded by two seconds.
  - Refactored:
    - A bit of organisation to write the test.
- 0.22.3
  - Fixed:
    - No longer detects storage changes which have been caused by Self-hosted LiveSync itself.
    - Setting sync file will be detected only if it has been configured now.
      - And its log will be shown only while the verbose log is enabled.
    - Customisation file enumeration has got less blingy.
    - Deletion of files is now reliably synchronised.
  - Fixed and improved:
    - In-editor-status is now shown in the following areas:
      - Note editing pane (Source mode and live-preview mode).
      - New tab pane.
      - Canvas pane.
- 0.22.2
  - Fixed:
    - Now the results of resolving conflicts are surely synchronised.
  - Modified:
    - Some setting items got new clear names. (`Sync Settings` -> `Targets`).
  - New feature:
    - We can limit the synchronising files by their size. (`Sync Settings` -> `Targets` -> `Maximum file size`).
      - It depends on the size of the newer one.
      - At Obsidian 1.5.3 on mobile, we should set this to around 50MB to avoid restarting Obsidian.
    - Now the settings could be stored in a specific markdown file to synchronise or switch it (`General Setting` -> `Share settings via markdown`).
      - [Screwdriver](https://github.com/vrtmrz/obsidian-screwdriver) is quite good, but mostly we only need this.
    - Customisation of the obsoleted device is now able to be deleted at once.
      - We have to put the maintenance mode in at the Customisation sync dialogue.
- 0.22.1
  - New feature:
    - We can perform automatic conflict resolution for inactive files, and postpone only manual ones by `Postpone manual resolution of inactive files`.
    - Now we can see the image in the document history dialogue.
      - We can see the difference of the image, in the document history dialogue.
        - And also we can highlight differences.
  - Improved:
    - Hidden file sync has been stabilised.
    - Now automatically reloads the conflict-resolution dialogue when new conflicted revisions have arrived.
  - Fixed:
    - No longer periodic process runs after unloading the plug-in.
    - Now the modification of binary files is surely stored in the storage.
- 0.22.0
  - Refined:
    - Task scheduling logics has been rewritten.
    - Screen updates are also now efficient.
    - Possibly many bugs and fragile behaviour has been fixed.
    - Status updates and logging have been thinned out to display.
  - Fixed:
    - Remote-chunk-fetching now works with keeping request intervals
  - New feature:
    - We can show only the icons in the editor.
    - Progress indicators have been more meaningful:
      -   📥 Unprocessed transferred items
      -   📄 Working database operation
      -   💾 Working write storage processes
      -   ⏳ Working read storage processes
      -   🛫 Pending read storage processes
      -   ⚙️ Working or pending storage processes of hidden files
      -   🧩 Waiting chunks
      -   🔌 Working Customisation items (Configuration, snippets and plug-ins)


... To continue on to `updates_old.md`.