# Object Storage transfers, request scaling, and service costs

This guide explains how Self-hosted LiveSync transfers data when using S3-compatible Object Storage, why API requests do not scale with the total number of files in your Vault, and how to estimate monthly costs before selecting a storage provider.

For setting up the plug-in with an existing bucket, see [Object Storage Setup](setup_object_storage.md).

---

## How Journal Sync transfers data

Self-hosted LiveSync stores file properties in [Metadata](glossary.md#user-facing-and-operational-terms) and file contents in Chunks. When synchronising with Object Storage, it does not manage files as individual remote objects. Instead, it packages database changes into compressed, time-stamped **journals** using the [Journal Replicator](design_docs_of_journalsync_2nd.md) architecture.

### Why API requests do not scale with Vault file count

Traditional file-synchronisation tools often inspect every file in the remote storage to detect changes, issuing `LIST` or `HEAD` operations proportional to the total number of files in the Vault. In that model, a Vault with 10,000 files generates thousands of requests on every synchronisation cycle, quickly exhausting free allowances and incurring substantial API fees.

Self-hosted LiveSync works fundamentally differently:

- **Incremental journal tracking**: Each device tracks its synchronisation progress using sequence markers.
- **Single listing check**: To check for incoming changes, a device performs a single `ListObjectsV2` operation to inspect new journal packages created since its last recorded sequence.
- **Delta transfer**: Only newly created journal packages and newly generated Chunks are uploaded (`PutObject`) or downloaded (`GetObject`). Unmodified files require zero API requests.

Consequently, **whether your Vault contains 100 notes or 50,000 notes, an idle synchronisation check uses exactly one listing request**. The number of API requests depends on your synchronisation schedule and edit activity, not on your Vault's overall file count.

---

## Mapping activities to S3-compatible API operations

| Activity | Primary S3 API operation | Provider pricing category | What affects the request count |
| --- | --- | --- | --- |
| **Check for changes** | `ListObjectsV2` | Class A / Write-equivalent | Frequency of periodic sync checks and event triggers across active devices. |
| **Send changes** | `PutObject` | Class A / Write | Number of journal packs and new Chunks produced by local edits. |
| **Receive changes** | `GetObject` | Class B / Read | Number of missing journal packs and Chunks downloaded from other devices. |
| **Device & settings sync** | `GetObject`, `PutObject` | Class A & Class B | Reading or updating remote configuration and device participation records. |
| **First-device initialisation** | `ListObjectsV2`, `PutObject` | Class A / Write | Uploading the initial Vault data and setting files. |

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

### Realistic scenario

Suppose you use two devices (for example, a desktop and a laptop):
- Both devices run Obsidian for 8 hours per day.
- Periodic synchronisation is set to the default of once every **5 minutes** (12 checks per hour).
- You create or edit approximately 50 notes per day.

```text
Routine listing checks:
2 devices × 8 hours/day × 12 checks/hour × 30 days = 5,760 LIST requests/month

Upload and download transfers (estimated):
50 edits/day × 30 days × ~2–3 transfer requests = ~3,000–4,500 GET/PUT requests/month

Total monthly request volume: ~9,000–10,500 requests
```

---

## Initial upload and first-time device download

While day-to-day incremental synchronisation produces very few requests, initial setup and adding subsequent devices require a one-off transfer of all existing Vault data:

1. **Initial Vault upload (first device)**:
   - When the first device initialises the remote bucket, it splits all files into Metadata documents and content Chunks.
   - Each Chunk and initial journal package is uploaded via `PutObject`. For a Vault containing 3,000 files, this typically generates several thousand `PutObject` operations (Class A).
2. **Initial Vault download (adding a second device)**:
   - When another device joins and fetches the Vault for the first time, it downloads all existing Chunks and Metadata from the bucket.
   - This results in a temporary burst of `GetObject` operations (Class B) and internet data egress proportional to your Vault's total data size.

### Financial impact of initial transfers

Even during this initial population phase, costs remain negligible under standard pricing models:

- **Class B operations (`GetObject`) are exceptionally inexpensive**: Amazon S3 charges approximately USD 0.0004 per 1,000 GET requests (downloading 5,000 chunks costs approximately USD 0.002). Cloudflare R2 includes 10,000,000 free Class B operations every month.
- **Egress bandwidth**: Cloudflare R2 charges zero egress fees. Amazon S3 includes 100 GB of free outbound internet data transfer per month under the AWS Free Tier.
- **One-off activity**: This transfer burst occurs only once per newly connected device. Subsequent synchronisations immediately return to the minimal incremental pattern calculated above.

---

## Comparing provider allowances and costs

The rates below reflect published pricing as of late 2026. Please verify current rates on the provider's pricing page before opening an account.

| Provider | Included free allowances | Paid rates beyond allowance | Practical outcome for typical use |
| --- | --- | --- | --- |
| **[Cloudflare R2](https://developers.cloudflare.com/r2/pricing/)** (Standard) | • **1,000,000 Class A** (LIST, PUT) / mo<br>• **10,000,000 Class B** (GET) / mo<br>• **10 GB storage** / mo<br>• **Zero egress fees** | • Class A: USD 4.50 / million<br>• Class B: USD 0.36 / million<br>• Storage: USD 0.015 / GB-month | **USD 0.00 / month (Free)**.<br>The scenario above consumes less than 1% of the monthly free Class A allowance. |
| **[Amazon S3](https://aws.amazon.com/s3/pricing/)** (Standard) | • Free tier for first 12 months (2,000 PUT/LIST, 20,000 GET, 5 GB storage) | • PUT/LIST: ~USD 0.005 / 1,000<br>• GET: ~USD 0.0004 / 1,000<br>• Storage: ~USD 0.023 / GB-month<br>• Standard internet egress applies | **Under USD 0.10 / month** after the free tier expires. |
| **[Backblaze B2](https://www.backblaze.com/cloud-storage/pricing)** | • 10 GB free storage<br>• 2,500 Class A calls / day free | • Calls: USD 0.005 / 10,000<br>• Storage: USD 0.006 / GB-month | **Under USD 0.10 / month**. |

### Practical recommendations

- **Cloudflare R2 is generally recommended** for individual users seeking a zero-maintenance, zero-cost cloud backend, as its generous free tier and free egress ensure typical Vaults incur no charges.
- **Avoid excessively short polling intervals** (such as polling every 10–15 seconds) unless necessary. A 1–5 minute interval provides timely synchronisation while preserving low request counts.
- **Batch saves and event triggers**: Enabling 'On Events' (sync on save or startup) allows you to lengthen the periodic interval without delaying synchronisation when active edits occur.
