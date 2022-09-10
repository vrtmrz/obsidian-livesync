# Self-hosted LiveSync

[Japanese docs](./README_ja.md) [Chinese docs](./README_cn.md).

Self-hosted LiveSync is a community implemented synchronization plugin.  
A self-hosted or purchased CouchDB acts as the intermediate server. Available on every obsidian-compatible platform.

Note: It has no compatibility with the official "Obsidian Sync".

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

Before installing or upgrading LiveSync, please back your vault up.

## Features

-   Visual conflict resolver included.
-   Bidirectional synchronization between devices nearly in real-time
-   You can use CouchDB or its compatibles like IBM Cloudant.
-   End-to-End encryption supported.
-   Plugin synchronization(Beta)
-   Receive WebClip from [obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf) (End-to-End encryption will not be applicable.)

Useful for researchers, engineers and developers with a need to keep their notes fully self-hosted for security reasons. Or just anyone who would like the peace of mind knowing that their notes are fully private. 

## IMPORTANT NOTICE

-   Do not use in conjunction with another synchronization solution (including iCloud, Obsidian Sync). Before enabling this plugin, make sure to disable all the other synchronization methods to avoid content corruption or duplication. If you want to synchronize to two or more services, do them one by one and never enable two synchronization methods at the same time.
    This includes not putting your vault inside a cloud-synchronized folder (eg. an iCloud folder or Dropbox folder)
-   This is a synchronization plugin. Not a backup solutions. Do not rely on this for backup.
-   If the device's storage runs out, database corruption may happen.
-   Hidden files or any other invisible files wouldn't be kept in the database, thus won't be synchronized. (**and may also get deleted**)

## How to use

### Get your database ready.

First, get your database ready. IBM Cloudant is preferred for testing. Or you can use your own server with CouchDB. For more information, refer below:
1. [Setup IBM Cloudant](docs/setup_cloudant.md)
2. [Setup your CouchDB](docs/setup_own_server.md)

Note: More information about alternative hosting methods needed! Currently, [using fly.io](https://github.com/vrtmrz/obsidian-livesync/discussions/85) is being discussed.

### First device

1. Install the plugin on your device.
2. Configure remote database information.
	1. Fill your server's information into the `Remote Database configuration` pane.
	2. Enabling `End to End Encryption` is recommended. After entering a passphrase, click `Apply`.
	3. Click `Test Database Connection` and make sure that the plugin says `Connected to (your-database-name)`.
	4. Click `Check database configuration` and make sure all tests have passed.
3. Configure when should the synchronization happen in `Sync Settings` tab. (You can also leave them for later)
	1. If you want to synchronize in real-time, enable `LiveSync`.
	2. Or, set up the synchronization as you like. By default, none of the settings are enabled, meaning you would need to manually trigger the synchronization process.
	3. Additional configurations are also here. I recommend enabling `Use Trash for deleted files`, but you can also leave all configurations as-is.
4. Configure miscellaneous features.
	1. Enabling `Show status inside editor` shows status at the top-right corner of the editor while in editing mode. (Recommended)
5. Go back to the editor. Wait for the initial scan to complete.
6. When the status no longer changes and shows a ⏹️ for COMPLETED (No ⏳ and 🧩 icons), you are ready to synchronize with the server.
7. Press the replicate icon on the Ribbon or run `Replicate now` from the command palette. This will send all your data to the server.
8. Open command palette, run `Copy setup URI`, and set a passphrase. This will export your configuration to clipboard as a link for you to import into your other devices.

**IMPORTANT: BE CAREFUL NOT TO SHARE THIS LINK. THE URI CONTAINS ALL YOUR CREDENTIALS.** (even though nobody could read them without the passphrase)

### Subsequent Devices

Note: If we are going to synchronize with a non-empty vault, the modification dates and times of the files must match between them. Otherwise, extra transfers may occur or files may become corrupted.
For simplicity, we strongly recommend that we sync to an empty vault.

1. Install the plug-in.
2. Open the link that you have exported from the first device.
3. The plug-in will ask you whether you are sure to apply the configurations. Answer `Yes`, then follow these instructions:
	1. Answer `Yes` to `Keep local DB?`.
		*Note: If you start with an existing vault, you have to answer `No` to this question and also answer `No` to `Rebuild the database?`.*
	2. Answer `Yes` to `Keep remote DB?`.
	3. Answer `Yes` to `Replicate once?`.
	Then, all your settings should be successfully imported from the first device.
4. Your notes should get synchronized soon.

## Something looks corrupted...

Please open the configuration link again and Answer as below:
- If your local database looks corrupted (in other words, when your Obsidian getting weird even standalone.)
	- Answer `No` to `Keep local DB?`
- If your remote database looks corrupted (in other words, when something happens while replicating)
	- Answer `No` to `Keep remote DB?`

If you answered `No` to both, your databases will be rebuilt by the content on your device. And the remote database will lock out other devices. You have to synchronize all your devices again. (When this time, almost all your files should be synchronized with a timestamp. So you can use a existed vault).

## Test Server

Setting up an instance of Cloudant or local CouchDB is a little complicated, so I set up a [Tasting server for self-hosted-livesync](https://olstaste.vrtmrz.net/). Try it out for free!  
Note: Please read "Limitations" carefully. Do not send your private vault.

## Information in StatusBar

Synchronization status is shown in statusbar.

-   Status
    -   ⏹️ Stopped
    -   💤 LiveSync enabled. Waiting for changes.
    -   ⚡️ Synchronization in progress.
    -   ⚠ An error occurred.
-   ↑ Uploaded chunks and metadata
-   ↓ Downloaded chunks and metadata
-   ⏳ Number of pending processes
-   🧩 Number of files waiting for their chunks.
If you have deleted or renamed files, please wait until ⏳ icon disappeared.


## Hints
-   If a folder becomes empty after a replication, it will be deleted by default. But you can toggle this behaviour. Check the [Settings](docs/settings.md).
-   LiveSync mode drains more batteries in mobile devices. Periodic sync with some automatic sync is recommended.
-   Mobile Obsidian can not connect to a non-secure (HTTP) or a locally-signed servers, even if the root certificate is installed on the device.
-   There are no 'exclude_folders' like configurations.
-   While synchronizing, files are compared by their modification time and the older ones will be overwritten by the newer ones. Then plugin checks for conflicts and if a merge is needed, a dialog will open.
-   Rarely, a file in the database could be corrupted. The plugin will not write to local storage when a file looks corrupted. If a local version of the file is on your device, the corruption could be fixed by editing the local file and synchronizing it. But if the file does not exist on any of your devices, then it can not be rescued. In this case you can delete these items from the settings dialog.
-   To stop the boot up sequence (eg. for fixing problems on databases), you can put a `redflag.md` file at the root of your vault.
-   Q: Database is growing, how can I shrink it down?
    A: each of the docs is saved with their past 100 revisions for detecting and resolving conflicts. Picturing that one device has been offline for a while, and comes online again. The device has to compare its notes with the remotely saved ones. If there exists a historic revision in which the note used to be identical, it could be updated safely (like git fast-forward). Even if that is not in revision histories, we only have to check the differences after the revision that both devices commonly have. This is like git's conflict resolving method. So, We have to make the database again like an enlarged git repo if you want to solve the root of the problem.
-   And more technical Information are in the [Technical Information](docs/tech_info.md)
-   If you want to synchronize files without obsidian, you can use [filesystem-livesync](https://github.com/vrtmrz/filesystem-livesync).
-   WebClipper is also available on Chrome Web Store:[obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)

Repo is here: [obsidian-livesync-webclip](https://github.com/vrtmrz/obsidian-livesync-webclip). (Docs are work in progress.)

## License

The source code is licensed under the MIT License.
