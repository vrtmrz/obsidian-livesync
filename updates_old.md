### 0.13.0

- The metadata of the deleted files will be kept on the database by default. If you want to delete this as the previous version, please turn on `Delete metadata of deleted files.`. And, if you have upgraded from the older version, please ensure every device has been upgraded.
- Please turn on `Delete metadata of deleted files.` if you are using livesync-classroom or filesystem-livesync.
- We can see the history of deleted files.
- `Pick file to show` was renamed to `Pick a file to show.
- Files in the `Pick a file to show` are now ordered by their modified date descent.
- Update information became to be shown on the major upgrade.

#### Minors
- 0.13.1 Fixed on conflict resolution.
- 0.13.2 Fixed file deletion failures.
- 0.13.4
  - Now, we can synchronise hidden files that conflicted on each devices.
  - We can search for conflicting docs.
  - Pending processes can now be run at any time.
  - Performance improved on synchronising large numbers of files at once.
