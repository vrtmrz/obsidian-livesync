### 0.19.0

#### Customization sync

Since `Plugin and their settings` have been broken, so I tried to fix it, not just fix it, but fix it the way it should be.

Now, we have `Customization sync`.

It is a real shame that the compatibility between these features has been broken. However, this new feature is surely useful and I believe that worth getting over the pain.
We can use the new feature with the same configuration. Only the menu on the command palette has been changed. The dialog can be opened by `Show customization sync dialog`.

I hope you will give it a try.


#### Minors

- 0.19.1 to 0.19.6 has been moved into the updates_old.md
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
- 0.19.9
  - New feature (For fixing a problem):
    - We can fix the database obfuscated and plain paths that have been mixed up.
  - Improvements
    - Customisation Sync performance has been improved.
- 0.19.10
  - Fixed
    - Fixed the issue about fixing the database.
- 0.19.11
  - Improvements:
    - Hashing ChunkID has been improved.
    - Logging keeps 400 lines now.
  - Refactored:
    - Import statement has been fixed about types.

... To continue on to `updates_old.md`.
