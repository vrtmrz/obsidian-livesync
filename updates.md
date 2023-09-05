### 0.19.0

#### Customization sync

Since `Plugin and their settings` have been broken, so I tried to fix it, not just fix it, but fix it the way it should be.

Now, we have `Customization sync`.

It is a real shame that the compatibility between these features has been broken. However, this new feature is surely useful and I believe that worth getting over the pain.
We can use the new feature with the same configuration. Only the menu on the command palette has been changed. The dialog can be opened by `Show customization sync dialog`.

I hope you will give it a try.


#### Minors

- 0.19.1 to 0.19.14 has been moved into the updates_old.md
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

... To continue on to `updates_old.md`.
