# Synchronisation Settings Consistency: Impact Categorisation

Categorisation of impacts when synchronisation settings are inconsistent across devices.

## Exceptions
* **DB & Remote Connection:** `couchDB_URI`, `couchDB_DBNAME`, `remoteType`, `useJWT`, various bucket settings (`accessKey`, `bucket`, `endpoint`, etc.)
These settings are required to establish a connection to the remote storage. If they do not match, we should ask what the inconsistency is. Hence, these settings are not categorised below, as they require a separate handling process.

## 💀 Environment Blockers (Unsyncable Fatal Inconsistencies)
If this setting is inconsistent with the device's physical capabilities, it is physically impossible to sync. This cannot be auto-configured and must explicitly block synchronisation.

* **File System Constraint:** `handleFilenameCaseSensitive` (If the remote expects case sensitivity but the local filesystem is inherently case-insensitive, they cannot safely merge and will result in silent file corruption.)

## 🔴 Impossible to function if inconsistent (Synchronisation Failure / Data Corruption / Logical Breakdown)
If these do not match, it causes fatal issues such as decryption failure, architecture breakdown due to chunk hash mismatches, or unintended overwriting loops. These items must match perfectly.

* **Encryption Settings:** `encrypt`, `passphrase`, `E2EEAlgorithm`, `usePathObfuscation`

## 🟡 Slightly inefficient but no corruption (Systemic Inefficiency)
Synchronisation completes without corruption, but systemic inefficiencies arise, such as increased storage consumption due to ineffective deduplication.

* **Chunk Algorithms:** `hashAlg`, `chunkSplitterVersion`, `enableChunkSplitterV2`, `useSegmenter`
* **Chunk Size:** `minimumChunkSize`, `customChunkSize`

* Cache & Tuning: `useEden`, `maxChunksInEden`, `maxTotalLengthInEden`, `enableCompression`

## 🟢 No problem (Client-specific behaviour / UX / Performance)
Differences only affect device-specific processing timing or user experience, and do not lead to DB corruption or fatal synchronisation loops.

* **UI, Logs & Notifications:** `showVerboseLog`, `showStatusOnEditor`, `networkWarningStyle`, `displayLanguage`, `hideFileWarningNotice`, `writeLogToTheFile`, etc.
* **Synchronisation Triggers:** `liveSync`, `syncOnSave`, `syncOnStart`, `syncOnFileOpen`, `syncMinimumInterval`
* **Local File Rules:** `trashInsteadDelete`, `doNotDeleteFolder`
* **Target Filtering:** `syncOnlyRegEx`, `syncIgnoreRegEx`, `syncInternalFiles`
* **Conflict Resolution & Merging:** `resolveConflictsByNewerFile`, `disableMarkdownAutoMerge`, `checkConflictOnlyOnOpen`, `showMergeDialogOnlyOnActive`
* **Plugin Synchronisation:** `usePluginSync`, `showOwnPlugins`, `autoSweepPlugins`
* **Setting Check Mechanism:** `disableCheckingConfigMismatch`
* **Performance Adjustments (Client-side considerations):**
  * Transfer/Save Batching: `batch_size`, `batches_limit`, `batchSave`, `batchSaveMinimumDelay`, `batchSaveMaximumDelay`
  * Fetch Speed: `concurrencyOfReadChunksOnline`, `minimumIntervalOfReadChunksOnline`
  * Cache & Tuning: `processSmallFilesInUIThread`, `disableWorkerForGeneratingChunks`
