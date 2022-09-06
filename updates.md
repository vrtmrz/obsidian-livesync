### 0.14.1
- The target selecting filter was implemented.
  Now we can set what files are synchronised by regular expression.
- We can configure the size of chunks.
  We can use larger chunks to improve performance.
  (This feature can not be used with IBM Cloudant)
-  Read chunks online.
  Now we can synchronise only metadata and retrieve chunks on demand. It reduces local database size and time for replication.
- Added this note.
- Use local chunks in preference to remote them if present,

#### Recommended configuration for Self-hosted CouchDB
- Set chunk size to around 100 to 250 (10MB - 25MB per chunk)
- *Set batch size to 100 and batch limit to 20 (0.14.2)*
- Be sure to `Read chunks online` checked.

#### Minors
- 0.14.2 Fixed issue about retrieving files if synchronisation has been interrupted or failed
- 0.14.3 New test items have been added to `Check database configuration`.
- 0.14.4 Fixed issue of importing configurations.
- 0.14.5 Auto chunk size adjusting implemented.
- 0.14.6 Change Target to ES2018
- 0.14.7 Refactor and fix typos.
- 0.14.8 Refactored again. There should be no change in behaviour, but please let me know if there is any.
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
