# [IN DESIGN] Tiered Chunk Storage with Live Compaction

** VERY IMPORTANT NOTE: This design must be used with the new journal synchronisation method. Otherwise, we risk introducing the bloat of changes from hot-pack into the Bucket. (CouchDB/PouchDB can synchronise only the most recent changes, or resolve conflicts.) Previous Journal Sync **IS NOT**. Please proceed with caution. **

## Goal

To establish a highly efficient, robust, and scalable synchronisation architecture by introducing a tiered storage system inspired by Log-Structured Merge-Trees (LSM-Trees). This design aims to address the challenges of real-time synchronisation, specifically the massive generation of transient data, while minimising storage bloat and ensuring high performance.

## Motivation

Our previous designs, including "Chunk Aggregation by Prefix", successfully addressed the "document explosion" problem. However, the introduction of real-time editor synchronisation exposed a new, critical challenge: the constant generation of short-lived "garbage" chunks during user input. This "garbage storm" places immense pressure on storage, I/O, and the Garbage Collection (GC) process.

A simple aggregation strategy is insufficient because it treats all data equally, mixing valuable, stable chunks with transient, garbage chunks in permanent storage. This leads to storage bloat and inefficient compaction. We require a system that can intelligently distinguish between "hot" (volatile) and "cold" (stable) data, processing them in the most efficient manner possible.

## Outlined Methods and Implementation Plans

### Abstract

This design implements a two-tiered storage system within CouchDB.
1.  **Level 0 – Hot Storage:** A set of "Hot-Packs", one for each active client. These act as fast, append-only logs for all newly created chunks. They serve as a temporary staging area, absorbing the "garbage storm" of real-time editing.
2.  **Level 1 – Cold Storage:** The permanent, immutable storage for stable chunks, consisting of **Index Documents** for fast lookups and **Data Documents (Cold-Packs)** for storing chunk data.

A background "Compaction" process continuously promotes stable chunks from Hot Storage to Cold Storage, while automatically discarding garbage. This keeps the permanent storage clean and highly optimised.

### Detailed Implementation

**1. Document Structure:**

-   **Hot-Pack Document (Level 0):** A per-client, append-only log.
  -   `_id`: `hotpack:{client_id}` (`client_id` could be the same as the `deviceNodeID` used in the `accepted_nodes` in MILESTONE_DOC; enables database 'lockout' for safe synchronisation)
  -   Content: A log of chunk creation events.
    ```json
    {
      "_id": "hotpack:a9f1b12...",
      "_rev": "...",
      "log": [
      { "hash": "abc...", "data": "...", "ts": ..., "file_id": "file1" },
      { "hash": "def...", "data": "...", "ts": ..., "file_id": "file2" }
      ]
    }
    ```

-   **Index Document (Level 1):** A fast, prefix-based lookup table for stable chunks.
  -   `_id`: `idx:{prefix}` (e.g., `idx:a9f1b`)
  -   Content: Maps a chunk hash to the ID of the Cold-Pack it resides in.
    ```json
    {
      "_id": "idx:a9f1b",
      "chunks": { "a9f1b12...": "dat:1678886400" }
    }
    ```

-   **Cold-Pack Document (Level 1):** An immutable data block created by the compaction process.
  -   `_id`: `dat:{timestamp_or_uuid}` (e.g., `dat:1678886400123`)
  -   Content: A collection of stable chunks.
    ```json
    {
      "_id": "dat:1678886400123",
      "chunks": { "a9f1b12...": "...", "c3d4e5f...": "..." }
    }
    ```

-   **Hot-Pack List Document:** A central registry of all active Hot-Packs. This might be a computed document that clients maintain in memory on startup.
  -   `_id`: `hotpack_list`
  -   Content: `{"active_clients": ["hotpack:a9f1b12...", "hotpack:c3d4e5f..."]}`

**2. Write/Save Operation Flow (Real-time Editing):**

1.  A client generates a new chunk.
2.  It **immediately appends** the chunk object (`{hash, data, ts, file_id}`) to its **own** Hot-Pack document's `log` array within its local PouchDB. This operation is extremely fast.
3.  The PouchDB synchronisation process replicates this change to the remote CouchDB and other clients in the background. No other Hot-Packs are consulted during this write operation.

**3. Read/Load Operation Flow:**

To find a chunk's data:
1.  The client first consults its in-memory list of active Hot-Pack IDs (see section 5).
2.  It searches for the chunk hash in all **Hot-Pack documents**, starting from its own, then others. It reads them in reverse log order (newest first).
3.  If not found, it consults the appropriate **Index Document (`idx:...`)** to get the ID of the Cold-Pack.
4.  It then reads the chunk data from the corresponding **Cold-Pack document (`dat:...`)**.

**4. Compaction & Promotion Process (The "GC"):**

This is a background task run periodically by clients, or triggered when the number of unprocessed log entries exceeds a threshold (to maintain the ability to synchronise with the remote database, which has a limited document size).
1.  The client takes its own Hot-Pack (`hotpack:{client_id}`) and scans its `log` array from the beginning (oldest first).
2.  For each chunk in the log, it checks if the chunk is still referenced in the latest revision of any file.
  -   **If not referenced (Garbage):** The log entry is simply discarded.
  -   **If referenced (Stable):** The chunk is added to a "promotion batch".
3.  After scanning a certain number of log entries, the client takes the "promotion batch".
4.  It creates one or more new, immutable **Cold-Pack (`dat:...`)** documents to store the chunk data from the batch.
5.  It updates the corresponding **Index (`idx:...`)** documents to point to the new Cold-Pack(s).
6.  Once the promotion is successfully saved to the database, it **removes the processed entries from its Hot-Pack's `log` array**. This is a critical step to prevent reprocessing and keep the Hot-Pack small.

**5. Hot-Pack List Management:**

To know which Hot-Packs to read, clients will:
1.  On startup, load the `hotpack_list` document into memory.
2.  Use PouchDB's live `changes` feed to monitor the creation of new `hotpack:*` documents.
3.  Upon detecting an unknown Hot-Pack, the client updates its in-memory list and attempts to update the central `hotpack_list` document (on a best-effort basis, with conflict resolution).

## Planned Test Strategy

1.  **Unit Tests:** Test the Compaction/Promotion logic extensively. Ensure garbage is correctly identified and stable chunks are promoted correctly.
2.  **Integration Tests:** Simulate a multi-client real-time editing session.
  -   Verify that writes are fast and responsive.
  -   Confirm that transient garbage chunks do not pollute the Cold Storage.
  -   Confirm that after a period of inactivity, compaction runs and the Hot-Packs shrink.
3.  **Stress Tests:** Simulate many clients joining and leaving to test the robustness of the `hotpack_list` management.

## Documentation Strategy

-   This design document will serve as the core architectural reference.
-   The roles of each document type (Hot-Pack, Index, Cold-Pack, List) will be clearly explained for future developers.
-   The logic of the Compaction/Promotion process will be detailed.

## Consideration and Conclusion

This tiered storage design is a direct evolution, born from the lessons of previous architectures. It embraces the ephemeral nature of data in real-time applications. By creating a "staging area" (Hot-Packs) for volatile data, it protects the integrity and performance of the permanent "cold" storage. The Compaction process acts as a self-cleaning mechanism, ensuring that only valuable, stable data is retained long-term. This is not just an optimisation; it is a fundamental shift that enables robust, high-performance, and scalable real-time synchronisation on top of CouchDB.