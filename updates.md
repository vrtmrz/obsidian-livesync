### 0.15.0
- Outdated configuration items have been removed. 
- Setup wizard has been implemented!

I appreciate for reviewing and giving me advice @Pouhon158!

#### Minors
- 0.15.1 Missed the stylesheet.
- 0.15.2 The wizard has been improved and documented!
- 0.15.3 Fixed the issue about locking/unlocking remote database while rebuilding in the wizard.
- 0.15.4 Fixed issues about asynchronous processing (e.g., Conflict check or hidden file detection)
- 0.15.5 Add new features for setting Self-hosted LiveSync up more easier.
- 0.15.6 File tracking logic has been refined.
- 0.15.7 Fixed bug about renaming file.
- 0.15.8 Fixed bug about deleting empty directory, weird behaviour on boot-sequence on mobile devices.
- 0.15.9 Improved chunk retrieving, now chunks are retrieved in batch on continuous requests.

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

... To continue on to `updates_old.md`.