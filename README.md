# Self-hosted LiveSync
[Japanese docs](./README_ja.md) - [Chinese docs](./README_cn.md).


Self-hosted LiveSync is a community-developed synchronisation plug-in available on all Obsidian-compatible platforms. It leverages robust server solutions such as CouchDB or object storage systems (e.g., MinIO, S3, R2, etc.) to ensure reliable data synchronisation.

Additionally, it supports peer-to-peer synchronisation using WebRTC, enabling devices to exchange notes without a central data-storage server. A signalling relay is still required for peer discovery. See [How peer-to-peer synchronisation works](./docs/p2p.md).

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

>[!IMPORTANT]
> This plug-in is not compatible with the official "Obsidian Sync" and cannot synchronise with it.

## Features
- Synchronise vaults efficiently with minimal traffic.
- Handle conflicting modifications effectively.
  - Automatically merge simple conflicts.
- Use open-source solutions for the server.
  - Compatible solutions are supported.
- Support end-to-end encryption.
- Synchronise settings, snippets, themes, and plug-ins via [Customisation Sync (Beta)](docs/settings.md#6-customisation-sync-advanced) or [Hidden File Sync](docs/tips/hidden-file-sync.md).
- Enable supported, opt-in WebRTC peer-to-peer synchronisation.
  - No central data-storage server is required, but a signalling relay is still required for peer discovery.
  - At least one device containing the required data must be online while another device synchronises.
  - Follow the [Peer-to-Peer Setup](docs/setup_p2p.md) after reviewing the [P2P communication model](docs/p2p.md).

This plug-in may be particularly useful for researchers, engineers, and developers who need to keep their notes fully self-hosted for security reasons. It is also suitable for anyone seeking the peace of mind that comes with knowing their notes remain entirely private.

>[!IMPORTANT]
> - Before installing or upgrading this plug-in, please back up your vault.
> - Do not enable this plug-in alongside another synchronisation solution (including iCloud and Obsidian Sync).
> - For backups, we also provide a plug-in called [Differential ZIP Backup](https://github.com/vrtmrz/diffzip).

## How to Use

### 3-minute setup - CouchDB on fly.io

**Recommended for beginners**

[![LiveSync Setup onto Fly.io SpeedRun 2024 using Google Colab](https://img.youtube.com/vi/7sa_I1832Xc/0.jpg)](https://www.youtube.com/watch?v=7sa_I1832Xc)

1. [Set up CouchDB on fly.io](docs/setup_flyio.md)
2. Configure plug-in in [Quick Setup](docs/quick_setup.md)

### Setup workflows

Choose a synchronisation method, prepare its server where required, then follow the corresponding client setup:

1. CouchDB
   1. Prepare the server:
      - [Set up your own CouchDB server](docs/setup_own_server.md).
      - [Set up CouchDB on fly.io](docs/setup_flyio.md).
   2. Configure the clients by following [CouchDB Quick Setup](docs/quick_setup.md).
2. Object Storage
   1. Prepare the server. A maintained MinIO server installation guide is not currently available here, so set up an S3-compatible service or server of your choice.
   2. Configure the clients by following [Object Storage Setup](docs/setup_object_storage.md).
3. Peer-to-Peer
   1. No central data-storage server is required. The project's public signalling relay requires no server provisioning; controlled deployments can provide another compatible relay.
   2. Configure the clients by following [Peer-to-Peer Setup](docs/setup_p2p.md).

Each workflow establishes ordinary note synchronisation on the first device, generates a Setup URI for each additional device from that working device, and verifies synchronisation in both directions.

> [!TIP]
> Fly.io is no longer free. Fortunately, we can still use IBM Cloudant despite some limitations. Refer to [Set up IBM Cloudant](docs/setup_cloudant.md).
> We can also use peer-to-peer synchronisation without a central data-storage server; a signalling relay is still used for peer discovery. Alternatively, cheap object storage like Cloudflare R2 can be used for free.
> However, most importantly, we can use a server that we trust. Therefore, please set up your own server.
> CouchDB can also be run on a Raspberry Pi (please be mindful of your server's security).


## Information in the Status Bar

Synchronisation status is shown in the status bar with the following icons.

-   Activity Indicator
    -   📲 A finite remote operation is in progress
    -   🌐N Approximate remote requests currently in progress
-   Status
    -   ⏹️ Stopped
    -   💤 LiveSync enabled. Waiting for changes
    -   ⚡️ Synchronisation in progress
    -   ⚠ An error occurred
-   Statistical Indicators
     -   ↑ Uploaded chunks and metadata
     -   ↓ Downloaded chunks and metadata
-   Progress Indicators
     -   📥 Unprocessed transferred items
     -   📄 Working database operation
     -   💾 Working write storage processes
     -   ⏳ Working read storage processes
     -   🛫 Pending read storage processes
     -   📬 Batched read storage processes
     -   ⚙️ Working or pending storage processes for hidden files
     -   🧩 Waiting chunks
     -   🔌 Working customisation items (configuration, snippets, and plug-ins)

To prevent file and database corruption, please avoid closing Obsidian until all progress indicators have disappeared as much as possible (although the plug-in will attempt to resume if interrupted). This is especially important if you have deleted or renamed files.

## Tips and Troubleshooting
- If you want a faster and simpler initial replication when setting up subsequent devices, see the [Fast Setup Guide](docs/tips/fast-setup.md).
- Configure [Hidden File Sync](docs/tips/hidden-file-sync.md) only after ordinary note synchronisation works.
- If Obsidian or LiveSync cannot start normally, use [Recovery and flag files](docs/recovery.md) before changing or resetting a remote database.
- Self-hosted LiveSync 1.0 requires Obsidian 1.7.2 or later. If you need to use 1.0 on an earlier Obsidian version, please [open an issue](https://github.com/vrtmrz/obsidian-livesync/issues/new?template=issue-report.md) with your version, platform, and reason for remaining on it so that we can assess whether extending support is practical. The standard Community Plugins installer otherwise selects an older compatible plug-in release.
- If you are having problems getting the plug-in working, see [Tips and Troubleshooting](docs/troubleshooting.md).

## Acknowledgements
The project has been in continual progress and harmony thanks to the following:  
- Many [Contributors](https://github.com/vrtmrz/obsidian-livesync/graphs/contributors).  
- Many [GitHub Sponsors](https://github.com/sponsors/vrtmrz#sponsors).  
- JetBrains Community Programs / Support for Open-Source Projects. <img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" alt="JetBrains logo" height="24">  

May those who have contributed be honoured and remembered for their kindness and generosity.

## Development Guide
Please refer to the [Development Guide](devs.md) for development setup, testing infrastructure, code conventions, and more.

## License

Licensed under the MIT License.
