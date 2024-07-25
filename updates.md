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
- 0.23.18:
  - New feature:
    - Per-file-saved customization sync has been shipped.
      - We can synchronise plug-igs etc., more smoothly.
      - Default: disabled. We need a small migration when enabling this. And all devices should be updated to v0.23.18. Once we enabled this, we lost compatibility with old versions.
    - Customisation sync has got beta3.
      - We can set `Flag` to each item to select the newest, automatically.
        - This configuration is per device.
  - Improved:
    - Start-up speed has been improved.
  - Fixed:
    - On the customisation sync dialogue, buttons are kept within the screen.
    - No more unnecessary entries on `data.json` for customisation sync.
    - Selections are no longer lost while updating customisation items.
  - Tidied on source codes:
    - Many typos have been fixed.
    - Some unnecessary type casting removed.
- 0.23.17:
  - Improved:
    - Overall performance has been improved by using PouchDB 9.0.0.
    - Configuration mismatch detection is refined. We can resolve mismatches more smoothly and naturally.
    More detail is on `troubleshooting.md` on the repository.
  - Fixed:
    - Customisation Sync will be disabled when a corrupted configuration is detected.
      Therefore, the Device Name can be changed even in the event of a configuration mismatch.
  - New feature:
    - We can get a notification about the storage usage of the remote database.
      - Default: We will be asked.
      - If the remote storage usage approaches the configured value, we will be asked whether we want to Rebuild or increase the limit.
- 0.23.16:
  - Maintenance Update:
    - Library refining (Phase 1 - step 2). There are no significant changes on the user side.
    - Including the following fixes of potentially problems:
      - the problem which the path had been obfuscating twice has been resolved.
      - Note: Potential problems of the library; which has not happened in Self-hosted LiveSync for some reasons.
- 0.23.15:
  - Maintenance Update:
    - Library refining (Phase 1). There are no significant changes on the user side.
- 0.23.14:
  - Fixed:
    - No longer batch-saving ignores editor inputs.
    - The file-watching and serialisation processes have been changed to the one which is similar to previous implementations.
    - We can configure the settings (Especially about text-boxes) even if we have configured the device name.
  - Improved:
    - We can configure the delay of batch-saving.
      - Default: 5 seconds, the same as the previous hard-coded value. (Note: also, the previous behaviour was not correct).
    - Also, we can configure the limit of delaying batch-saving.
    - The performance of showing status indicators has been improved.


Older notes is in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).