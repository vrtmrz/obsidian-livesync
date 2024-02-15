### 0.22.0
A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history
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