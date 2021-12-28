# Self-hosted LiveSync

Sorry for late! [Japanese docs](./README_ja.md) is also coming up.

**Renamed from: obsidian-livesync**

Using a self-hosted database, live-sync to multi-devices bidirectionally.
Runs in Mac, Android, Windows, and iOS. Perhaps available on Linux too.
Community implementation, not compatible with official "Sync".

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

**It's getting almost stable now, But Please make sure to back your vault up!**

Limitations: ~~Folder deletion handling is not completed.~~ **It would work now.**

## This plugin enables...

-   Runs in Windows, Mac, iPad, iPhone, Android, Chromebook
-   Synchronize to Self-hosted Database
-   Replicate to/from other devices bidirectionally near-real-time
-   Resolving synchronizing conflicts in the Obsidian.
-   You can use CouchDB or its compatibles like IBM Cloudant. CouchDB is OSS, and IBM Cloudant has the terms and certificates about security. Your notes are yours.
-   Off-line sync is also available.
-   End-to-End encryption is available (beta).
-   Receive WebClip from [obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf) (End-to-End encryption will not be applicable.)

It must be useful for the Researcher, Engineer, Developer who has to keep NDA or something like agreement.
Especially, in some companies, people have to store all data to their fully controlled host, even End-to-End encryption applied.

## IMPORTANT NOTICE

-   Do not use with other synchronize solutions. Before enabling this plugin, make sure to disable other synchronize solutions, to avoid content corruption or duplication. If you want to synchronize to both backend, sync one by one, please.
    This includes making your vault on the cloud-controlled folder(e.g., Inside the iCloud folder).
-   This is the synchronization plugin. Not backup solutions. Do not rely on this for backup.
-   When the device's storage has been run out, Database corruption may happen.
-   When editing hidden files or any other invisible files from obsidian, the file wouldn't be kept in the database. (**Or be deleted.**)

## Supplements

-   When the file has been deleted, the deletion of the file is replicated to other devices.
-   When the folder became empty by replication, The folder will be deleted in the default setting. But you can change this behaivour. Check the [Settings](docs/settings.md).
-   LiveSync drains many batteries in mobile devices.
-   Mobile Obsidian can not connect to the non-secure(HTTP) or local CA-signed servers, even though the certificate is stored in the device store.
-   There are no 'exclude_folders' like configurations.

## How to use

1. Install from Obsidian, or download from this repo's releases, copy `main.js`, `styles.css` and `manifest.json` into `[your-vault]/.obsidian/plugins/`
2. Get your database. IBM Cloudant is preferred for testing. Or you can use your own server with CouchDB.
   For more information, refer below:
    1. [Setup IBM Cloudant](docs/setup_cloudant.md)
    2. [Setup your CouchDB](docs/setup_own_server.md)
3. Enter connection information to Plugin's setting dialog. In details, refer [Settings of Self-hosted LiveSync](docs/settings.md)
4. Enable LiveSync or other Synchronize method as you like.

## Test Server

Setting up an instance of Cloudant or local CouchDB is a little complicated, so I made the [Tasting server of self-hosted-livesync](https://olstaste.vrtmrz.net/) up. Try free!  
Note: Please read "Limitations" carefully. Do not send your private vault.

## WebClipper is also available.

Available from on Chrome Web Store:[obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)  
Repo is here: [obsidian-livesync-webclip](https://github.com/vrtmrz/obsidian-livesync-webclip). (Docs are work in progress.)

# Information in StatusBar

Synchronization status is shown in statusbar.

-   Status
    -   ⏹️ Stopped
    -   💤 LiveSync is enabled. Waiting for changes.
    -   ⚡️ Synchronize is now in progress.
    -   ⚠ Error occurred.
-   ↑ Uploaded pieces
-   ↓ Downloaded pieces

# More supplements

-   When synchronized, files are compared by their modified times and overwritten by the newer ones once. Then plugin checks the conflicts and if a merge is needed, the dialog will open.
-   Rarely, the file in the database would be broken. The plugin will not write storage when it looks broken, so some old files must be on your device. If you edit the file, it will be cured. But if the file does not exist on any device, can not rescue it. So you can delete these items from the setting dialog.
-   If your database looks corrupted, try "Drop History". Usually, It is the easiest way.
-   To stop the bootup sequence for fixing problems on databases, you can put `redflag.md` on top of your vault.
-   Q: Database is growing, how can I shrink it up?
    A: each of the docs is saved with their old 100 revisions to detect and resolve confliction. Picture yourself that one device has been off the line for a while, and joined again. The device has to check his note and remote saved note. If exists in revision histories of remote notes even though the device's note is a little different from the latest one, it could be merged safely. Even if that is not in revision histories, we only have to check differences after the revision that both devices commonly have. This is like The git's conflict resolving method. So, We have to make the database again like an enlarged git repo if you want to solve the root of the problem.
-   And more technical Information are in the [Technical Information](docs/tech_info.md)

# License

The source code is licensed MIT.
