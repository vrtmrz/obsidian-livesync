# Self-hosted LiveSync

[Japanese docs](./README_ja.md).

Self-hosted LiveSync is a community implemented synchronization plugin.
It uses Self-hosted or you procured CouchDB as the server. Available on every obsidian installed devices.
Note: It has no compatibilities with official "Sync".

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

If you install or upgrade LiveSync, please back your vault up.

## Features

-   Visual conflict resolver included.
-   Synchronize with other devices bidirectionally near-real-time
-   You can use CouchDB or its compatibles like IBM Cloudant.
-   End-to-End encryption.
-   Plugin synchronization(Beta)
-   Receive WebClip from [obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf) (End-to-End encryption will not be applicable.)

It must be useful for the Researcher, Engineer, Developer who has to keep NDA or something like agreement. Especially, in some companies, people have to store all data to their fully controlled host, even End-to-End encryption applied.

## IMPORTANT NOTICE

-   Do not use with other synchronize solutions. Before enabling this plugin, make sure to disable other synchronize solutions, to avoid content corruption or duplication. If you want to synchronize to both backend, sync one by one, please.
    This includes making your vault on the cloud-controlled folder(e.g., Inside the iCloud folder).
-   This is the synchronization plugin. Not backup solutions. Do not rely on this for backup.
-   When the device's storage has been run out, Database corruption may happen.
-   When editing hidden files or any other invisible files from obsidian, the file wouldn't be kept in the database. (**Or be deleted.**)

## How to use

### Get your database ready.

First, get your database ready. IBM Cloudant is preferred for testing. Or you can use your own server with CouchDB. For more information, refer below:
1. [Setup IBM Cloudant](docs/setup_cloudant.md)
2. [Setup your CouchDB](docs/setup_own_server.md)

### First device

1. Install the plugin on your device.
2. Configure with the remote database.
	1. Fill your server's information into the `Remote Database configuration` pane.
	2. Enabling `End to End Encryption` is recommended. After inputting the passphrase, you have to press `Just apply`.
	3. Hit `Test Database Connection` and make sure that the plugin says `Connected`.
	4. Hit `Check database configuration` and make sure all tests have been passed.
3. Configure how to synchronize on `Sync setting`. (You can leave these  configures later)
	1. If you want to synchronize in real-time, enable `LiveSync`.
	2. Or, set up the synchronization as you like.
	3. Additional configuration is also here. I recommend enabling `Use Trash for deleted files, but you can leave all configurations disabled.
4. Configure miscellaneous features.
	1. Enabling `Show staus inside editor` bring you information. While edit mode, you can see the status on the top-right of the editor. (Recommended)
	2. Enabling `Use history` let you see the diffs between your edit and synchronization. (Recommended)
5. Back to the editor. I hope that initial scan is in the progress or done.
6. When status became stabilized (All ⏳ and 🧩 have been disappeared), you are ready to synchronize with the server.
7. Press the replicate icon on the Ribbon or run `Replicate now` from the Command pallet. You'll send all your data to the server.
8. Open the command palette, `Copy setup URI`, and set the passphrase to encrypt the information. Then your configuration will be copied to the clipboard. Please share copied URI with your other devices.
**IMPORTANT NOTICE: BE CAREFUL TO TREAT THIS URI. THE URI CONTAINS YOUR CREDENTIALS EVEN THOUGH NOBODY COULD READ WITHOUT THE PASSPHRASE.**

### Subsequent Devices

Strongly recommend using the vault in which all files are completely synchronized including timestamps. Otherwise, some files will be corrupted if failed to resolve conflicts. To simplify, I recommend using a new empty vault.

1. Install the plug-in.
2. Open the link that you had been copied to the other device.
3. The plug-in asks you that are you sure to apply the configurations. Please answer `Yes` and the following instruction below:
	1. Answer `Yes` to `Keep local DB?`.
		*Note: If you started with existed vault, you have to answer `No`. And `No` to `Rebuild the database?`.*
	2. Answer `Yes` to `Keep remote DB?`.
	3. Answer `Yes` to `Replicate once?`.
	Yes, you have to answer `Yes` to everything.
	Then, all your settings are copied from the first device.
4. Your notes will arrive soon.

## Something looks corrupted...

Please open the link again and Answer as below:
- If your local database looks corrupted
(in other words, when your Obsidian getting weird even standalone.)
	- Answer `No` to `Keep local DB?`
- If your remote database looks corrupted
(in other words, when something happens while replicating)
	- Answer `No` to `Keep remote DB?`

If you answered `No` to both, your databases will be rebuilt by the content on your device. And the remote database will lock out other devices. You have to synchronize all your devices again. (When this time, almost all your files should be synchronized including a timestamp. So you can use the existed vault).

## Test Server

Setting up an instance of Cloudant or local CouchDB is a little complicated, so I made the [Tasting server of self-hosted-livesync](https://olstaste.vrtmrz.net/) up. Try free!  
Note: Please read "Limitations" carefully. Do not send your private vault.

## Information in StatusBar

Synchronization status is shown in statusbar.

-   Status
    -   ⏹️ Stopped
    -   💤 LiveSync is enabled. Waiting for changes.
    -   ⚡️ Synchronize is now in progress.
    -   ⚠ Error occurred.
-   ↑ Uploaded pieces
-   ↓ Downloaded pieces
-   ⏳ Number of the pending processes
-   🧩 Number of the files that waiting for their chunks.
If you have deleted or renamed files, please wait until ⏳ disappeared.


## Hints
-   When the folder became empty by replication, The folder will be deleted in the default setting. But you can change this behaivour. Check the [Settings](docs/settings.md).
-   LiveSync mode drains many batteries in mobile devices. Periodic sync and some automatic sync is recommended.
-   Mobile Obsidian can not connect to the non-secure(HTTP) or local CA-signed servers, even though the certificate is stored in the device store.
-   There are no 'exclude_folders' like configurations.
-   When synchronized, files are compared by their modified times and overwritten by the newer ones once. Then plugin checks the conflicts and if a merge is needed, the dialog will open.
-   Rarely, the file in the database would be broken. The plugin will not write storage when it looks broken, so some old files must be on your device. If you edit the file, it will be cured. But if the file does not exist on any device, can not rescue it. So you can delete these items from the setting dialog.
-   If your database looks corrupted, try "Drop History". Usually, It is the easiest way.
-   To stop the bootup sequence for fixing problems on databases, you can put `redflag.md` on top of your vault.
-   Q: Database is growing, how can I shrink it up?
    A: each of the docs is saved with their old 100 revisions to detect and resolve confliction. Picture yourself that one device has been off the line for a while, and joined again. The device has to check his note and remote saved note. If exists in revision histories of remote notes even though the device's note is a little different from the latest one, it could be merged safely. Even if that is not in revision histories, we only have to check differences after the revision that both devices commonly have. This is like The git's conflict resolving method. So, We have to make the database again like an enlarged git repo if you want to solve the root of the problem.
-   And more technical Information are in the [Technical Information](docs/tech_info.md)
-   If you want to synchronize files without obsidian, you can use [filesystem-livesync](https://github.com/vrtmrz/filesystem-livesync).
-   WebClipper is also available.
Available from on Chrome Web Store:[obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)
Repo is here: [obsidian-livesync-webclip](https://github.com/vrtmrz/obsidian-livesync-webclip). (Docs are work in progress.)

## License

The source code is licensed MIT.
