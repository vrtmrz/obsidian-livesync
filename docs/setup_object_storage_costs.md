# Object Storage transfers, request scaling, and service costs

This guide explains how Self-hosted LiveSync transfers data when using S3-compatible Object Storage, why API requests do not scale with the total number of files in your Vault, and how to calculate example costs from request counts before selecting a storage provider.

For setting up the plug-in with an existing bucket, see [Object Storage Setup](setup_object_storage.md).

---

## How Journal Sync transfers data

Self-hosted LiveSync stores file properties in [Metadata](glossary.md#user-facing-and-operational-terms) and file contents in Chunks. When synchronising with Object Storage, it does not manage files as individual remote objects. Instead, it packages database changes into compressed, time-stamped **journals** using the [Journal Replicator](design_docs_of_journalsync_2nd.md) architecture.

### Why API requests do not scale with Vault file count

Traditional file-synchronisation tools often inspect every file in the remote storage to detect changes, issuing `LIST` or `HEAD` operations proportional to the total number of files in the Vault. In that model, a Vault with 10,000 files generates thousands of requests on every synchronisation cycle, quickly exhausting free allowances and incurring substantial API fees.

Self-hosted LiveSync works fundamentally differently:

- **Incremental journal tracking**: Each device tracks its synchronisation progress using sequence markers.
- **Journal listing**: The journal listing step uses `ListObjectsV2` to inspect journal packages after the last received journal.
- **Journal transfer**: Metadata and Chunks are packed together in journals. Each new journal package is uploaded with `PutObject`, and each missing package is downloaded with `GetObject`; individual Chunks are not separate remote objects.
- **Control requests**: Synchronisation also checks bucket availability (`HeadBucket`), reads synchronisation parameters and device participation data (`GetObject`), and can update device participation data (`PutObject`), even when no Vault files have changed.

Consequently, **whether your Vault contains 100 notes or 50,000 notes, the journal listing step of an idle check uses one LIST request**. The full request count also includes control requests, journal transfers, and any retries. Routine checks do not need a separate request for each unchanged Vault file.

---

## Mapping activities to S3-compatible API operations

| Activity | Primary S3 API operation | Provider pricing category | What affects the request count |
| --- | --- | --- | --- |
| **Check for changes** | `ListObjectsV2` | Class A / Write-equivalent | Frequency of periodic sync checks and event triggers across active devices. |
| **Send changes** | `PutObject` | Class A / Write | Number of journal packages uploaded, each containing Metadata and/or Chunks. |
| **Receive changes** | `GetObject` | Class B / Read | Number of journal packages downloaded from other devices. |
| **Connection, compatibility, and device checks** | `HeadBucket`, `GetObject`, `PutObject` | Provider-specific read/write categories | Bucket availability checks and reads or updates of synchronisation parameters and device participation records, including during idle cycles. |
| **First-device initialisation** | `ListObjectsV2`, `PutObject` | Class A / Write | Listing and uploading journal packages containing the initial Metadata and Chunks, in addition to control requests. |

> [!NOTE]
> In most S3-compatible pricing models (including Amazon S3 and Cloudflare R2), `ListObjectsV2` is classified as a write-equivalent (Class A) operation, even though it reads metadata. Keeping periodic synchronisation intervals reasonable is the most effective way to manage request volume.

---

## Estimating monthly request volume

To estimate your monthly request volume, consider three factors:
1. **Number of active devices**: Devices running Obsidian concurrently.
2. **Synchronisation interval**: The periodic polling interval configured in settings.
3. **Daily editing volume**: Number of modifications and new notes created per day.

### Calculation formula for routine checks

$$\text{Monthly listing requests} = \text{Devices} \times \text{Hours active/day} \times \left(\frac{60}{\text{Interval in minutes}}\right) \times 30\text{ days}$$

### Worked example

This example counts journal listing, uploads, and downloads. Bucket checks, synchronisation parameters, device participation records, and retries add further requests and are excluded from this subtotal.

Suppose you use two devices (for example, a desktop and a laptop):

- Both devices run Obsidian for 8 hours per day.
- Periodic synchronisation is set to once every **5 minutes** (12 checks per hour).
- For the journal transfer calculation, assume a combined 50 PUT requests and 100 GET requests per day across both devices. These are illustrative request counts; actual transfers depend on edit activity and journal packing.

```text
Routine listing checks:
2 devices × 8 hours/day × 12 checks/hour × 30 days = 5,760 LIST requests/month

Uploads:   50 PUT requests/day × 30 days = 1,500 PUT requests/month
Downloads: 100 GET requests/day × 30 days = 3,000 GET requests/month

Counted journal requests: 7,260 LIST/PUT and 3,000 GET requests/month
```

At the paid Amazon S3 Standard rates for US East (N. Virginia) below:[^s3-pricing]

```text
LIST: 5,760 ÷ 1,000 × USD 0.005  = USD 0.0288
PUT:  1,500 ÷ 1,000 × USD 0.005  = USD 0.0075
GET:  3,000 ÷ 1,000 × USD 0.0004 = USD 0.0012

Journal request subtotal in this example: USD 0.0375/month (about USD 0.04)
```

Add control requests, retries, storage, and data transfer when estimating the full cost. On Cloudflare R2 Standard, the counted journal requests fit the monthly free allowances if the account's other usage leaves enough allowance available.[^r2-pricing]

---

## Initial upload and first-time device download

Initial setup transfers journal packages containing the existing Metadata and Chunks. A joining device downloads the existing packages which it has not yet processed:

1. **Initial Vault upload (first device)**:
   - The first device splits files into Metadata documents and content Chunks, then groups those records into compressed journal packages.
   - Each package is uploaded with one `PutObject` request. The number of requests depends on journal packing and the size of the records, rather than a one-to-one mapping to Vault files or Chunks.
2. **Initial Vault download (adding a second device)**:
   - The joining device downloads journal packages with `GetObject` and applies the Metadata and Chunks they contain to its local database.
   - The GET request count follows the number of downloaded packages; outbound data transfer depends on their total size. Control requests and retries add further operations.

### Financial impact of initial transfers

Calculate initial request charges from the number of API operations:

- **GET requests**: At the paid Amazon S3 rate used below, 5,000 GET requests cost USD 0.002, excluding storage and data transfer.[^s3-pricing] Cloudflare R2 Standard includes 10,000,000 free Class B operations every month.[^r2-pricing]
- **Egress bandwidth**: Cloudflare R2 charges zero egress fees.[^r2-pricing] For paid Amazon S3 usage, calculate outbound data transfer separately using the current rates for your region.[^s3-pricing]
- **Later synchronisation**: Once caught up, the device checks for new journal packages and downloads those it has not yet processed.

---

## Comparing provider allowances and costs

The table applies published rates checked in November 2026 to the journal requests counted in the worked example above. Prices and free allowances may change. Before choosing a provider or configuring synchronisation, check the linked official pricing pages and recalculate costs for your region, storage usage, request volume, and data transfer.

| Provider | Included monthly free allowances | Paid rates | Calculated journal request subtotal |
| --- | --- | --- | --- |
| **Cloudflare R2 Standard**[^r2-pricing] | • **1,000,000 Class A** (LIST, PUT)<br>• **10,000,000 Class B** (GET)<br>• **10 GB-month storage**<br>• **Zero egress fees** | • Class A: USD 4.50 / million<br>• Class B: USD 0.36 / million<br>• Storage: USD 0.015 / GB-month | **USD 0.00 for the counted journal requests**, assuming sufficient free allowance remains. The calculation uses 7,260 Class A and 3,000 Class B operations. |
| **Amazon S3 Standard (paid usage)**<br>US East (N. Virginia)[^s3-pricing] | — | • PUT/LIST: USD 0.005 / 1,000<br>• GET: USD 0.0004 / 1,000<br>• Storage: USD 0.023 / GB-month (first 50 TB)<br>• Internet data transfer charged separately | **About USD 0.04** for the counted journal requests. Other requests, storage, and data transfer are additional. |

### Practical recommendations

- **Cloudflare R2 may suit individual users** seeking a backend without server maintenance. The counted journal requests fit its monthly free allowances; include control requests, storage, and other account usage when comparing with the published limits.[^r2-pricing]
- **Avoid excessively short polling intervals** (such as polling every 10–15 seconds) unless necessary. A 1–5 minute interval provides timely synchronisation while preserving low request counts.
- **Batch saves and event triggers**: Enabling 'On Events' (sync on save or startup) allows you to lengthen the periodic interval without delaying synchronisation when active edits occur.

[^r2-pricing]: November 2026 ([Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)); Standard storage.
[^s3-pricing]: November 2026 ([Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)); S3 Standard paid usage in US East (N. Virginia).
