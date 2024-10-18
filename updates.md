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
- 0.23.23:
  - Refined:
    - Setting dialogue very slightly refined.
      - The hodgepodge inside the `Hatch` pane has been sorted into more explicit categorised panes.
        - Now we have new panes for:
          - `Selector`
          - `Advanced`
          - `Power users`
          - `Patches (Edge case)`
      - Applying the settings will now be more informative.
        - The header bar will be shown for applying the settings which needs a database rebuild.
        - Applying methods are now more clearly navigated.
      - Definitely, drastic change. I hope this will be more user-friendly. However, if you notice any issues, please let me know. I hope that nothing missed.
  - New features:
    - Word-segmented chunk building on users language
      - Chunks can now be built with word-segmented data, enhancing efficiency for markdown files which contains the multiple sentences in a single line.
      - This feature is enabled by default through `Use Segmented-splitter`. 
        - (Default: Disabled, Please be relived, I have learnt).
  - Fixed:
    - Sending chunks on `Send chunk in bulk` are now buffered to avoid the out-of-memory error.
    - `Send chunk in bulk` is back to default disabled. (Sorry, not applied to the migrated users; I did not think we should deepen the wound any further "automatically").
    - Merging conflicts of JSON files are now works fine even if it contains `null`.
  - Development:
    - Implemented the logic for automatically generating the stub of document for the setting dialogue.
- 0.23.22:
  - Fixed:
    - Case-insensitive file handling
      - Full-lower-case files are no longer created during database checking.
    - Bulk chunk transfer
      - The default value will automatically adjust to an acceptable size when using IBM Cloudant.
- 0.23.21:
  - New Features:
    - Case-insensitive file handling
      - Files can now be handled case-insensitively.
      - This behaviour can be modified in the settings under `Handle files as Case-Sensitive` (Default: Prompt, Enabled for previous behaviour).
    - Improved chunk revision fixing
        - Revisions for chunks can now be fixed for faster chunk creation.
        - This can be adjusted in the settings under `Compute revisions for chunks` (Default: Prompt, Enabled for previous behaviour).
    - Bulk chunk transfer
      - Chunks can now be transferred in bulk during uploads.
      - This feature is enabled by default through `Send chunks in bulk`.
    - Creation of missing chunks without
      - Missing chunks can be created without storing notes, enhancing efficiency for first synchronisation or after prolonged periods without synchronisation.
  - Improvements:
    - File status scanning on the startup
      - Quite significant performance improvements.
      - No more missing scans of some files.
    - Status in editor enhancements
      - Significant performance improvements in the status display within the editor.
      - Notifications for files that will not be synchronised will now be properly communicated.
    - Encryption and Decryption
      - These processes are now performed in background threads to ensure fast and stable transfers.
    - Verify and repair all files
      - Got faster through parallel checking.
    - Migration on update
      - Migration messages and wizards have become more helpful.
  - Behavioural changes:
    - Chunk size adjustments
      - Large chunks will no longer be created for older, stable files, addressing storage consumption issues.
    - Flag file automation
      - Confirmation will be shown and we can cancel it.
  - Fixed:
    - Database File Scanning
      - All files in the database will now be enumerated correctly.
  - Miscellaneous
    - Dependency updated.
    - Now, tree shaking is left to terser, from esbuild.
- 0.23.20:
  - Fixed:
    - Customisation Sync now checks the difference while storing or applying the configuration.
      - No longer storing the same configuration multiple times.
    - Time difference in the dialogue has been fixed.
    - Remote Storage Limit Notification dialogue has been fixed, now the chosen value is saved.
  - Improved:
    - The Enlarging button on the enlarging threshold dialogue now displays the new value.

Older notes is in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).