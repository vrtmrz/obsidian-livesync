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
- 0.23.6:
  - Fixed:
    - Now the remote chunks could be decrypted even if we are using `Incubate chunks in Document`. (The note of 0.23.6 has been fixed).
    - Chunk retrieving with `Incubate chunks in document` got more efficiently.
    - No longer task processor misses the completed tasks.
    - Replication is no longer started automatically during changes in window visibility (e.g., task switching on the desktop) when off-focused.
- 0.23.5:
  - New feature:
    - Now we can check configuration mismatching between clients before synchronisation.
      - Default: enabled / Preferred: enabled / We can disable this by the `Do not check configuration mismatch before replication` toggle in the `Hatch` pane.
      - It detects configuration mismatches and prevents synchronisation failures and wasted storage.
    - Now we can perform remote database compaction from the `Maintenance` pane.
  - Fixed:
    - We can detect the bucket could not be reachable.
  - Note:
    - Known inexplicable behaviour: Recently, (Maybe while enabling `Incubate chunks in Document` and `Fetch chunks on demand` or some more toggles), our customisation sync data is sometimes corrupted. It will be addressed by the next release.
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