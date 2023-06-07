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

... To continue on to `updates_old.md`.
