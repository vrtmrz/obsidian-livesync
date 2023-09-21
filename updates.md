### 0.19.0

#### Customization sync

Since `Plugin and their settings` have been broken, so I tried to fix it, not just fix it, but fix it the way it should be.

Now, we have `Customization sync`.

It is a real shame that the compatibility between these features has been broken. However, this new feature is surely useful and I believe that worth getting over the pain.
We can use the new feature with the same configuration. Only the menu on the command palette has been changed. The dialog can be opened by `Show customization sync dialog`.

I hope you will give it a try.


#### Minors

- 0.19.1 to 0.19.17 has been moved into the updates_old.md

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
Fixed:
- Now the synchronisation will begin without our interaction.
- No longer puts the configuration of the remote database into the log while checking configuration.
- Some outdated description notes have been removed.
- Options that are meaningless depending on other settings configured are now hidden.
  - Scan for hidden files before replication
  - Scan customization periodically

... To continue on to `updates_old.md`.
