### 0.19.0

#### Customization sync

Since `Plugin and their settings` have been broken, so I tried to fix it, not just fix it, but fix it the way it should be.

Now, we have `Customization sync`.

It is a real shame that the compatibility between these features has been broken. However, this new feature is surely useful and I believe that worth getting over the pain.
We can use the new feature with the same configuration. Only the menu on the command palette has been changed. The dialog can be opened by `Show customization sync dialog`.

I hope you will give it a try.


#### Minors

- 0.19.1 to 0.19.11 has been moved into the updates_old.md
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

... To continue on to `updates_old.md`.
