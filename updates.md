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
- 0.23.13:
  - Fixed:
    - No longer files have been trimmed even delimiters have been continuous.
    - Fixed the toggle title to `Do not split chunks in the background` from `Do not split chunks in the foreground`.
    - Non-configured item mismatches are no longer detected.
- 0.23.12:
  - Improved:
    - Now notes will be split into chunks in the background thread to improve smoothness.
      - Default enabled, to disable, toggle `Do not split chunks in the foreground` on `Hatch` -> `Compatibility`.
      - If you want to process very small notes in the foreground, please enable `Process small files in the foreground` on `Hatch` -> `Compatibility`.
    - We can use a `splitting-limit-capped chunk splitter`; which performs more simple and make less amount of chunks.
      - Default disabled, to enable, toggle `Use splitting-limit-capped chunk splitter` on `Sync settings` -> `Performance tweaks`
  - Tidied
    - Some files have been separated into multiple files to make them more explicit in what they are responsible for.
- 0.23.11:
  - Fixed:
    - Now we *surely* can set the device name and enable customised synchronisation.
    - Unnecessary dialogue update processes have been eliminated.
    - Customisation sync no longer stores half-collected files.
    - No longer hangs up when removing or renaming files with the `Sync on Save` toggle enabled.
  - Improved:
    - Customisation sync now performs data deserialization more smoothly.
    - New translations have been merged.
- 0.23.10
  - Fixed:
    - No longer configurations have been locked in the minimal setup.
- 0.23.9
  - Fixed:
    - No longer unexpected parallel replication is performed.
    - Now we can set the device name and enable customised synchronisation again.


Older notes is in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).