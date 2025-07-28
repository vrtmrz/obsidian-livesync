# [IN DESIGN] Tiered Chunk Storage for Bucket Sync

## Goal

To evolve the "Journal Sync" mechanism by integrating the Tiered Storage architecture. This design aims to drastically reduce the size and number of sync packs, minimise storage consumption on the backend bucket, and establish a clear, efficient process for Garbage Collection, all while remaining protocol-agnostic.

## Motivation

The original "Journal Sync" liberates us from CouchDB's protocol, but it still packages and transfers entire document changes, including bulky and often transient chunk data. In a real-time or frequent-editing scenario, this results in:
1.  **Bloated Sync Packs:** Packs become large with redundant or short-lived chunk data, increasing upload and download times.
2.  **Inefficient Storage:** The backend bucket stores numerous packs containing overlapping and obsolete chunk data, wasting space.
3.  **Impractical Garbage Collection:** Identifying and purging obsolete *chunk data* from within the pack-based journal history is extremely difficult.

This new design addresses these problems by fundamentally changing *what* is synchronised in the journal packs. We will synchronise lightweight metadata and logs, while handling bulk data separately.

## Outlined methods and implementation plans

### Abstract

This design adapts the Tiered Storage model for a bucket-based backend. The backend bucket is partitioned into distinct areas for different data types. The "Journal Sync" process is now responsible for synchronising only the "hot" volatile data and lightweight metadata. A separate, asynchronous "Compaction" process, which can be run by any client, is responsible for migrating stable data into permanent, deduplicated "cold" storage.

### Detailed Implementation

**1. Bucket Structure:**

The backend bucket will have four distinct logical areas (prefixes):
-   `packs/`: For "Journal Sync" packs, containing the journal of metadata and Hot-Log changes.
-   `hot_logs/`: A dedicated area for each client's "Hot-Log," containing newly created, volatile chunks.
-   `indices/`: For prefix-based Index files, mapping chunk hashes to their permanent location in Cold Storage.
-   `cold_chunks/`: For deduplicated, stable chunk data, stored by content hash.

**2. Data Structures (Client-side PouchDB & Backend Bucket):**

-   **Client Metadata:** Standard file metadata documents, kept in the client's PouchDB.
-   **Hot-Log (in `hot_logs/`):** A per-client, append-only log file on the bucket.
    -   Path: `hot_logs/{client_id}.jsonlog`
    -   Content: A sequence of JSON objects, one per line, representing chunk creation events. `{"hash": "...", "data": "...", "ts": ..., "file_id": "..."}`

-   **Index File (in `indices/`):** A JSON file for a given hash prefix.
    -   Path: `indices/{prefix}.json`
    -   Content: Maps a chunk hash to its content hash (which is its key in `cold_chunks/`). `{"hash_abc...": true, "hash_def...": true}`

-   **Cold Chunk (in `cold_chunks/`):** The raw, immutable, deduplicated chunk data.
    -   Path: `cold_chunks/{chunk_hash}`

**3. "Journal Sync" - Send/Receive Operation (Not Live):**

This process is now extremely lightweight.
1.  **Send:**
    a. The client takes all newly generated chunks and **appends them to its own Hot-Log file (`hot_logs/{client_id}.jsonlog`)** on the bucket.
    b. The client updates its local file metadata in PouchDB.
    c. It then creates a "Journal Sync" pack containing **only the PouchDB journal of the file metadata changes.** This pack is very small as it contains no chunk data.
    d. The pack is uploaded to `packs/`.

2.  **Receive:**
    a. The client downloads new packs from `packs/` and applies the metadata journal to its local PouchDB.
    b. It downloads the latest versions of all **other clients' Hot-Log files** from `hot_logs/`.
    c. Now the client has a complete, up-to-date view of all metadata and all "hot" chunks.

**4. Read/Load Operation Flow:**

To find a chunk's data:
1.  The client searches for the chunk hash in its local copy of all **Hot-Logs**.
2.  If not found, it downloads and consults the appropriate **Index file (`indices/{prefix}.json`)**.
3.  If the index confirms existence, it downloads the data from **`cold_chunks/{chunk_hash}`**.

**5. Compaction & Promotion Process (Asynchronous "GC"):**

This is a deliberate, offline-capable process that any client can choose to run.
1.  The client "leases" its own Hot-Log for compaction.
2.  It reads its entire `hot_logs/{client_id}.jsonlog`.
3.  For each chunk in the log, it checks if the chunk is referenced in the *current, latest state* of the file metadata.
    -   **If not referenced (Garbage):** The log entry is discarded.
    -   **If referenced (Stable):** The chunk is added to a "promotion batch."
4.  For each chunk in the promotion batch:
    a. It checks the corresponding `indices/{prefix}.json` to see if the chunk already exists in Cold Storage.
    b. If it does not exist, it **uploads the chunk data to `cold_chunks/{chunk_hash}`** and updates the `indices/{prefix}.json` file.
5.  Once the entire Hot-Log has been processed, the client **deletes its `hot_logs/{client_id}.jsonlog` file** (or truncates it to empty), effectively completing the cycle.

## Test strategy

1.  **Component Tests:** Test the Compaction process independently. Ensure it correctly identifies stable versus garbage chunks and populates the `cold_chunks/` and `indices/` areas correctly.
2.  **Integration Tests:**
    -   Simulate a multi-client sync cycle. Verify that sync packs in `packs/` are small.
    -   Confirm that `hot_logs/` are correctly created and updated.
    -   Run the Compaction process and verify that data migrates correctly to cold storage and the hot log is cleared.
3.  **Conflict Tests:** Simulate two clients trying to compact the same index file simultaneously and ensure the outcome is consistent (for example, via a locking mechanism or last-write-wins).

## Documentation strategy

-   This design document will be the primary reference for the bucket-based architecture.
-   The structure of the backend bucket (`packs/`, `hot_logs/`, etc.) will be clearly defined.
-   A detailed description of how to run the Compaction process will be provided to users.

## Consideration and Conclusion

By applying the Tiered Storage model to "Journal Sync", we transform it into a remarkably efficient system. The synchronisation of everyday changes becomes extremely fast and lightweight, as only metadata journals are exchanged. The heavy lifting of data deduplication and permanent storage is offloaded to a separate, asynchronous Compaction process. This clear separation of concerns makes the system highly scalable, minimises storage costs, and finally provides a practical, robust solution for Garbage Collection in a protocol-agnostic, bucket-based environment.