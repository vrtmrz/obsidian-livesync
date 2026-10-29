# Self-hosted LiveSync
[Japanese docs](./README_ja.md) - [Chinese docs](./README_cn.md).

Self-hosted LiveSync is a community-developed synchronisation plug-in available on all Obsidian-compatible platforms. It leverages robust server solutions such as CouchDB or object storage systems (e.g., MinIO, S3, R2, etc.) to ensure reliable data synchronisation.

Additionally, it supports peer-to-peer synchronisation using WebRTC, enabling devices to exchange notes without a central data-storage server. A signalling relay is still required for peer discovery. See [How peer-to-peer synchronisation works](./docs/p2p.md).

Find setup guides, troubleshooting, technical references, design decisions, and historical material in the [documentation index](docs/README.md).

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
- Synchronise settings, snippets, themes, and plug-ins via [Customisation Sync (Advanced)](docs/settings.md#6-customisation-sync-advanced) or [Hidden File Sync](docs/tips/hidden-file-sync.md).
- Synchronise peer-to-peer using WebRTC.

This plug-in may be particularly useful for researchers, engineers, and developers who need to keep their notes fully self-hosted for security reasons. It is also suitable for anyone seeking the peace of mind that comes with knowing their notes remain entirely private.

>[!IMPORTANT]
> - Before installing or upgrading this plug-in, please back up your vault.
> - Do not enable this plug-in alongside another synchronisation solution (including iCloud and Obsidian Sync).
> - For backups, we also provide a plug-in called [Differential ZIP Backup](https://github.com/vrtmrz/diffzip).

## How to Use

Self-hosting lets us choose a server we trust and manage it ourselves. Please set up and maintain your own server, and keep it secure.

<a id="setup-workflows"></a>

### What you need

| Method | What you need | Nice to have |
| --- | --- | --- |
| CouchDB | A CouchDB-compatible server. | — |
| Object Storage | An S3-compatible service or server. | — |
| Peer-to-Peer | Nothing. | Your own signalling server. |

For a CouchDB-compatible server, choose a setup guide for your environment:

- [Your own server](docs/setup_own_server.md): run CouchDB on a Raspberry Pi or another server you manage.
- [Docker](docker/README.md): deploy CouchDB with the supplied Docker stack.
- [Fly.io](docs/setup_flyio.md): manage your own CouchDB instance on hosted infrastructure.
- [IBM Cloudant (managed)](docs/setup_cloudant.md): use a database service managed by IBM.

The linked guides explain the setup and any provider-specific costs.

<a id="3-minute-setup---couchdb-on-flyio"></a>

For the Fly.io video walkthrough, see [automated setup](docs/setup_flyio.md#a-very-automated-setup).

P2P does not require a central data-storage server, but a signalling relay is still required for peer discovery. You can use the project's public signalling relay, so there is no server to provision. At least one device containing the required data must be online while another device synchronises. Follow the [Peer-to-Peer Setup](docs/setup_p2p.md) after reviewing the [P2P communication model](docs/p2p.md).

If you would like to see how P2P setup and connectivity behave on your devices, try the guided connection check in the experimental [WebPeer browser utility](https://vrtmrz.github.io/obsidian-livesync/webpeer/). It uses an empty Vault and does not test note synchronisation. See the [WebPeer documentation](src/apps/webpeer/README.md) for its scope and limitations.

### Start synchronising

1. Install and configure Self-hosted LiveSync on your first device using [Quick Setup](docs/quick_setup.md) for CouchDB, [Object Storage Setup](docs/setup_object_storage.md), or [Peer-to-Peer Setup](docs/setup_p2p.md).
2. Generate a Setup URI from that working device and follow the same guide to add your other devices.
3. Create test notes and confirm that they synchronise in both directions.

<a id="third-party-managed-couchdb-hosting"></a>

### Hosting services proposed by the community

> [!NOTE]
> The services below are operated by third parties. They are not official Self-hosted LiveSync services, and this project neither endorses nor recommends them. The providers proposed the listings in the table.

If you would rather not set up and maintain a server yourself, the following providers offer managed CouchDB servers which this plug-in can be configured to connect to:

| Provider | Offering |
| --- | --- |
| [Zenith Hosting](https://zenith.hosting/host/obsidian-livesync) | Managed CouchDB hosting. |

Your synchronisation data will reside on a server operated by the provider. Consider whether that is acceptable for your Vault, and review the provider's current terms, pricing, and data-handling policies before using the service.

## Information in the Status Bar

Synchronisation status is shown in the status bar and inside the editor by default. The main indicators are:

| Indicator | Meaning |
| --- | --- |
| ⏹️ | Stopped. |
| 🌀 | Starting synchronisation. |
| 💤 | LiveSync mode is waiting for changes. |
| ⚡️ | Synchronisation is in progress. |
| ⏩ | Comparing CouchDB change history, including entries already held locally. |
| ⚠ | An error occurred. |
| ↑ / ↓ | Uploaded / downloaded Chunks and Metadata. |
| 📲 / 🌐N | A finite remote operation is in progress / approximate remote requests in progress. |

<a id="customising-status-items-with-css-snippets"></a>

See the [status display guide](docs/tips/status-display.md) for detailed progress counters and [CSS customisation](docs/tips/status-display.md#customising-status-items-with-css-snippets).

Allow pending file operations to finish before closing Obsidian, especially after deleting or renaming files.

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
