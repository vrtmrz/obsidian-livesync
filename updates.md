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

... To continue on to `updates_old.md`.
