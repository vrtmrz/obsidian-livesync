### 0.23.0
Incredibly new features!

Now, we can use object storage (MinIO, S3, R2 or anything you like) for synchronising! Moreover, despite that, we can use all the features as if we were using CouchDB.
Note: As this is a pretty experimental feature, hence we have some limitations.
- This is built on the append-only architecture. It will not shrink used storage if we do not perform a rebuild.
- A bit fragile. However, our version x.yy.0 is always so.
- When the first synchronisation, the entire history to date is transferred. For this reason, it is preferable to do this under the WiFi network.
- Do not worry, from the second synchronisation, we always transfer only differences.

I hope this feature empowers users to maintain independence and self-host their data, offering an alternative for those who prefer to manage their own storage solutions and avoid being stuck on the right side of a sudden change in business model.

Of course, I use Self-hosted MinIO for testing and recommend this. It is for the same reason as using CouchDB. -- open, controllable, auditable and indeed already audited by numerous eyes.

Let me write one more acknowledgement.

I have a lot of respect for that plugin, even though it is sometimes treated as if it is a competitor, remotely-save. I think it is a great architecture that embodies a different approach to my approach of recreating history. This time, with all due respect, I have used some of its code as a reference.
Hooray for open source, and generous licences, and the sharing of knowledge by experts.

#### Version history
- 0.23.4
  - Fixed:
    - No longer experimental configuration is shown on the Minimal Setup.
  - New feature:
    - We can now use `Incubate Chunks in Document` to reduce non-well-formed chunks.
      - Default: disabled / Preferred: enabled in all devices.
      - When we enabled this toggle, newly created chunks are temporarily kept within the document, and graduated to become independent chunks once stabilised.
      - The [design document](https://github.com/vrtmrz/obsidian-livesync/blob/3925052f9290b3579e45a4b716b3679c833d8ca0/docs/design_docs_of_keep_newborn_chunks.md) has been also available..
- 0.23.3
  - Fixed: No longer unwanted `\f` in journal sync.
- 0.23.2
  - Sorry for all the fixes to experimental features. (These things were also critical for dogfooding). The next release would be the main fixes! Thank you for your patience and understanding!
  - Fixed:
    - Journal Sync will not hang up during big replication, especially the initial one.
    - All changes which have been replicated while rebuilding will not be postponed (Previous behaviour).
  - Improved:
    - Now Journal Sync works efficiently in download and parse, or pack and upload.
    - Less server storage and faster packing/unpacking usage by the new chunk format.
- 0.23.1
  - Fixed:
    - Now journal synchronisation considers untransferred each from sent and received.
    - Journal sync now handles retrying.
    - Journal synchronisation no longer considers the synchronisation of chunks as revision updates (Simply ignored).
    - Journal sync now splits the journal pack to prevent mobile device rebooting.
    - Maintenance menus which had been on the command palette are now back in the maintain pane on the setting dialogue.
  - Improved:
    - Now all changes which have been replicated while rebuilding will be postponed.

- 0.23.0
  - New feature:
    - Now we can use Object Storage.


### 0.22.0
A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history
- 0.22.19
  - Fixed:
    - No longer data corrupting due to false BASE64 detections.
  - Improved:
    - A bit more efficient in Automatic data compression.
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
- 0.22.14:
  - New feature:
    - We can disable the status bar in the setting dialogue.
  - Improved:
    - Now some files are handled as correct data type.
    - Customisation sync now uses the digest of each file for better performance.
    - The status in the Editor now works performant.
  - Refactored:
    - Common functions have been ready and the codebase has been organised.
    - Stricter type checking following TypeScript updates.
    - Remove old iOS workaround for simplicity and performance.
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

### 0.21.0
The E2EE encryption V2 format has been reverted. That was probably the cause of the glitch.
Instead, to maintain efficiency, files are treated with Blob until just before saving. Along with this, the old-fashioned encryption format has also been discontinued.
There are both forward and backwards compatibilities, with recent versions. However, unfortunately, we lost compatibility with filesystem-livesync or some.
It will be addressed soon. Please be patient if you are using filesystem-livesync with E2EE.

- 0.21.5
  - Improved:
    - Now all revisions will be shown only its first a few letters.
    - Now ID of the documents is shown in the log with the first 8 letters.
  - Fixed:
    - Check before modifying files has been implemented.
    - Content change detection has been improved.
- 0.21.4
  - This release had been skipped.
- 0.21.3
  - Implemented:
    - Now we can use SHA1 for hash function as fallback.
- 0.21.2
  - IMPORTANT NOTICE: **0.21.1 CONTAINS A BUG WHILE REBUILDING THE DATABASE. IF YOU HAVE BEEN REBUILT, PLEASE MAKE SURE THAT ALL FILES ARE SANE.**
    - This has been fixed in this version.
  - Fixed:
    - No longer files are broken while rebuilding.
    - Now, Large binary files can be written correctly on a mobile platform.
    - Any decoding errors now make zero-byte files.
  - Modified:
    - All files are processed sequentially for each.
- 0.21.1
  - Fixed:
    - No more infinity loops on larger files.
    - Show message on decode error.
  - Refactored:
    - Fixed to avoid obsolete global variables.
- 0.21.0
  - Changes and performance improvements:
    - Now the saving files are processed by Blob.
    - The V2-Format has been reverted.
    - New encoding format has been enabled in default.
    - WARNING: Since this version, the compatibilities with older Filesystem LiveSync have been lost.

## 0.20.0
At 0.20.0, Self-hosted LiveSync has changed the binary file format and encrypting format, for efficient synchronisation.  
The dialogue will be shown and asks us to decide whether to keep v1 or use v2. Once we have enabled v2, all subsequent edits will be saved in v2. Therefore, devices running 0.19 or below cannot understand this and they might say that decryption error. Please update all devices.  
Then we will have an impressive performance.

Of course, these are very impactful changes. If you have any questions or troubled things, please feel free to open an issue and mention me.

Note: if you want to roll it back to v1, please enable `Use binary and encryption version 1` on the `Hatch` pane and perform the `rebuild everything` once.

Extra but notable information:

This format change gives us the ability to detect some `marks` in the binary files as same as text files. Therefore, we can split binary files and some specific sort of them (i.e., PDF files) at the specific character. It means that editing the middle of files could be detected with marks.

Now only a few chunks are transferred, even if we add a comment to the PDF or put new files into the ZIP archives.


- 0.20.7
  - Fixed
    - To better replication, path obfuscation is now deterministic even if with E2EE.  
      Note: Compatible with previous database without any conversion. Only new files will be obfuscated in deterministic. 
- 0.20.6
  - Fixed
    - Now empty file could be decoded.
    - Local files are no longer pre-saved before fetching from a remote database.
    - No longer deadlock while applying customisation sync.
    - Configuration with multiple files is now able to be applied correctly.
    - Deleting folder propagation now works without enabling the use of a trash bin.
- 0.20.5
  - Fixed
    - Now the files which having digit or character prefixes in the path will not be ignored.
- 0.20.4
  - Fixed
    - The text-input-dialogue is no longer broken.
      - Finally, we can use the Setup URI again on mobile.
- 0.20.3
  - New feature:
    - We can launch Customization sync from the Ribbon if we enabled it.
  - Fixed:
    - Setup URI is now back to the previous spec; be encrypted by V1.
      - It may avoid the trouble with iOS 17.
    - The Settings dialogue is now registered at the beginning of the start-up process.
      - We can change the configuration even though LiveSync could not be launched in normal.
  - Improved:
    - Enumerating documents has been faster.
- 0.20.2
  - New feature:
    - We can delete all data of customization sync from the `Delete all customization sync data` on the `Hatch` pane.
  - Fixed:
    - Prevent keep restarting on iOS by yielding microtasks.
- 0.20.1 
  - Fixed:
    - No more UI freezing and keep restarting on iOS.
    - Diff of Non-markdown documents are now shown correctly.
  - Improved:
    - Performance has been a bit improved.
    - Customization sync has gotten faster.
      - However, We lost forward compatibility again (only for this feature). Please update all devices.
  - Misc
    - Terser configuration has been more aggressive.
- 0.20.0
  - Improved:
    - A New binary file handling implemented
    - A new encrypted format has been implemented
    - Now the chunk sizes will be adjusted for efficient sync
  - Fixed:
    - levels of exception in some logs have been fixed
  - Tidied:
    - Some Lint warnings have been suppressed.

### 0.19.0

#### Customization sync

Since `Plugin and their settings` have been broken, so I tried to fix it, not just fix it, but fix it the way it should be.

Now, we have `Customization sync`.

It is a real shame that the compatibility between these features has been broken. However, this new feature is surely useful and I believe that worth getting over the pain.
We can use the new feature with the same configuration. Only the menu on the command palette has been changed. The dialog can be opened by `Show customization sync dialog`.

I hope you will give it a try.

#### Minors
- 0.19.1
  - Fixed: Fixed hidden file handling on Linux
  - Improved: Now customization sync works more smoothly.
- 0.19.2
  - Fixed:
    - Fixed garbage collection error while unreferenced chunks exist many.
    - Fixed filename validation on Linux.
  - Improved:
    - Showing status is now thinned for performance.
    - Enhance caching while collecting chunks.
- 0.19.3
  - Improved:
    - Now replication will be paced by collecting chunks. If synchronisation has been deadlocked, please enable `Do not pace synchronization` once.
- 0.19.4
  - Improved:
    - Reduced remote database checking to improve speed and reduce bandwidth.
  - Fixed:
    - Chunks which previously misinterpreted are now interpreted correctly.
      - No more missing chunks which not be found forever, except if it has been actually missing.
    - Deleted file detection on hidden file synchronising now works fine.
    - Now the Customisation sync is surely quiet while it has been disabled.
- 0.19.5
  - Fixed:
    - Now hidden file synchronisation would not be hanged, even if so many files exist.
  - Improved:
    - Customisation sync works more smoothly.
  - Note: Concurrent processing has been rollbacked into the original implementation. As a result, the total number of processes is no longer shown next to the hourglass icon. However, only the processes that are running concurrently are shown.
- 0.19.6
  - Fixed:
    - Logging has been tweaked.
    - No more too many planes and rockets.
    - The batch database update now surely only works in non-live mode.
  - Internal things:
    - Some frameworks has been upgraded.
    - Import declaration has been fixed.
  - Improved:
    - The plug-in now asks to enable a new adaptor, when rebuilding, if it is not enabled yet.
    - The setting dialogue refined.
      - Configurations for compatibilities have been moved under the hatch.
      - Made it clear that disabled is the default.
      - Ambiguous names configuration have been renamed.
      - Items that have no meaning in the settings are no longer displayed.
      - Some items have been reordered for clarity.
      - Each configuration has been grouped.
- 0.19.7
  - Fixed:
    - The initial pane of Setting dialogue is now changed to General Settings.
    - The Setup Wizard is now able to flush existing settings and get into the mode again.
- 0.19.8
  - New feature:
    - Vault history: A tab has been implemented to give a birds-eye view of the changes that have occurred in the vault.
  - Improved:
    - Now the passphrases on the dialogue masked out. Thank you @antoKeinanen!
    - Log dialogue is now shown as one of tabs.
  - Fixed:
    - Some minor issues has been fixed.
- 0.19.9
  - New feature (For fixing a problem):
    - We can fix the database obfuscated and plain paths that have been mixed up.
  - Improvements
    - Customisation Sync performance has been improved.
- 0.19.10
  - Fixed
    - Fixed the issue about fixing the database.
- 0.19.11
  - Improvements:
    - Hashing ChunkID has been improved.
    - Logging keeps 400 lines now.
  - Refactored:
    - Import statement has been fixed about types.
- 0.19.12
  - Improved:
    - Boot-up performance has been improved.
    - Customisation sync performance has been improved.
    - Synchronising performance has been improved.
- 0.19.13
  - Implemented:
    - Database clean-up is now in beta 2!
      We can shrink the remote database by deleting unused chunks, with keeping history.
      Note: Local database is not cleaned up totally. We have to `Fetch` again to let it done.
      **Note2**: Still in beta. Please back your vault up anything before.
  - Fixed:
    - The log updates are not thinned out now.
- 0.19.14
  - Fixed:
    - Internal documents are now ignored.
    - Merge dialogue now respond immediately to button pressing.
    - Periodic processing now works fine.
    - The checking interval of detecting conflicted has got shorter.
    - Replication is now cancelled while cleaning up.
    - The database locking by the cleaning up is now carefully unlocked.
    - Missing chunks message is correctly reported.
  - New feature:
    - Suspend database reflecting has been implemented.
      - This can be disabled by `Fetch database with previous behaviour`.
    - Now fetch suspends the reflecting database and storage changes temporarily to improve the performance.
    - We can choose the action when the remote database has been cleaned
    - Merge dialogue now show `↲` before the new line.
  - Improved:
    - Now progress is reported while the cleaning up and fetch process.
    - Cancelled replication is now detected.
- 0.19.15
  - Fixed:
    - Now storing files after cleaning up is correct works.
  - Improved:
    - Cleaning the local database up got incredibly fastened.
      Now we can clean instead of fetching again when synchronising with the remote which has been cleaned up.
- 0.19.16
  - Many upgrades on this release. I have tried not to let that happen, if something got corrupted, please feel free to notify me.
  - New feature:
    - (Beta) ignore files handling
      We can use `.gitignore`, `.dockerignore`, and anything you like to filter the synchronising files.
  - Fixed:
    - Buttons on lock-detected-dialogue now can be shown in narrow-width devices.
  - Improved:
    - Some constant has been flattened to be evaluated.
    - The usage of the deprecated API of obsidian has been reduced.
    - Now the indexedDB adapter will be enabled while the importing configuration.
  - Misc:
  - Compiler, framework, and dependencies have been upgraded.
  - Due to standing for these impacts (especially in esbuild and svelte,) terser has been introduced. 
    Feel free to notify your opinion to me! I do not like to obfuscate the code too.
- 0.19.17
  - Fixed:
    - Now nested ignore files could be parsed correctly.
    - The unexpected deletion of hidden files in some cases has been corrected.
    - Hidden file change is no longer reflected on the device which has made the change itself.
  - Behaviour changed:
    - From this version, the file which has `:` in its name should be ignored even if on Linux devices.
- 0.19.18
  - Fixed:
    - Now the empty (or deleted) file could be conflict-resolved.
- 0.19.19
  - Fixed:
    - Resolving conflicted revision has become more robust.
    - LiveSync now try to keep local changes when fetching from the rebuilt remote database.
      Local changes now have been kept as a revision and fetched things will be new revisions.
    - Now, all files will be restored after performing `fetch` immediately.
- 0.19.20
  - New feature:
    - `Sync on Editor save` has been implemented
      - We can start synchronisation when we save from the Obsidian explicitly.
    - Now we can use the `Hidden file sync` and the `Customization sync` cooperatively.
      - We can exclude files from `Hidden file sync` which is already handled in Customization sync.
    - We can ignore specific plugins in Customization sync.
    - Now the message of leftover conflicted files accepts our click.
      - We can open `Resolve all conflicted files` in an instant.
  - Refactored:
    - Parallelism functions made more explicit.
    - Type errors have been reduced.
  - Fixed:
    - Now documents would not be overwritten if they are conflicted.
      It will be saved as a new conflicted revision.
    - Some error messages have been fixed.
    - Missing dialogue titles have been shown now.
      - We can click close buttons on mobile now.
    - Conflicted Customisation sync files will be resolved automatically by their modified time.
- 0.19.21
  - Fixed:
    - Hidden files are no longer handled in the initial replication.
    - Report from `Making report` fixed
      - No longer contains customisation sync information.
      - Version of LiveSync has been added.
- 0.19.22
  - Fixed:
    - Now the synchronisation will begin without our interaction.
    - No longer puts the configuration of the remote database into the log while checking configuration.
    - Some outdated description notes have been removed.
    - Options that are meaningless depending on other settings configured are now hidden.
      - Scan for hidden files before replication
      - Scan customization periodically
- 0.19.23
  -Improved:
    - We can open the log pane also from the command palette now.
    - Now, the hidden file scanning interval could be configured to 0.
    - `Check database configuration` now points out that we do not have administrator permission.


### 0.18.0

#### Now, paths of files in the database can now be obfuscated. (Experimental Feature)
At before v0.18.0, Self-hosted LiveSync used the path of files, to detect and resolve conflicts. In naive. The ID of the document stored in the CouchDB was naturally the filename.
However, it means a sort of lacking confidentiality. If the credentials of the database have been leaked, the attacker (or an innocent bystander) can read the path of files. So we could not use confidential things in the filename in some environments.
Since v0.18.0, they can be obfuscated. so it is no longer possible to decipher the path from the ID. Instead of that, it costs a bit CPU load than before, and the data structure has been changed a bit.

We can configure the `Path Obfuscation` in the `Remote database configuration` pane.  
Note: **When changing this configuration, we need to rebuild both of the local and the remote databases**.

#### Minors 
- 0.18.1
  - Fixed:
    - Some messages are fixed (Typo)
    - File type detection now works fine!
- 0.18.2
  - Improved:
    - The setting pane has been refined.
    - We can enable `hidden files sync` with several initial behaviours; `Merge`, `Fetch` remote, and `Overwrite` remote.
    - No longer `Touch hidden files`.
- 0.18.3
  - Fixed Pop-up is now correctly shown after hidden file synchronisation.
- 0.18.4
  - Fixed:
      - `Fetch` and `Rebuild database` will work more safely.
      - Case-sensitive renaming now works fine.
        Revoked the logic which was made at #130, however, looks fine now.
- 0.18.5
  - Improved:
    - Actions for maintaining databases moved to the `🎛️Maintain databases`.
    - Clean-up of unreferenced chunks has been implemented on an **experimental**.
      - This feature requires enabling `Use new adapter`.
      - Be sure to fully all devices synchronised before perform it.
      - After cleaning up the remote, all devices will be locked out. If we are sure had it be synchronised, we can perform only cleaning-up locally. If not, we have to perform `Fetch`.

- 0.18.6
  - New features:
    - Now remote database cleaning-up will be detected automatically.
    - A solution selection dialogue will be shown if synchronisation is rejected after cleaning or rebuilding the remote database.
    - During fetching or rebuilding, we can configure `Hidden file synchronisation` on the spot.
      - It let us free from conflict resolution on initial synchronising.

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
- 0.17.34
  - Fixed: The `Fetch` that was broken at 0.17.33 has been fixed.
  - Refactored again: Internal file sync, plug-in sync and Set up URI have been moved into each file.

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

### 0.15.0
- Outdated configuration items have been removed. 
- Setup wizard has been implemented!

I appreciate for reviewing and giving me advice @Pouhon158!

#### Minors
- 0.15.1 Missed the stylesheet.
- 0.15.2 The wizard has been improved and documented!
- 0.15.3 Fixed the issue about locking/unlocking remote database while rebuilding in the wizard.
- 0.15.4 Fixed issues about asynchronous processing (e.g., Conflict check or hidden file detection)
- 0.15.5 Add new features for setting Self-hosted LiveSync up more easier.
- 0.15.6 File tracking logic has been refined.
- 0.15.7 Fixed bug about renaming file.
- 0.15.8 Fixed bug about deleting empty directory, weird behaviour on boot-sequence on mobile devices.
- 0.15.9 Improved chunk retrieving, now chunks are retrieved in batch on continuous requests.
- 0.15.10 Fixed:
  - The boot sequence has been corrected and now boots smoothly.
  - Auto applying of batch save will be processed earlier than before.

### 0.14.1
- The target selecting filter was implemented.
  Now we can set what files are synchronised by regular expression.
- We can configure the size of chunks.
  We can use larger chunks to improve performance.
  (This feature can not be used with IBM Cloudant)
-  Read chunks online.
  Now we can synchronise only metadata and retrieve chunks on demand. It reduces local database size and time for replication.
- Added this note.
- Use local chunks in preference to remote them if present,

#### Recommended configuration for Self-hosted CouchDB
- Set chunk size to around 100 to 250 (10MB - 25MB per chunk)
- *Set batch size to 100 and batch limit to 20 (0.14.2)*
- Be sure to `Read chunks online` checked.

#### Minors
- 0.14.2 Fixed issue about retrieving files if synchronisation has been interrupted or failed
- 0.14.3 New test items have been added to `Check database configuration`.
- 0.14.4 Fixed issue of importing configurations.
- 0.14.5 Auto chunk size adjusting implemented.
- 0.14.6 Change Target to ES2018
- 0.14.7 Refactor and fix typos.
- 0.14.8 Refactored again. There should be no change in behaviour, but please let me know if there is any.

### 0.13.0

- The metadata of the deleted files will be kept on the database by default. If you want to delete this as the previous version, please turn on `Delete metadata of deleted files.`. And, if you have upgraded from the older version, please ensure every device has been upgraded.
- Please turn on `Delete metadata of deleted files.` if you are using livesync-classroom or filesystem-livesync.
- We can see the history of deleted files.
- `Pick file to show` was renamed to `Pick a file to show.
- Files in the `Pick a file to show` are now ordered by their modified date descent.
- Update information became to be shown on the major upgrade.

#### Minors
- 0.13.1 Fixed on conflict resolution.
- 0.13.2 Fixed file deletion failures.
- 0.13.4
  - Now, we can synchronise hidden files that conflicted on each devices.
  - We can search for conflicting docs.
  - Pending processes can now be run at any time.
  - Performance improved on synchronising large numbers of files at once.
