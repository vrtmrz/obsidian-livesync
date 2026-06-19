NOTE: This document not completed. I'll improve this doc in a while. but your contributions are always welcome.

# Settings of Self-hosted LiveSync

There are many settings in Self-hosted LiveSync. This document describes each setting in detail (not how-to). Configuration and settings are divided into several categories and indicated by icons. The icon is as follows:

| Icon | Description                                                        |
| :--: | ------------------------------------------------------------------ |
|  💬  | [0. Change Log](#0-change-log)                                     |
|  🧙‍♂️  | [1. Setup](#1-setup)                                               |
|  ⚙️  | [2. General Settings](#2-general-settings)                         |
|  🛰️  | [3. Remote Configuration](#3-remote-configuration)                 |
|  🔄  | [4. Sync Settings](#4-sync-settings)                               |
|  🚦  | [5. Selector (Advanced)](#5-selector-advanced)                     |
|  🔌  | [6. Customisation sync (Advanced)](#6-customisation-sync-advanced) |
|  🧰  | [7. Hatch](#7-hatch)                                               |
|  🔧  | [8. Advanced (Advanced)](#8-advanced-advanced)                     |
|  💪  | [9. Power users (Power User)](#9-power-users-power-user)           |
|  🩹  | [10. Patches (Edge Case)](#10-patches-edge-case)                   |
|  🎛️  | [11. Maintenance](#11-maintenance)                                 |

## 0. Change Log

This pane shows version up information. You can check what has been changed in recent versions.

## 1. Setup

This pane is used for setting up Self-hosted LiveSync. There are several options to set up Self-hosted LiveSync.

### 1. Quick Setup

Most preferred method to setup Self-hosted LiveSync. You can setup Self-hosted LiveSync with a few clicks.

#### Connect with Setup URI

Setup the Self-hosted LiveSync with the `setup URI` which is [copied from another device](#copy-current-settings-as-a-new-setup-uri) or the setup script.

#### Manual setup

Step-by-step setup for Self-hosted LiveSync. You can setup Self-hosted LiveSync manually with Minimal setting items.

#### Enable LiveSync

This button only appears when the setup was not completed. If you have completed the setup manually, you can enable LiveSync on this device by this button.

### 2. To setup other devices

#### Copy the current settings to a Setup URI

You can copy the current settings as a new setup URI. And this URI can be used to setup the other devices as [Use the copied setup URI](#use-the-copied-setup-uri).

### 3. Reset

#### Discard existing settings and databases

Reset the Self-hosted LiveSync settings and databases.
**Hazardous operation. Please be careful when using this.**

### 4. Enable extra and advanced features

To keep the set-up dialogue simple, some panes are hidden in default. You can enable them here.

#### Enable advanced features

Setting key: useAdvancedMode

Following panes will be shown when you enable this setting.
| Icon | Description |
| :--: | ------------------------------------------------------------------ |
| 🚦 | [5. Selector (Advanced)](#5-selector-advanced) |
| 🔌 | [6. Customisation sync (Advanced)](#6-customisation-sync-advanced) |
| 🔧 | [8. Advanced (Advanced)](#8-advanced-advanced) |

#### Enable poweruser features

Setting key: usePowerUserMode

Following panes will be shown when you enable this setting.
| Icon | Description |
| :--: | ------------------------------------------------------------------ |
| 💪 | [9. Power users (Power User)](#9-power-users-power-user) |

#### Enable edge case treatment features

Setting key: useEdgeCaseMode

Following panes will be shown when you enable this setting.
| Icon | Description |
| :--: | ------------------------------------------------------------------ |
| 🩹 | [10. Patches (Edge Case)](#10-patches-edge-case) |

## 2. General Settings

### 1. Appearance

#### Display Language

Setting key: displayLanguage

You can change the display language. It is independent of the system language and/or Obsidian's language.
Note: Not all messages have been translated. And, please revert to "Default" when reporting errors. Of course, your contribution to translation is always welcome!

#### Show status inside the editor

Setting key: showStatusOnEditor

We can show the status of synchronisation inside the editor.

Reflected after reboot

#### Show status as icons only

Setting key: showOnlyIconsOnEditor

Show status as icons only. This is useful when you want to save space on the status bar.

#### Show status on the status bar

Setting key: showStatusOnStatusbar

We can show the status of synchronisation on the status bar. (Default: On)

#### Show status icon instead of file warnings banner

Setting key: hideFileWarningNotice

If enabled, the ⛔ icon will be shown inside the status instead of the file warnings banner. No details will be shown.

#### Network warning style

Setting key: networkWarningStyle

How to display network errors when the sync server is unreachable.

### 2. Logging

#### Show only notifications

Setting key: lessInformationInLog

Prevent logging and show only notification. Please disable when you report the logs

#### Verbose Log

Setting key: showVerboseLog

Show verbose log. Please enable when you report the logs

## 3. Remote Configuration

### 1. Remote Server

Self-hosted LiveSync supports multiple remote connection profiles under **Remote Server** -> **Remote Databases**. This allows you to save and switch between multiple databases or bucket configurations in a single vault.

- **➕ Add new connection**: Create a new connection profile by launching the setup dialogue.
- **📥 Import connection**: Paste a connection string (e.g., `sls+https://...`, `sls+s3://...`, `sls+p2p://...`) to import a remote configuration profile.
- **🔧 Configure**: Open the setup dialogue to edit settings for the selected connection profile.
- **✅ Activate**: Select and activate this profile as the current active remote.
- **🗑️ Delete**: Remove this connection profile from the list.

#### Remote Type

Setting key: remoteType

The active remote server type. This is automatically projected to the legacy configuration when you activate a connection profile.

### 2. Notification

#### Notify when the estimated remote storage size exceeds on start up

Setting key: notifyThresholdOfRemoteStorageSize

MB (0 to disable). We can get a notification when the estimated remote storage size exceeds this value.

### 3. Privacy & Encryption

#### End-to-End Encryption

Setting key: encrypt

Enable end-to-end encryption. enabling this is recommend. If you change the passphrase, you need to rebuild databases (You will be informed).

#### Passphrase

Setting key: passphrase

Encrypting passphrase. If you change the passphrase, you need to rebuild databases (You will be informed).

#### Path Obfuscation

Setting key: usePathObfuscation

In default, the path of the file is not obfuscated to improve the performance. If you enable this, the path of the file will be obfuscated. This is useful when you want to hide the path of the file.

#### Encryption Algorithm

Setting key: E2EEAlgorithm

The encryption algorithm version used for end-to-end encryption.
- `v2` (V2: AES-256-GCM With HKDF): Recommended and default version.
- `forceV1` or `""` (V1: Legacy): Older legacy encryption. Only use this if you have an existing vault encrypted in the legacy format.

#### Use dynamic iteration count (Experimental)

Setting key: useDynamicIterationCount

This is an experimental feature and not recommended. If you enable this, the iteration count of the encryption will be dynamically determined. This is useful when you want to improve the performance.

---

**now writing from here onwards, sorry**

---

### 4. Fetch settings

#### Fetch config from remote server

Fetch necessary settings from already configured remote server.

### 5. Minio,S3,R2

These settings are configured within the S3/MinIO/R2 Setup dialogue when adding (`➕`) or editing (`🔧`) an Object Storage connection profile.

#### Endpoint URL

Setting key: endpoint

The URL of the remote storage endpoint.
Note: Only Secure (HTTPS) connections can be used on Obsidian Mobile.

#### Access Key

Setting key: accessKey

The Access Key ID used for authentication.

#### Secret Key

Setting key: secretKey

The Secret Access Key used for authentication.

#### Region

Setting key: region

The storage region (e.g., `us-east-1`, or `auto` for Cloudflare R2).

#### Bucket Name

Setting key: bucket

The name of the bucket to store synchronised files.

#### Use Custom HTTP Handler

Setting key: useCustomRequestHandler

This option is labeled **Use internal API** in the setup dialogue. Enable this if your Object Storage does not support CORS. It uses Obsidian's internal API to communicate with the S3 server, which is not compliant with web standards but can bypass CORS restrictions. Note that this might break in future Obsidian versions.

#### File prefix on the bucket

Setting key: bucketPrefix

This option is labeled **Folder Prefix** in the setup dialogue. Effectively a directory. Should end with `/`. e.g., `vault-name/`. Leave blank to store data at the root of the bucket.

#### Enable forcePathStyle

Setting key: forcePathStyle

This option is labeled **Use Path-Style Access** in the setup dialogue. If enabled, the forcePathStyle option will be used for bucket operations.

#### Custom Headers

Setting key: bucketCustomHeaders

Custom HTTP headers to include in every request sent to the Object Storage bucket. Specify them in the format `Header-Name: Value`, with each header on a new line.

#### Test Connection

#### Apply Settings

### 6. CouchDB

These settings are configured within the CouchDB Setup dialogue when adding (`➕`) or editing (`🔧`) a CouchDB connection profile.

#### Server URI

Setting key: couchDB_URI

The URI of the CouchDB server.
Note: Only Secure (HTTPS) connections can be used on Obsidian Mobile. The URI must not end with a trailing slash.

#### Username

Setting key: couchDB_USER

The username used to authenticate with CouchDB.

#### Password

Setting key: couchDB_PASSWORD

The password used to authenticate with CouchDB.

#### Database Name

Setting key: couchDB_DBNAME

The name of the database.
Note: The database name cannot contain capital letters, spaces, or special characters other than `_$()+/-`, and cannot start with an underscore (`_`).

#### Use Request API to avoid inevitable CORS problem

Setting key: useRequestAPI

This option is labeled **Use Internal API** in the setup dialogue. If enabled, Obsidian's internal request API will be used to bypass CORS restrictions. This is a workaround that may not be compliant with web standards and is less secure. Note that this might break in future Obsidian versions.

#### Custom Headers

Setting key: couchDB_CustomHeaders

Custom HTTP headers to include in every request sent to the CouchDB server. Specify them in the format `Header-Name: Value`, with each header on a new line.

#### Use JWT Authentication

Setting key: useJWT

Enable JSON Web Token (JWT) authentication for CouchDB. This is an experimental feature and has not been thoroughly verified.

#### JWT Algorithm

Setting key: jwtAlgorithm

The algorithm used to sign the JWT. Supported algorithms: `HS256`, `HS512`, `ES256`, `ES512`.

#### JWT Expiration Duration (minutes)

Setting key: jwtExpDuration

Token expiration duration in minutes. Set to 0 to disable expiration.

#### JWT Key

Setting key: jwtKey

The secret key (for HS256/HS512) or the PKCS#8 PEM-formatted private key (for ES256/ES512) used to sign the JWT.

#### JWT Key ID (kid)

Setting key: jwtKid

The Key ID (`kid`) header parameter included in the JWT.

#### JWT Subject (sub)

Setting key: jwtSub

The subject (`sub`) claim of the JWT, which should match your CouchDB username.

#### Test Database Connection

Open database connection. If the remote database is not found and you have permission to create a database, the database will be created.

#### Validate Database Configuration

Checks and fixes any potential issues with the database config.

#### Apply Settings

### 7. Peer-to-Peer (P2P) Synchronisation

#### Enable P2P Synchronisation

Setting key: P2P_Enabled

Enable direct peer-to-peer synchronisation via WebRTC.

#### Relay URL

Setting key: P2P_relays

The WebSocket relay server URL(s) used for coordinating P2P connections via WebRTC. Multiple URLs can be separated by commas.

#### Group ID

Setting key: P2P_roomID

The room ID or Group ID used to identify your group of synchronising devices. All devices you wish to synchronise must use the same Group ID. You can enter any custom string or generate a random Group ID.

#### Passphrase

Setting key: P2P_passphrase

The password or passphrase used to authenticate and encrypt P2P communication. All devices must use the same passphrase.

#### Device Peer ID

Setting key: P2P_DevicePeerName

The peer name or identifier of this device in the P2P network. This should be unique within your group of devices.

#### Automatically start P2P connection on launch

Setting key: P2P_AutoStart

This option is labeled **Auto Start P2P Connection** in the setup dialogue. If enabled, the P2P connection will start automatically when the plug-in launches.

#### Automatically broadcast changes to connected peers

Setting key: P2P_AutoBroadcast

This option is labeled **Auto Broadcast Changes** in the setup dialogue. If enabled, changes will be automatically broadcasted to connected peers, requesting them to fetch the changes.

#### TURN Server URLs (comma-separated)

Setting key: P2P_turnServers

A comma-separated list of TURN/STUN server URLs. Used to relay P2P connections when direct WebRTC connection fails due to strict NAT or firewalls. In most cases, these can be left blank.

#### TURN Username

Setting key: P2P_turnUsername

The username for authentication with the TURN server.

#### TURN Credential

Setting key: P2P_turnCredential

The password or credential for authentication with the TURN server.

## 4. Sync Settings

### 1. Synchronisation Preset

#### Presets

Setting key: preset
Apply preset configuration

### 2. Synchronisation Method

#### Sync Mode

Setting key: syncMode

The trigger mechanism for synchronisation.
- **LiveSync** (`LIVESYNC`): Real-time, continuous, bidirectional synchronisation.
  Note: This requires a CouchDB or WebRTC P2P remote server. It is not supported for S3-compatible Object Storage.
- **Periodic Sync** (`PERIODIC`): Synchronisation is performed at regular intervals specified by the **Periodic Sync interval** setting.
- **On Events** (`ONEVENTS`): Synchronisation is triggered by specific events (such as save, file open, or startup) configured via the toggles below.

#### Periodic Sync interval

Setting key: periodicReplicationInterval
Interval (sec)

#### Minimum interval for syncing

Setting key: syncMinimumInterval

The minimum interval for automatic synchronisation on event.

#### Sync on Save

Setting key: syncOnSave
Starts synchronisation when a file is saved.

#### Sync on Editor Save

Setting key: syncOnEditorSave
When you save a file in the editor, start a sync automatically

#### Sync on File Open

Setting key: syncOnFileOpen
Forces the file to be synced when opened.

#### Sync on Startup

Setting key: syncOnStart
Automatically Sync all files when opening Obsidian.

#### Sync after merging file

Setting key: syncAfterMerge
Sync automatically after merging files

#### Keep replication active in the background

Setting key: keepReplicationActiveInBackground
Desktop only; uses more battery and network.

### 3. Update thinning

#### Batch database update

Setting key: batchSave
Reducing the frequency with which on-disk changes are reflected into the DB

#### Minimum delay for batch database updating

Setting key: batchSaveMinimumDelay
Seconds. Saving to the local database will be delayed until this value after we stop typing or saving.

#### Maximum delay for batch database updating

Setting key: batchSaveMaximumDelay
Saving will be performed forcefully after this number of seconds.

### 4. Deletion Propagation (Advanced)

#### Use the trash bin

Setting key: trashInsteadDelete
Move remotely deleted files to the trash, instead of deleting. On Obsidian v1.7.2 or newer, file deletion respects the user's deletion preferences (by utilising the `FileManager.trashFile` API), regardless of this setting.

#### Keep empty folder

Setting key: doNotDeleteFolder
Should we keep folders that do not have any files inside?

### 5. Conflict resolution (Advanced)

#### (BETA) Always overwrite with a newer file

Setting key: resolveConflictsByNewerFile
Testing only - Resolve file conflicts by syncing newer copies of the file, this can overwrite modified files. Be Warned.

#### Delay conflict resolution of inactive files

Setting key: checkConflictOnlyOnOpen
Should we only check for conflicts when a file is opened?

#### Delay merge conflict prompt for inactive files.

Setting key: showMergeDialogOnlyOnActive
Should we prompt you about conflicting files when a file is opened?

### 6. Sync settings via markdown (Advanced)

#### Filename

Setting key: settingSyncFile
Save settings to a markdown file. You will be notified when new settings arrive. You can set different files by the platform.

#### Write credentials in the file

Setting key: writeCredentialsForSettingSync
(Not recommended) If set, credentials will be stored in the file.

#### Notify all setting files

Setting key: notifyAllSettingSyncFile

### 7. Hidden Files (Advanced)

#### Enable Hidden files sync

Setting key: syncInternalFiles
Enable the synchronisation of hidden files and folders (e.g. settings files, templates, snippets, and themes under `.obsidian`).

#### Scan for hidden files before replication

Setting key: syncInternalFilesBeforeReplication

#### Scan hidden files periodically

Setting key: syncInternalFilesInterval
Seconds, 0 to disable

#### Suppress notification of hidden files change

Setting key: suppressNotifyHiddenFilesChange

If enabled, the notification of hidden files change will be suppressed.

## 5. Selector (Advanced)

### 1. Normal Files

#### Synchronising files

(RegExp) Empty to sync all files. Set filter as a regular expression to limit synchronising files.

#### Non-Synchronising files

(RegExp) If this is set, any changes to local and remote files that match this will be skipped.

#### Maximum file size

Setting key: syncMaxSizeInMB
(MB) If this is set, changes to local and remote files that are larger than this will be skipped. If the file becomes smaller again, a newer one will be used.

#### (Beta) Use ignore files

Setting key: useIgnoreFiles
If this is set, changes to local files which are matched by the ignore files will be skipped. Remote changes are determined using local ignore files.

#### Ignore files

Setting key: ignoreFiles
Comma separated `.gitignore, .dockerignore`

### 2. Hidden Files (Advanced)

#### Ignore patterns

#### Add default patterns

## 6. Customisation sync (Advanced)

### 1. Customisation Sync

#### Device name

Setting key: deviceAndVaultName
Unique name between all synchronised devices. To edit this setting, please disable customisation sync once.

#### Per-file-saved customisation sync

Setting key: usePluginSyncV2
If enabled, per-file efficient customisation sync will be used. We need a small migration when enabling this. And all devices should be updated to v0.23.18. Once we enable this, we lose compatibility with old versions.

#### Enable customisation sync

Setting key: usePluginSync

#### Scan customisation automatically

Setting key: autoSweepPlugins
Scan customisation before replicating.

#### Scan customisation periodically

Setting key: autoSweepPluginsPeriodic
Scan customisation every 1 minute.

#### Notify customised

Setting key: notifyPluginOrSettingUpdated
Notify when another device has newly customised.

#### Open

Open the dialogue

## 7. Hatch

### 1. Reporting Issue

#### Make report to inform the issue

#### Write logs into the file

Setting key: writeLogToTheFile
Warning! This will have a serious impact on performance. And the logs will not be synchronised under the default name. Please be careful with logs; they often contain your confidential information.

### 2. Scram Switches

Emergency controls to suspend synchronisation processes in order to prevent database corruption. If a critical mismatch or sync error occurs, the plug-in may automatically enter a Scram state and suspend operations.

#### Suspend file watching

Setting key: suspendFileWatching

Stop watching for local file changes.

#### Suspend database reflecting

Setting key: suspendParseReplicationResult

Stop reflecting database changes to storage files.

### 3. Recovery and Repair

#### Recreate missing chunks for all files

This will recreate chunks for all files. If there were missing chunks, this may fix the errors.

#### Resolve All conflicted files by the newer one

Resolve all conflicted files by the newer one. Caution: This will overwrite the older one, and cannot resurrect the overwritten one.

#### Verify and repair all files

Compare the content of files between on local database and storage. If not matched, you will be asked which one you want to keep.

#### Check and convert non-path-obfuscated files

### 4. Reset

#### Back to non-configured

#### Delete all customisation sync data

## 8. Advanced (Advanced)

### 1. Memory cache

#### Memory cache size (by total items)

Setting key: hashCacheMaxCount

#### Memory cache size (by total characters)

Setting key: hashCacheMaxAmount
(Mega chars)

### 2. Local Database Tweak

#### Enhance chunk size

Setting key: customChunkSize

#### Chunk Splitter

Setting key: chunkSplitterVersion

Select the chunk splitter version; V3 is the most efficient. If you experience issues, please choose Default or Legacy.

#### Use splitting-limit-capped chunk splitter

Setting key: enableChunkSplitterV2
If enabled, chunks will be split into no more than 100 items. However, dedupe is slightly weaker.

#### Use Segmented-splitter

Setting key: useSegmenter
If this enabled, chunks will be split into semantically meaningful segments. Not all platforms support this feature.

### 3. Transfer Tweak

#### Fetch chunks on demand

Setting key: readChunksOnline
(ex. Read chunks online) If this option is enabled, LiveSync reads chunks online directly instead of replicating them locally. Increasing Custom chunk size is recommended.

#### Batch size of on-demand fetching

Setting key: concurrencyOfReadChunksOnline

#### The delay for consecutive on-demand fetches

Setting key: minimumIntervalOfReadChunksOnline

#### Maximum size of chunks to send in one request

Setting key: sendChunksBulkMaxSize

Limit the maximum size of chunks to send in a single bulk request (MB).

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

#### Enable Developers' Debug Tools.

Setting key: enableDebugTools
Requires restart of Obsidian

## 10. Patches (Edge Case)

### 1. Compatibility (Metadata)

#### Do not keep metadata of deleted files.

Setting key: deleteMetadataOfDeletedFiles

#### Delete old metadata of deleted files on start-up

Setting key: automaticallyDeleteMetadataOfDeletedFiles
(Days passed, 0 to disable automatic-deletion)

### 2. Compatibility (Conflict Behaviour)

#### Always prompt merge conflicts

Setting key: disableMarkdownAutoMerge
Should we prompt you for every single merge, even if we can safely merge automatcially?

#### Apply Latest Change if Conflicting

Setting key: writeDocumentsIfConflicted
Enable this option to automatically apply the most recent change to documents even when it conflicts

### 3. Compatibility (Database structure)

#### (Obsolete) Use an old adapter for compatibility (obsolete)

Setting key: useIndexedDBAdapter
Before v0.17.16, we used an old adapter for the local database. Now the new adapter is preferred. However, it needs local database rebuilding. Please disable this toggle when you have enough time. If leave it enabled, also while fetching from the remote database, you will be asked to disable this.

#### Compute revisions for chunks (Previous behaviour)

Setting key: doNotUseFixedRevisionForChunks
If this enabled, all chunks will be stored with the revision made from its content. (Previous behaviour)

#### Handle files as Case-Sensitive

Setting key: handleFilenameCaseSensitive
If this enabled, All files are handled as case-Sensitive (Previous behaviour).

### 4. Compatibility (Internal API Usage)

#### Scan changes on customisation sync

Setting key: watchInternalFileChanges
Do not use internal API

### 5. Edge case addressing (Database)

#### Database suffix

Setting key: additionalSuffixOfDatabaseName
LiveSync could not handle multiple vaults which have same name without different prefix, This should be automatically configured.

#### The Hash algorithm for chunk IDs (Experimental)

Setting key: hashAlg

### 6. Edge case addressing (Behaviour)

#### Fetch database with previous behaviour

Setting key: doNotSuspendOnFetching

#### Keep empty folder

Setting key: doNotDeleteFolder
Should we keep folders that do not have any files inside?

#### Process files even if seems to be corrupted

Setting key: processSizeMismatchedFiles

Enable this setting to process files with size mismatches, which can sometimes be created by certain external APIs or integrations.

### 7. Edge case addressing (Processing)

#### Do not split chunks in the background

Setting key: disableWorkerForGeneratingChunks
If disabled(toggled), chunks will be split on the UI thread (Previous behaviour).

#### Process small files in the foreground

Setting key: processSmallFilesInUIThread
If enabled, the file under 1kb will be processed in the UI thread.

### 8. Compatibility (Trouble addressed)

#### Do not check configuration mismatch before replication

Setting key: disableCheckingConfigMismatch

### 9. Remediation

#### Maximum file modification time for reflected file events

Setting key: maxMTimeForReflectEvents

Files with modification times greater than this value (in seconds since the Unix epoch) will not have their events reflected. Set to 0 to disable this limit.

## 11. Maintenance

### 1. Scram!

#### Lock Server

Lock the remote server to prevent synchronisation with other devices.

#### Emergency restart

Disables all synchronisation and restart.

### 2. Syncing

#### Resend

Resend all chunks to the remote.

#### Reset journal received history

Initialise journal received history. On the next sync, every item except this device sent will be downloaded again.

#### Reset journal sent history

Initialise journal sent history. On the next sync, every item except this device received will be sent again.

### 3. Rebuilding Operations (Local)

#### Reset Synchronisation on This Device

Restore or reconstruct local database from remote.

### 4. Total Overhaul

#### Overwrite Server Data with This Device's Files

Rebuild local and remote database with local files.

### 5. Rebuilding Operations (Remote Only)

#### Perform cleanup

Reduces storage space by discarding all non-latest revisions. This requires the same amount of free space on the remote server and the local client.

#### Overwrite remote

Overwrite remote with local DB and passphrase.

#### Reset all journal counter

Initialise all journal history, On the next sync, every item will be received and sent.

#### Purge all journal counter

Purge all download/upload cache.

#### Fresh Start Wipe

Delete all data on the remote server.

### 6. Deprecated

#### Run database cleanup

Attempt to shrink the database by deleting unused chunks. This may not work consistently. Use the 'Overwrite Server Data with This Device's Files' under Reset Synchronisation information.

### 7. Reset

#### Delete local database to reset or uninstall Self-hosted LiveSync
