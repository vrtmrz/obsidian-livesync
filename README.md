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
<a id="what-you-need"></a>

### 1. Choose a synchronisation backend

Choose **CouchDB** or **Object Storage** for central storage, or use **WebRTC Peer-to-Peer (P2P)** without a central storage server. CouchDB and Object Storage are alternatives: choosing Object Storage does not require a CouchDB server. P2P can also run alongside either central backend; its connection is selected independently.

> [!TIP]
> **You can switch backends at any time**: Self-hosted LiveSync supports multiple connection profiles via **Saved connections** in settings. You can begin with a hosted option such as Fly.io or Cloudflare R2, and switch to your own server later without rebuilding your Vault files.

#### Backend comparison and decision guide

| Backend / Environment | LiveSync Mode<br>(Real-time continuous) | Sync while others offline | Mobile support<br>(iOS and Android) | Maintenance effort | Monthly cost example | Recommended for |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **CouchDB (Self-hosted)**<br>*(Own VPS, NAS, Docker, or Raspberry Pi)* | ✅ Full | ✅ Yes | ⚠️ Requires HTTPS (public or private endpoint)[^private-https] | High (manage OS, Docker, and backups) | Free (on existing hardware) | Users with home servers or private infrastructure |
| **CouchDB (Fly.io)**<br>*(Cloud container PaaS)* | ✅ Full | ✅ Yes | ✅ Out of the box (HTTPS included) | Low (scripted setup via notebook) | ~USD 2.34 / mo in Ashburn[^fly-pricing]<br>*(see [cost details](docs/setup_flyio.md#costs-before-deployment))* | Users wanting real-time sync without managing hardware |
| **Object Storage (S3 / R2)**<br>*(Cloudflare R2, AWS S3, or MinIO)* | ❌ Periodic or on-save only | ✅ Yes | Managed services: HTTPS included<br>Self-hosted: configure HTTPS | Managed services: bucket configuration<br>Self-hosted: manage the server and backups | USD 0.00 within R2 free allowances[^r2-pricing]<br>*(see [cost guide](docs/setup_object_storage_costs.md))* | Users who prefer Object Storage without server maintenance |
| **WebRTC Peer-to-Peer**<br>*(Direct device-to-device)* | ✅ Full *(while connected)* | ❌ Both devices must be online | ⚠️ Limited by OS background tasks | None (free public signalling relay) | Free (no server required) | Users who prefer no central storage server |

> [!NOTE]
> **How Object Storage request counts affect costs**:
> Unlike traditional file-synchronisation tools that scan every single file on each sync (generating thousands of `LIST` or `HEAD` operations), LiveSync uses **Journal Sync**. It packages only recent changes into compressed delta journals.
> **Routine checks do not inspect each Vault file**. Whether your Vault contains 100 or 50,000 files, the journal listing step of an idle check uses one LIST request. Synchronisation also checks the bucket and reads or updates synchronisation parameters and device records. Metadata and Chunks travel together in journal packages, so initial and incremental transfer counts depend on those packages. See [Object Storage transfers, request scaling, and service costs](docs/setup_object_storage_costs.md) for a calculation example covering journal listing and transfers, with control requests identified separately.[^r2-pricing]

The figures above are calculation examples. Prices and free allowances may change. Check the linked official pricing pages and recalculate costs for your chosen configuration before deploying.

[^fly-pricing]: November 2026 ([Fly.io resource pricing](https://docs.fly.io/about/pricing)); one `shared-cpu-1x` Machine with 256 MB RAM and a 1 GB persistent volume in Ashburn (`iad`), running continuously for 30 days. Outbound data transfer and optional resources are additional.
[^r2-pricing]: November 2026 ([Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)); Standard storage. Free allowances apply to the account's combined usage.
[^private-https]: A private HTTPS endpoint accessible only to your devices can be provided by services such as [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). See the [Docker stack](docker/README.md#profile-details) for setup options.

<a id="prepare-your-chosen-backend"></a>

### 2. Prepare your chosen backend

Follow the setup guide for your selected method:

- **CouchDB**:
  - **Self-hosted**: deploy using the [Docker stack](docker/README.md) or follow [Your own server](docs/setup_own_server.md).
  - **Fly.io**: follow [Setup CouchDB on Fly.io](docs/setup_flyio.md) for a scripted cloud deployment.
  - **IBM Cloudant**: follow [IBM Cloudant setup](docs/setup_cloudant.md) for managed CouchDB hosting.
- **Object Storage**:
  - Follow [Object Storage Setup](docs/setup_object_storage.md) using Cloudflare R2, Amazon S3, or a self-hosted MinIO bucket.
- **Peer-to-Peer**:
  - Follow [Peer-to-Peer Setup](docs/setup_p2p.md) after reviewing the [P2P communication model](docs/p2p.md). No server provisioning is required when using the public signalling relay.

<a id="3-minute-setup---couchdb-on-flyio"></a>

For the Fly.io video walkthrough, see [automated setup](docs/setup_flyio.md#a-very-automated-setup).

If you would like to test WebRTC connectivity between your devices before setting up P2P, try the experimental [WebPeer browser utility](https://vrtmrz.github.io/obsidian-livesync/webpeer/) ([documentation](src/apps/webpeer/README.md)).

<a id="start-synchronising"></a>

### 3. Connect your devices and verify synchronisation

Regardless of your chosen backend, connecting your devices follows four straightforward steps:

1. **Prepare your backend** using the guide selected in Step 2 (not required for P2P with the public relay).
2. **Set up your first device**: install Self-hosted LiveSync and configure your connection and encryption using the appropriate guide:
   - For CouchDB: follow [Quick Setup](docs/quick_setup.md) to initialise the local and remote databases from your Vault.
   - For Object Storage: follow [Object Storage Setup](docs/setup_object_storage.md) to initialise the local database and upload its journals to your bucket.
   - For Peer-to-Peer: follow [Peer-to-Peer Setup](docs/setup_p2p.md) to initialise the local LiveSync database. P2P has no central remote database.
3. **Connect additional devices using a Setup URI**: on your working first device, run `Copy settings as a new Setup URI` from the command palette. Open that encrypted URI on your second device so it receives the identical encryption and connection profiles.
4. **Verify two-way synchronisation**: create a test note on your first device and confirm that it appears on the second. Then edit the note on the second device and confirm that the change reflects back on the first device. Configure optional features (such as customisation or hidden-file sync) only after this verification succeeds.

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
