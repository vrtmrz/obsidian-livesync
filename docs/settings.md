NOTE: This document not completed. I'll improve this doc in a while. but your contributions are always welcome.

# Settings of Self-Hosted LiveSync

There are many settings in self-hosted LiveSync. This document describes each setting in detail (not how-to). Configuration and settings are divided into several categories and indicated by icons. The icon is as follows:

| Icon | Description                                                        |
| :--: | ------------------------------------------------------------------ |
|  💬  | [0. Change Log](#0-change-log)                                     |
|  🧙‍♂️  | [1. Setup](#1-setup)                                               |
|  ⚙️  | [2. General Settings](#2-general-settings)                         |
|  🛰️  | [3. Remote Configuration](#3-remote-configuration)                 |
|  🔄  | [4. Sync Settings](#4-sync-settings)                               |
|  🚦  | [5. Selector (Advanced)](#5-selector-advanced)                     |
|  🔌  | [6. Customization sync (Advanced)](#6-customization-sync-advanced) |
|  🧰  | [7. Hatch](#7-hatch)                                               |
|  🔧  | [8. Advanced (Advanced)](#8-advanced-advanced)                     |
|  💪  | [9. Power users (Power User)](#9-power-users-power-user)           |
|  🩹  | [10. Patches (Edge Case)](#10-patches-edge-case)                   |
|  🎛️  | [11. Maintenance](#11-maintenance)                                 |

## 0. Change Log

This pane shows information about version updates. You can check what has been changed in recent versions.

## 1. Setup

This pane is used for setting up self-hosted LiveSync. There are several options to set up self-hosted LiveSync.

### 1. Quick Setup

The preferred method for setting up self-hosted LiveSync with only a few clicks.

#### Connect with Setup URI

Setup self-hosted LiveSync with the `setup URI` which is [copied from another device](#copy-current-settings-as-a-new-setup-uri) or the setup script.

#### Manual setup

Step-by-step setup for self-hosted LiveSync. You can setup self-hosted LiveSync manually with Minimal setting items.

#### Enable LiveSync

This button only appears when the setup was not completed. If you have completed the setup manually, you can enable LiveSync on this device with this button.

### 2. To setup other devices

#### Copy the current settings to a Setup URI

You can copy the current settings to a new setup URI, which can be used to setup other devices: [Use the copied setup URI](#use-the-copied-setup-uri).

### 3. Reset

#### Discard existing settings and databases

Reset the self-hosted LiveSync settings and databases.
**Dangerous operation. Please be careful when using this.**

### 4. Enable extra and advanced features

To keep the setup simple, some panes are hidden by default. You can enable them here.

#### Enable advanced features

Setting key: useAdvancedMode

The following panes will be shown when you enable this setting:
| Icon | Description |
| :--: | ------------------------------------------------------------------ |
| 🚦 | [5. Selector (Advanced)](#5-selector-advanced) |
| 🔌 | [6. Customization sync (Advanced)](#6-customization-sync-advanced) |
| 🔧 | [8. Advanced (Advanced)](#8-advanced-advanced) |

#### Enable Power User features

Setting key: usePowerUserMode

The following pane will be shown when you enable this setting:
| Icon | Description |
| :--: | ------------------------------------------------------------------ |
| 💪 | [9. Power users (Power User)](#9-power-users-power-user) |

#### Enable edge case treatment features

Setting key: useEdgeCaseMode

The following pane will be shown when you enable this setting:
| Icon | Description |
| :--: | ------------------------------------------------------------------ |
| 🩹 | [10. Patches (Edge Case)](#10-patches-edge-case) |

## 2. General Settings

### 1. Appearance

#### Display Language

Setting key: displayLanguage

You can change the display language. It is independent of the system language and/or Obsidian's language.
Note: Not all messages have been translated. Please revert to "Default" when reporting errors. Contributions to translations are always welcome!

#### Show status inside the editor

Setting key: showStatusOnEditor

Show the synchronization status inside the editor.

Reflected after reboot

#### Show status as icons only

Setting key: showOnlyIconsOnEditor

Show status as icons only. This is useful when you want to save space on the status bar.

#### Show status on the status bar

Setting key: showStatusOnStatusbar

We can show the status of synchronization on the status bar (default: on).

### 2. Logging

#### Only show Notifications

Setting key: lessInformationInLog

Prevent logging and only show notifications. Please disable when you report the logs.

#### Verbose Log

Setting key: showVerboseLog

Show verbose log. Please enable when you report the logs.

## 3. Remote Configuration

### 1. Remote Server

#### Remote Server Type

Setting key: remoteType

### 2. Notifications

#### Remote Storage Size

Setting key: notifyThresholdOfRemoteStorageSize

MB (0 to disable) - Notify on launch when the estimated remote storage size exceeds this value.

### 3. Privacy & Encryption

#### End-to-End Encryption

Setting key: encrypt

Enable end-to-end encryption. Enabling this is recommended. If you change the passphrase, you need to rebuild the database (you will be prompted beforehand).

#### Passphrase

Setting key: passphrase

Encryption passphrase. If you change the passphrase, you need to rebuild the database (you will be prompted beforehand).

#### Path Obfuscation

Setting key: usePathObfuscation

By default, file paths are not obfuscated to improve performance. If you enable this, file paths will be obfuscated, allowing you to hide the path of files.

#### Use dynamic iteration count (Experimental)

Setting key: useDynamicIterationCount

This is an experimental feature and not recommended. If you enable this, the iteration count of the encryption will be determined dynamically. This is useful when you want to improve the performance.

---

**now writing from here onwards, sorry**

---

### 4. Fetch settings

#### Fetch config from remote server

Fetch necessary settings from an already configured remote server.

### 5. MinIO, S3, R2

#### Endpoint URL

Setting key: endpoint

#### Access Key

Setting key: accessKey

#### Secret Key

Setting key: secretKey

#### Region

Setting key: region

#### Bucket Name

Setting key: bucket

#### Use Custom HTTP Handler

Setting key: useCustomRequestHandler
Enable this if your Object Storage doesn't support CORS.

#### Test Connection

#### Apply Settings

### 6. CouchDB

#### Server URI

Setting key: couchDB_URI

#### Username

Setting key: couchDB_USER
Username

#### Password

Setting key: couchDB_PASSWORD
Password

#### Database Name

Setting key: couchDB_DBNAME

#### Test Database Connection

Open a database connection. If the remote database is not found and you have the permission to create a database, the database will be created.

#### Validate Database Configuration

Checks and fixes any potential issues with the database config.

#### Apply Settings

## 4. Sync Settings

### 1. Synchronization Preset

#### Presets

Setting key: preset

Apply a configuration preset

### 2. Synchronization Method

#### Sync Mode

Setting key: syncMode

#### Periodic Sync interval

Setting key: periodicReplicationInterval
Interval (seconds)

#### Sync on Save

Setting key: syncOnSave
Starts synchronization automatically when a file is saved.

#### Sync on Editor Save

Setting key: syncOnEditorSave
Starts synchronization automatically when a file is saved in the editor.

#### Sync on File Open

Setting key: syncOnFileOpen
Starts synchronization automatically when a file is opened.

#### Sync on Startup

Setting key: syncOnStart
Automatically sync all files when opening Obsidian.

#### Sync after merging file

Setting key: syncAfterMerge
Starts synchronization automatically after merging files.

### 3. Update thinning

#### Batch database update

Setting key: batchSave
Reduces the frequency at which on-disk changes are pushed to the database.

#### Minimum delay for batch database updating

Setting key: batchSaveMinimumDelay
Saving to the local database will be delayed until this many seconds after you stop typing or saving.

#### Maximum delay for batch database updating

Setting key: batchSaveMaximumDelay
Saving will be performed forcefully after this number of seconds.

### 4. Deletion Propagation (Advanced)

#### Use the trash bin

Setting key: trashInsteadDelete
Move remotely deleted files to the trash instead of deleting them.

#### Keep empty folder

Setting key: doNotDeleteFolder
Keep folders without any files inside.

### 5. Conflict resolution (Advanced)

#### (BETA) Always overwrite with a newer file

Setting key: resolveConflictsByNewerFile
Testing only - Resolve file conflicts by syncing newer copies of the file. This can overwrite modified files. Be warned.

#### Delay conflict resolution of inactive files

Setting key: checkConflictOnlyOnOpen
Should we only check for conflicts when a file is opened?

#### Delay merge conflict prompt for inactive files.

Setting key: showMergeDialogOnlyOnActive
Should we prompt you about conflicting files when a file is opened?

### 6. Sync settings via markdown (Advanced)

#### Filename

Setting key: settingSyncFile
Save settings to a markdown file. You will be notified when new settings arrive. You can set different files based on the platform.

#### Write credentials to the file

Setting key: writeCredentialsForSettingSync

Not recommended - If set, credentials will be stored in the file.

#### Notify all setting files

Setting key: notifyAllSettingSyncFile

### 7. Hidden Files (Advanced)

#### Hidden file synchronization

#### Enable Hidden files sync

#### Scan for hidden files before replication

Setting key: syncInternalFilesBeforeReplication

#### Scan hidden files periodically

Setting key: syncInternalFilesInterval
Seconds (0 to disable)

## 5. Selector (Advanced)

### 1. Normal Files

#### Synchronizing files

RegExp - Empty to sync all files. Set filter as a regular expression to limit synchronizing files.

#### Non-Synchronizing files

RegExp - If this is set, any changes to local and remote files that match this will be skipped.

#### Maximum file size

Setting key: syncMaxSizeInMB

MB - If this is set, changes to local and remote files that are larger than this will be skipped.

#### (Beta) Use ignore files

Setting key: useIgnoreFiles

Skip changes to local files which are matched by the ignore files. Remote changes are determined using local ignore files.

#### Ignore files

Setting key: ignoreFiles

Comma separated: `.gitignore, .dockerignore`

### 2. Hidden Files (Advanced)

#### Ignore patterns

#### Add default patterns

## 6. Customization sync (Advanced)

### 1. Customization Sync

#### Device Name

Setting key: deviceAndVaultName
Unique name between all synchronized devices. To edit this setting, please disable customization sync once.

#### Per-file-saved customization sync

Setting key: usePluginSyncV2
If enabled, per-filed efficient customization sync will be used. We need a small migration when enabling this. All devices should be updated to v0.23.18. Once this is enabled, compatibility with older versions is lost.

#### Enable customization sync

Setting key: usePluginSync

#### Scan customization automatically

Setting key: autoSweepPlugins
Scan customization before replicating.

#### Scan customization periodically

Setting key: autoSweepPluginsPeriodic
Scan customization every 1 minute.

#### Notify on update and settings change

Setting key: notifyPluginOrSettingUpdated
Notify when another device has recently updated or changed plugin settings.

#### Open

Open the dialog

## 7. Hatch

### 1. Reporting Issues

#### Copy system information for reporting issues

#### Write logs to a file

Setting key: writeLogToTheFile

Warning! This will have a serious impact on performance. The logs will not be synchronized under their default name. Please be careful with logs; they often contain your confidential information.

### 2. Scram Switches

#### Suspend file watching

Setting key: suspendFileWatching
Stop watching for file changes.

#### Suspend database reflecting

Setting key: suspendParseReplicationResult
Stop reflecting database changes to storage files.

### 3. Recovery and Repair

#### Recreate missing chunks for all files

This will recreate chunks for all files. If there were missing chunks, this may fix the errors.

#### Use the newer file in case of a merge conflict

Resolve all file conflicts by using the newer one. Caution: This will overwrite the older file, and you cannot restore the overwritten one.

#### Verify and repair all files

Compare the content of files between on local database and storage. If there is a conflict, you will be asked which one you want to keep.

#### Check and convert non-path-obfuscated files

### 4. Reset

#### Reset to default settings

#### Delete all customization sync data

## 8. Advanced (Advanced)

### 1. Memory cache

#### Memory cache size (total items)

Setting key: hashCacheMaxCount

#### Memory cache size (by total characters)

Setting key: hashCacheMaxAmount
Characters (millions)

### 2. Local Database Tweak

#### Enhance chunk size

Setting key: customChunkSize

#### Use splitting-limit-capped chunk splitter

Setting key: enableChunkSplitterV2
If enabled, chunks will be split into no more than 100 items. However, dedupe is slightly weaker.

#### Use Segmented-splitter

Setting key: useSegmenter
If this enabled, chunks will be split into semantically meaningful segments. Not all platforms support this feature.

### 3. Transfer Tweak

#### Fetch chunks on demand

Setting key: readChunksOnline
(ex. Read chunks online) If this option is enabled, LiveSync reads chunks online directly instead of replicating them locally. Increasing the custom chunk size is recommended.

#### Batch size of on-demand fetching

Setting key: concurrencyOfReadChunksOnline

#### The delay for consecutive on-demand fetches

Setting key: minimumIntervalOfReadChunksOnline

## 9. Power users (Power User)

### 1. Remote Database Tweak

#### Incubate Chunks in Document (Beta)

Setting key: useEden
If enabled, newly created chunks are temporarily kept within the document, and graduated to become independent chunks once stabilised.

#### Maximum Incubating Chunks

Setting key: maxChunksInEden
The maximum number of chunks that can be incubated within the document. Chunks exceeding this number will immediately graduate to independent chunks.

#### Maximum Incubating Chunk Size

Setting key: maxTotalLengthInEden
The maximum total size of chunks that can be incubated within the document. Chunks exceeding this size will immediately graduate to independent chunks.

#### Maximum Incubation Period

Setting key: maxAgeInEden
The maximum duration for which chunks can be incubated within the document. Chunks exceeding this period will graduate to independent chunks.

#### Data Compression (Experimental)

Setting key: enableCompression

### 2. CouchDB Connection Tweak

#### Batch size

Setting key: batch_size
Number of changes to sync at a time. Defaults to 50. Minimum is 2.

#### Batch limit

Setting key: batches_limit

Number of batches to process at a time. Defaults to 40. Minimum is 2. This along with batch size controls how many docs are kept in memory at a time.

#### Use timeouts instead of heartbeats

Setting key: useTimeouts

If this option is enabled, PouchDB will hold the connection open for 60 seconds, and if no change arrives in that time, close and reopen the socket, instead of holding it open indefinitely. Useful when a proxy limits request duration but can increase resource usage.

### 3. Configuration Encryption

#### Encrypting sensitive configuration items

Setting key: configPassphraseStore

#### Passphrase of sensitive configuration items

Setting key: configPassphrase

This passphrase will not be copied to another device. It will be set to `Default` until you configure it again.

### 4. Developer

#### Enable Developer Debug Tools.

Setting key: enableDebugTools

Requires restart of Obsidian.

## 10. Patches (Edge Case)

### 1. Compatibility (Metadata)

#### Do not keep metadata of deleted files.

Setting key: deleteMetadataOfDeletedFiles

#### Delete old metadata of deleted files on start-up

Setting key: automaticallyDeleteMetadataOfDeletedFiles

Days - 0 to disable automatic-deletion.

### 2. Compatibility (Conflict Behavior)

#### Always prompt merge conflicts

Setting key: disableMarkdownAutoMerge

Should we prompt you for every single merge, even if we can safely merge automatically?

#### Apply Latest Change if Conflicting

Setting key: writeDocumentsIfConflicted

Enable this option to automatically apply the most recent change to documents even if there is a conflict.

### 3. Compatibility (Database Structure)

#### (Obsolete) Use an old adapter for compatibility

Setting key: useIndexedDBAdapter

Before v0.17.16, we used an old adapter for the local database. Now, the new adapter is preferred. However, this requires a rebuild of the local database. Please disable this toggle when you have enough time. If left enabled and fetching from the remote database, you will be asked to disable this.

#### Compute revisions for chunks (Previous Behavior)

Setting key: doNotUseFixedRevisionForChunks

If this enabled, all chunks will be stored with the revision made from its content (previous behavior).

#### Handle files as case-sensitive

Setting key: handleFilenameCaseSensitive

If this enabled, all files are handled as case-sensitive (previous behavior).

### 4. Compatibility (Internal API Usage)

#### Scan changes on customization sync

Setting key: watchInternalFileChanges

Do not use internal API

### 5. Edge case addressing (Database)

#### Database suffix

Setting key: additionalSuffixOfDatabaseName

LiveSync could not handle multiple vaults which have the same name without different prefixes. This should be automatically configured.

#### The Hash algorithm for chunk IDs (Experimental)

Setting key: hashAlg

### 6. Edge case addressing (Behavior)

#### Fetch database with previous behavior

Setting key: doNotSuspendOnFetching

#### Keep empty folder

Setting key: doNotDeleteFolder

Keep folders that don't have any files inside.

### 7. Edge case addressing (Processing)

#### Do not split chunks in the background

Setting key: disableWorkerForGeneratingChunks

If disabled (toggled), chunks will be split on the UI thread (previous behavior).

#### Process small files in the foreground

Setting key: processSmallFilesInUIThread

If enabled, files under 1kB will be processed in the UI thread.

### 8. Compatibility (Trouble addressed)

#### Do not check configuration mismatch before replication

Setting key: disableCheckingConfigMismatch

## 11. Maintenance

### 1. Scram!

#### Lock Server

Locks the remote server to prevent synchronization with other devices.

#### Emergency restart

Disables all synchronization and restart.

### 2. Syncing

#### Resend

Resend all chunks to the remote.

#### Reset journal received history

Reinitialise journal received history. On the next sync, every item except this device sent will be downloaded again.

#### Reset journal sent history

Reinitialise journal sent history. On the next sync, every item except this device received will be sent again.

### 3. Rebuilding Operations (Local)

#### Fetch from remote

Restore or reconstruct the local database from the remote.

#### Fetch rebuilt database (save local documents before)

Restore or reconstruct the local database from the remote database but use local chunks.

### 4. Total Overhaul

#### Rebuild everything

Rebuild local and remote database with local files.

### 5. Rebuilding Operations (Remote Only)

#### Perform cleanup

Reduces storage space by discarding all previous revisions. This requires the same amount of free space on the remote server and the local client.

#### Overwrite remote

Overwrite remote with local DB and passphrase.

#### Reset all journal counter

Reinitialise all journal history, On the next sync, every item will be received and sent.

#### Purge all journal counter

Purge all download/upload cache.

#### Fresh Start Wipe

Delete all data on the remote server.

### 6. Deprecated

#### Run database cleanup

Attempts to shrink the database by deleting unused chunks. This may not work consistently. Use the 'Rebuild everything' under Total Overhaul.

### 7. Reset

#### Delete local database to reset or uninstall self-hosted LiveSync
