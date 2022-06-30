NOTE: This document surely became outdated. I'll improve this doc in a while. but your contributions are always welcome.

# Settings of this plugin

The settings dialog has been quite long, so I split each configuration into tabs.  
If you feel something, please feel free to inform me.

| icon  | description                                                       |
| :---: | ----------------------------------------------------------------- |
|   🛰️   | [Remote Database Configurations](#remote-database-configurations) |
|   📦   | [Local Database Configurations](#local-database-configurations)   |
|   ⚙️   | [General Settings](#general-settings)                             |
|   🔁   | [Sync setting](#sync-setting)                                     |
|   🔧   | [Miscellaneous](#miscellaneous)                                   |
|   🧰   | [Hatch](#miscellaneous)                                           |
|   🔌   | [Plugin and its settings](#plugin-and-its-settings)               |
|   🚑   | [Corrupted data](#corrupted-data)                                 |

## Remote Database Configurations
Configure settings of synchronize server. If any synchronization is enabled, you can't edit this section. Please disable all synchronization to change.

### URI
URI of CouchDB. In the case of Cloudant, It's "External Endpoint(preferred)".  
**Do not end it up with a slash** when it doesn't contain the database name.

### Username
Your CouchDB's Username. With administrator's privilege is preferred.

### Password
Your CouchDB's Password.  
Note: This password is saved into your Obsidian's vault in plain text.

### Database Name
The Database name to synchronize.  
⚠️If not exist, created automatically.


### End to End Encryption
Encrypt your database. It affects only the database, your files are left as plain.

The encryption algorithm is AES-GCM.

Note: If you want to use "Plugins and their settings", you have to enable this.

### Passphrase
The passphrase to used as the key of encryption. Please use the long text.

### Apply
Set the End to End encryption enabled and its passphrase for use in replication.  
If you change the passphrase with existen database, overwriting remote database is strongly recommended.


### Overwrite by local DB
Overwrite the remote database by the local database using the passphrase you applied.


### Rebuild
Rebuild remote and local databases with local files. It will delete all document history and retained chunks, and shrink the database.

### Test Database connection
You can check the connection by clicking this button.

### Check database configuration
You can check and modify your CouchDB's configuration from here directly.

### Lock remote database.
Other devices are banned from the database when you have locked the database.  
If you have something troubled with other devices, you can protect the vault and remote database by your device.

## Local Database Configurations
"Local Database" is created inside your obsidian.

### Batch database update
Delay database update until raise replication, open another file, window visibility changed, or file events except for file modification.  
This option can not be used with LiveSync at the same time.

### Garbage check
This plugin saves the file by splitting it into chunks to speed replication up and keep low bandwidth.

They share the chunk if you use the same paragraph in some notes. And if you change the file, only the paragraph you changed is transferred with metadata of the file. And I know that editing notes are not so straight. Sometimes paragraphs will be back into an old phrase. In these cases, we do not have to transfer the chunk again if the chunk will not be deleted. So all chunks will be reused.

As the side effect of this, you can see history the file.

The check will show the number of chunks used or retained. If there are so many retained chunks, you can rebuild the database.

### Fetch rebuilt DB.
If one device rebuilds or locks the remote database, every other device will be locked out from the remote database until it fetches rebuilt DB.

### minimum chunk size and LongLine threshold
The configuration of chunk splitting.

Self-hosted LiveSync splits the note into chunks for efficient synchronization. This chunk should be longer than "Minimum chunk size".

Specifically, the length of the chunk is determined by the following orders.

1. Find the nearest newline character, and if it is farther than LongLineThreshold, this piece becomes an independent chunk.

2. If not, find nearest to these items.
    1. Newline character
    2. Empty line (Windows style)
    3. Empty line (non-Windows style)
3. Compare the farther in these 3 positions and next "\[newline\]#" position, pick a shorter piece to as chunk.

This rule was made empirically from my dataset. If this rule acts as badly on your data. Please give me the information.

You can dump saved note structure to `Dump informations of this doc`. Replace every character to x except newline and "#" when sending information to me.

Default values are 20 letters and 250 letters.

## General Settings

### Do not show low-priority log
If you enable this option, log only the entries with the popup.

### Verbose log

## Sync setting

### LiveSync
Do LiveSync.

It is the one of raison d'être of this plugin.

Useful, but this method drains many batteries on the mobile and uses not the ignorable amount of data transfer.

This method is exclusive to other synchronization methods.

### Periodic Sync
Synchronize periodically. 

### Periodic Sync Interval
Unit is seconds.

### Sync on Save
Synchronize when the note has been modified or created.

### Sync on File Open
Synchronize when the note is opened.

### Sync on Start
Synchronize when Obsidian started.

### Use Trash for deleted files
When the file has been deleted on remote devices, deletion will be replicated to the local device and the file will be deleted.

If this option is enabled, move deleted files into the trash instead delete actually.

### Do not delete empty folder
Self-hosted LiveSync will delete the folder when the folder becomes empty. If this option is enabled, leave it as an empty folder.

### Use newer file if conflicted (beta)
Always use the newer file to resolve and overwrite when conflict has occurred.

### Advanced settings
Self-hosted LiveSync using PouchDB and synchronizes with the remote by [this protocol](https://docs.couchdb.org/en/stable/replication/protocol.html).
So, it splits every entry into chunks to be acceptable by the database with limited payload size and document size.

However, it was not enough.
According to [2.4.2.5.2. Upload Batch of Changed Documents](https://docs.couchdb.org/en/stable/replication/protocol.html#upload-batch-of-changed-documents) in [Replicate Changes](https://docs.couchdb.org/en/stable/replication/protocol.html#replicate-changes), it might become a bigger request.

Unfortunately, there is no way to deal with this automatically by size for every request.
Therefore, I made it possible to configure this.

Note: If you set these values lower number, the number of requests will increase.  
Therefore, if you are far from the server, the total throughput will be low, and the traffic will increase.

### Batch size
Number of change feed items to process at a time. Defaults to 250.

### Batch limit
Number of batches to process at a time. Defaults to 40. This along with batch size controls how many docs are kept in memory at a time.

## Miscellaneous

### Show status inside editor
Show information inside the editor pane.
It would be useful for mobile.

### Check integrity on saving
Check all chunks are correctly saved on saving.

### Presets
You can set synchronization method at once as these pattern:
- LiveSync
  - LiveSync : enabled
  - Batch database update : disabled
  - Periodic Sync : disabled
  - Sync on Save : disabled
  - Sync on File Open : disabled
  - Sync on Start : disabled
- Periodic w/ batch
  - LiveSync : disabled
  - Batch database update : enabled
  - Periodic Sync : enabled
  - Sync on Save : disabled
  - Sync on File Open : enabled
  - Sync on Start : enabled
- Disable all sync
  - LiveSync : disabled
  - Batch database update : disabled
  - Periodic Sync : disabled
  - Sync on Save : disabled
  - Sync on File Open : disabled
  - Sync on Start : disabled


## Hatch
From here, everything is under the hood. Please handle it with care.

When there are problems with synchronization, the warning message is shown Under this section header.

- Pattern 1  
![CorruptedData](../images/lock_pattern1.png)  
This message is shown when the remote database is locked and your device is not marked as "resolved".  
Almost it is happened by enabling End-to-End encryption or History has been dropped.  
If you enabled End-to-End encryption, you can unlock the remote database by "Apply and receive" automatically. Or "Drop and receive" when you dropped. If you want to unlock manually, click "mark this device as resolved".

- Pattern 2  
![CorruptedData](../images/lock_pattern2.png)  
The remote database indicates that has been unlocked Pattern 1.  
When you mark all devices as resolved, you can unlock the database.
But, there's no problem even if you leave it as it is.

### Verify and repair all files
read all files in the vault, and update them into the database if there's diff or could not read from the database.

### Sanity check
Make sure that all the files on the local database have all chunks.

### Drop history
Drop all histories on the local database and the remote database, and initialize When synchronization time has been prolonged to the new device or new vault, or database size became to be much larger. Try this.

Note: When CouchDB deletes entries, to merge confliction, there left old entries as deleted data before compaction. After compaction has been run, deleted data are become "tombstone". "tombstone" uses less disk, But still use some. 

It's the specification, to shrink database size from the root, re-initialization is required, even it's explicit or implicit.

Same as a setting passphrase, database locking is also performed.


- Drop and send (Same as "Apply and send")
1. Initialize the Local Database and set (or clear) passphrase, put all files into the database again.
2. Initialize the Remote Database.
3. Lock the Remote Database.
4. Send it all. 

- Drop and receive (Same as "Apply and receive")
1. Initialize the Local Database and set (or clear) the passphrase.
2. Unlock the Remote Database.
3. Retrieve all and decrypt to file.


### Suspend file watching
If enable this option, Self-hosted LiveSync dismisses every file change or deletes the event.

From here, these commands are used inside applying encryption passphrases or dropping histories.

Usually, doesn't use it so much. But sometimes it could be handy.

### Reset remote database
Discard the data stored in the remote database.

### Reset local database
Discard the data stored in the local database.

### Initialize local database again
Discard the data stored in the local database and initialize and create the database from the files on storage.

## Plugins and settings (beta)

### Enable plugin synchronization
If you want to use this feature, you have to activate this feature by this switch.

### Sweep plugins automatically
Plugin sweep will run before replication automatically.

### Sweep plugins periodically
Plugin sweep will run each 1 minute.

### Notify updates
When replication is complete, a message will be notified if a newer version of the plugin applied to this device is configured on another device.

### Device and Vault name
To save the plugins, you have to set a unique name every each device.

### Open
Open the "Plugins and their settings" dialog.

### Corrupted or missing data
![CorruptedData](../images/corrupted_data.png)

When Self-hosted LiveSync could not write to the file on the storage, the files are shown here. If you have the old data in your vault, change it once, it will be cured. Or you can use the "File History" plugin.
