# Self-hosted LiveSync

[Japanese docs](./README_ja.md) [Chinese docs](./README_cn.md).

Self-hosted LiveSync is a community-implemented synchronization plugin.  
A self-hosted or purchased CouchDB acts as the intermediate server. Available on every obsidian-compatible platform.

Note: It has no compatibility with the official "Obsidian Sync".

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

Before installing or upgrading LiveSync, please back your vault up.

## Features

-   Visual conflict resolver included.
-   Bidirectional synchronization between devices nearly in real-time
-   You can use CouchDB or its compatibles like IBM Cloudant.
-   End-to-End encryption is supported.
-   Plugin synchronization(Beta)
-   Receive WebClip from [obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf) (End-to-End encryption will not be applicable.)

Useful for researchers, engineers and developers with a need to keep their notes fully self-hosted for security reasons. Or just anyone who would like the peace of mind of knowing that their notes are fully private. 

## IMPORTANT NOTICE

-   Do not enable this plugin with another synchronization solution at the same time (including iCloud and Obsidian Sync). Before enabling this plugin, make sure to disable all the other synchronization methods to avoid content corruption or duplication. If you want to synchronize to two or more services, do them one by one and never enable two synchronization methods at the same time.
    This includes not putting your vault inside a cloud-synchronized folder (eg. an iCloud folder or Dropbox folder)
-   This is a synchronization plugin. Not a backup solution. Do not rely on this for backup.
-   If the device's storage runs out, database corruption may happen.
-   Hidden files or any other invisible files wouldn't be kept in the database, and thus won't be synchronized. (**and may also get deleted**)

## How to use

### Get your database ready.

First, get your database ready. IBM Cloudant is preferred for testing. Or you can use your own server with CouchDB. For more information, refer below:
1. [Setup IBM Cloudant](docs/setup_cloudant.md)
2. [Setup your CouchDB](docs/setup_own_server.md)

Note: More information about alternative hosting methods is needed! Currently, [using fly.io](https://github.com/vrtmrz/obsidian-livesync/discussions/85) is being discussed.

### Configure the plugin

See [Quick setup guide](doccs/../docs/quick_setup.md)

## Something looks corrupted...

Please open the configuration link again and Answer below:
- If your local database looks corrupted (in other words, when your Obsidian getting weird even standalone.)
	- Answer `No` to `Keep local DB?`
- If your remote database looks corrupted (in other words, when something happens while replicating)
	- Answer `No` to `Keep remote DB?`

If you answered `No` to both, your databases will be rebuilt by the content on your device. And the remote database will lock out other devices. You have to synchronize all your devices again. (When this time, almost all your files should be synchronized with a timestamp. So you can use an existing vault).

## Test Server

~~Setting up an instance of Cloudant or local CouchDB is a little complicated, so I set up a [Tasting server for self-hosted-livesync](https://olstaste.vrtmrz.net/). Try it out for free!~~ Now (30 May 2023) is suspending while the server transfer.
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
-   Mobile Obsidian can not connect to non-secure (HTTP) or locally-signed servers, even if the root certificate is installed on the device.
-   There are no 'exclude_folders' like configurations.
-   While synchronizing, files are compared by their modification time and the older ones will be overwritten by the newer ones. Then plugin checks for conflicts and if a merge is needed, a dialog will open.
-   Rarely, a file in the database could be corrupted. The plugin will not write to local storage when a file looks corrupted. If a local version of the file is on your device, the corruption could be fixed by editing the local file and synchronizing it. But if the file does not exist on any of your devices, then it can not be rescued. In this case, you can delete these items from the settings dialog.
-   To stop the boot-up sequence (eg. for fixing problems on databases), you can put a `redflag.md` file (or directory) at the root of your vault.
    Tip for iOS: a redflag directory can be created at the root of the vault using the File application.
-   Also, with `redflag2.md` placed, we can automatically rebuild both the local and the remote databases during the boot-up sequence. With `redflag3.md`, we can discard only the local database and fetch from the remote again.
-   Q: The database is growing, how can I shrink it down?
    A: each of the docs is saved with their past 100 revisions for detecting and resolving conflicts. Picturing that one device has been offline for a while, and comes online again. The device has to compare its notes with the remotely saved ones. If there exists a historic revision in which the note used to be identical, it could be updated safely (like git fast-forward). Even if that is not in revision histories, we only have to check the differences after the revision that both devices commonly have. This is like git's conflict-resolving method. So, We have to make the database again like an enlarged git repo if you want to solve the root of the problem.
-   And more technical Information is in the [Technical Information](docs/tech_info.md)
-   If you want to synchronize files without obsidian, you can use [filesystem-livesync](https://github.com/vrtmrz/filesystem-livesync).
-   WebClipper is also available on Chrome Web Store:[obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)

Repo is here: [obsidian-livesync-webclip](https://github.com/vrtmrz/obsidian-livesync-webclip). (Docs are a work in progress.)

## License

The source code is licensed under the MIT License.
