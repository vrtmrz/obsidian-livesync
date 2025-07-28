# [WITHDRAWN] Chunk Aggregation by Prefix 

## Goal

To address the "document explosion" and storage bloat issues caused by the current chunking mechanism, while preserving the benefits of content-addressable storage and efficient delta synchronisation. This design aims to significantly reduce the number of documents in the database and simplify Garbage Collection (GC).

## Motivation

Our current synchronisation solution splits files into content-defined chunks, with each chunk stored as a separate document in CouchDB, identified by its hash. This architecture effectively leverages CouchDB's replication for automatic deduplication and efficient transfer.

However, this approach faces significant challenges as the number of files and edits increases:
1.  **Document Explosion:** A large vault can generate millions of chunk documents, severely degrading CouchDB's performance, particularly during view building and replication.
2.  **Storage Bloat & GC Difficulty:** Obsolete chunks generated during edits are difficult to identify and remove. Since CouchDB's deletion (`_deleted: true`) is a soft delete, and compaction is a heavy, space-intensive operation, unused chunks perpetually consume storage, making GC impractical for many users.
3.  **The "Eden" Problem:** A previous attempt, "Keep newborn chunks in Eden", aimed to mitigate this by embedding volatile chunks within the parent document. While it reduced the number of standalone chunks, it introduced a new issue: the parent document's history (`_revs_info`) became excessively large, causing its own form of database bloat and making compaction equally necessary but difficult to manage.

This new design addresses the root cause—the sheer number of documents—by aggregating chunks into sets.

## Prerequisites

- The new implementation must maintain the core benefit of deduplication to ensure efficient synchronisation.
- The solution must not introduce a single point of bottleneck and should handle concurrent writes from multiple clients gracefully.
- The system must provide a clear and feasible strategy for Garbage Collection.
- The design should be forward-compatible, allowing for a smooth migration path for existing users.

## Outlined Methods and Implementation Plans

### Abstract

This design introduces a two-tiered document structure to manage chunks: **Index Documents** and **Data Documents**. Chunks are no longer stored as individual documents. Instead, they are grouped into `Data Documents` based on a common hash prefix. The existence and location of each chunk are tracked by `Index Documents`, which are also grouped by the same prefix. This approach dramatically reduces the total document count.

### Detailed Implementation

**1. Document Structure:**

-   **Index Document:** Maps chunk hashes to their corresponding Data Document ID. Identified by a prefix of the chunk hash.
    -   `_id`: `idx:{prefix}` (e.g., `idx:a9f1b`)
    -   Content:
        ```json
        {
            "_id": "idx:a9f1b",
            "_rev": "...",
            "chunks": {
                "a9f1b12...": "dat:a9f1b-001",
                "a9f1b34...": "dat:a9f1b-001",
                "a9f1b56...": "dat:a9f1b-002"
            }
        }
        ```
-   **Data Document:** Contains the actual chunk data as base64-encoded strings. Identified by a prefix and a sequential number.
    -   `_id`: `dat:{prefix}-{sequence}` (e.g., `dat:a9f1b-001`)
    -   Content:
        ```json
        {
            "_id": "dat:a9f1b-001",
            "_rev": "...",
            "chunks": {
                "a9f1b12...": "...", // base64 data
                "a9f1b34...": "..."  // base64 data
            }
        }
        ```

**2. Configuration:**

-   `chunk_prefix_length`: The number of characters from the start of a chunk hash to use as a prefix (e.g., `5`). This determines the granularity of aggregation.
-   `data_doc_size_limit`: The maximum size for a single Data Document to prevent it from becoming too large (e.g., 1MB). When this limit is reached, a new Data Document with an incremented sequence number is created.

**3. Write/Save Operation Flow:**

When a client creates new chunks:
1.  For each new chunk, determine its hash prefix.
2.  Read the corresponding `Index Document` (e.g., `idx:a9f1b`).
3.  From the index, determine which of the new chunks already exist in the database.
4.  For the **truly new chunks only**:
    a. Read the last `Data Document` for that prefix (e.g., `dat:a9f1b-005`).
    b. If it is nearing its size limit, create a new one (`dat:a9f1b-006`).
    c. Add the new chunk data to the Data Document and save it.
5.  Update the `Index Document` with the locations of the newly added chunks.

**4. Handling Write Conflicts:**

Concurrent writes to the same `Index Document` or `Data Document` from multiple clients will cause conflicts (409 Conflict). This is expected and must be handled gracefully. Since additions are incremental, the client application must implement a **retry-and-merge loop**:
1.  Attempt to save the document.
2.  On a conflict, re-fetch the latest version of the document from the server.
3.  Merge its own changes into the latest version.
4.  Attempt to save again.
5.  Repeat until successful or a retry limit is reached.

**5. Garbage Collection (GC):**

GC becomes a manageable, periodic batch process:
1.  Scan all file metadata documents to build a master set of all *currently referenced* chunk hashes.
2.  Iterate through all `Index Documents`. For each chunk listed:
    a. If the chunk hash is not in the master reference set, it is garbage.
    b. Remove the garbage entry from the `Index Document`.
    c. Remove the corresponding data from its `Data Document`.
3.  If a `Data Document` becomes empty after this process, it can be deleted.

## Test Strategy

1.  **Unit Tests:** Implement tests for the conflict resolution logic (retry-and-merge loop) to ensure robustness.
2.  **Integration Tests:**
    -   Verify that concurrent writes from multiple simulated clients result in a consistent, merged state without data loss.
    -   Run a full synchronisation scenario and confirm the resulting database has a significantly lower document count compared to the previous implementation.
3.  **GC Test:** Simulate a scenario where files are deleted, run the GC process, and verify that orphaned chunks are correctly removed from both Index and Data documents, and that storage is reclaimed after compaction.
4.  **Migration Test:** Develop and test a "rebuild" process for existing users, which migrates their chunk data into the new aggregated structure.

## Documentation Strategy

-   This design document will be published to explain the new architecture.
-   The configuration options (`chunk_prefix_length`, etc.) will be documented for advanced users.
-   A guide for the migration/rebuild process will be provided.

## Future Work

The separation of index and data opens up a powerful possibility. While this design initially implements both within CouchDB, the `Data Documents` could be offloaded to a dedicated object storage service such as **S3, MinIO, or Cloudflare R2**.

In such a hybrid model, CouchDB would handle only the lightweight `Index Documents` and file metadata, serving as a high-speed synchronisation and coordination layer. The bulky chunk data would reside in a more cost-effective and scalable blob store. This would represent the ultimate evolution of this architecture, combining the best of both worlds.

## Consideration and Conclusion

This design directly addresses the scalability limitations of the original chunk-per-document model. By aggregating chunks into sets, it significantly reduces the document count, which in turn improves database performance and makes maintenance feasible. The explicit handling of write conflicts and a clear strategy for garbage collection make this a robust and sustainable long-term solution. It effectively resolves the problems identified in previous approaches, including the "Eden" experiment, by tackling the root cause of database bloat. This architecture provides a solid foundation for future growth and scalability.