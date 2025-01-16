<!-- For translation: 20240227r0 -->
# Self-Hosted LiveSync
[Japanese docs](./README_ja.md) - [Chinese docs](./README_cn.md).

Self-Hosted LiveSync is a community-implemented synchronization plugin, available on every Obsidian-compatible platform and using CouchDB or Object Storage (e.g., MinIO, S3, R2, etc.) as the server.

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

Note: This plugin cannot synchronise with the official "Obsidian Sync".

## Features

- Synchronize vaults very efficiently with less traffic.
- Good at resolving merge conflicts.
  - Automatic merging for simple conflicts.
- Using OSS solution for the server.
  - Compatible solutions can be used.
- Supports end-to-end encryption.
- Synchronisation of settings, snippets, themes, and plugins, via [Customization Sync (Beta)](#customization-sync) or [Hidden File Sync](#hiddenfilesync)
- WebClip from [obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)

This plugin might be useful for researchers, engineers, and developers with a need to keep their notes fully self-hosted for security reasons. Or just anyone who would like the peace of mind of knowing that their notes are fully private.

>[!IMPORTANT]
> - Before installing or upgrading this plugin, please back your vault up.
> - Do not enable this plugin with another synchronization solution at the same time (including iCloud and Obsidian Sync).
> - This is a synchronization plugin. Not a backup solution. Do not rely on this for backup.

## How to use

### 3-minute setup - CouchDB on fly.io

**Recommended for beginners**

[![LiveSync Setup onto Fly.io SpeedRun 2024 using Google Colab](https://img.youtube.com/vi/7sa_I1832Xc/0.jpg)](https://www.youtube.com/watch?v=7sa_I1832Xc)

1. [Setup CouchDB on fly.io](docs/setup_flyio.md)
2. Configure the plugin using [Quick Setup](docs/quick_setup.md)

### Manual Setup

1. Setup the server
   1. [Setup CouchDB on fly.io](docs/setup_flyio.md)
   2. [Setup your CouchDB](docs/setup_own_server.md)
2. Configure the plugin using [Quick Setup](docs/quick_setup.md)

> [!TIP]
> Now, fly.io has become not free. Fortunately, even though there are some issues, we are still able to use IBM Cloudant. Here is [Setup IBM Cloudant](docs/setup_cloudant.md). It will be updated soon!


## Statusbar Icons

Synchronization status is shown in the status bar with the following icons.

-   Activity Indicator
    -   📲 Network request
-   Status
    -   ⏹️ Stopped
    -   💤 LiveSync enabled. Waiting for changes
    -   ⚡️ Synchronization in progress
    -   ⚠ An error occurred
-   Statistical indicator
     -   ↑ Uploaded chunks and metadata
     -   ↓ Downloaded chunks and metadata
-   Progress indicator
     -   📥 Unprocessed transferred items
     -   📄 Working database operation
     -   💾 Working write storage processes
     -   ⏳ Working read storage processes
     -   🛫 Pending read storage processes
     -   📬 Batched read storage processes
     -   ⚙️ Working or pending storage processes of hidden files
     -   🧩 Waiting chunks
     -   🔌 Working Customisation items (Configuration, snippets, and plug-ins)

To prevent file and database corruption, please try to wait until all progress indicators have disappeared before closing Obsidian (especially if you have deleted or renamed files). The plugin will also try to resume, though.



## Tips and Troubleshooting
If you are having problems getting the plugin working, see: [Tips and Troubleshooting](docs/troubleshooting.md)

## Acknowledgements

The project has been in continual progress and harmony because of 
- Many [Contributors](https://github.com/vrtmrz/obsidian-livesync/graphs/contributors)
- Many [GitHub Sponsors](https://github.com/sponsors/vrtmrz#sponsors)
- JetBrains Community Programs / Support for Open-Source Projects <img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" alt="JetBrains logo." height="24">

May those who have contributed be honoured and remembered for their kindness and generosity.

## License

Licensed under the MIT License.
