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
- 0.23.9
  - Fixed:
    - No longer unexpected parallel replication is performed.
    - Now we can set the device name and enable customised synchronisation again.
- 0.23.8
  - New feature:
    - Now we are ready for i18n. 
      - Patch or PR of `rosetta.ts` are welcome!
    - The setting dialogue has been refined. Very controllable, clearly displayed disabled items, and ready to i18n.
  - Fixed:
    - Many memory leaks have been rescued.
    - Chunk caches now work well.
    - Many trivial but potential bugs are fixed.
    - No longer error messages will be shown on retrieving checkpoint or server information.
    - Now we can check and correct tweak mismatch during the setup
  - Improved:
    - Customisation synchronisation has got more smoother.
  - Tidied
    - Practically unused functions have been removed or are being prepared for removal.
    - Many of the type-errors and lint errors have been corrected.
    - Unused files have been removed.
  - Note:
    - From this version, some test files have been included. However, they are not enabled and released in the release build.
      - To try them, please run Self-hosted LiveSync in the dev build.
- 0.23.7
  - Fixed:
    - No longer missing tasks which have queued as the same key (e.g., for the same operation to the same file).
      - This occurs, for example, with hidden files that have been changed multiple times in a very short period of time, such as `appearance.json`. Thanks for the report!
    - Some trivial issues have been fixed.
  - New feature:
    - Reloading Obsidian can be scheduled until that file and database operations are stable.

Older notes is in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).