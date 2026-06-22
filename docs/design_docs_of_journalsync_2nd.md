## The design document of the Journal Replicator 2nd Edition

### Goal
- Build a robust and memory-efficient replication foundation that decouples the physical storage layer by leveraging the Web Streams API.
- Maintain strict compliance with the data consistency and replication protocols of CouchDB/PouchDB.
- Support "Connection Strings" to easily extend compatibility to various object storages (e.g. S3, MinIO).

### Motivation
- The original Journal Replicator used a custom queue mechanism called `Trench` to manage backpressure, which had limitations regarding memory efficiency when dealing with a massive number of files.
- The storage operation logic was tightly coupled with `JournalSyncAbstract`, making it difficult to swap out the physical storage layer (e.g., S3, WebDAV).
- The transfer of revision trees (`_revisions`) conforming to PouchDB's replication protocol was implicitly managed. There was a need for a stricter, more deterministic application of document histories.

### Methods and implementations

#### Pipeline Construction using Web Streams API
We replaced `Trench` with standard Web Streams APIs (`ReadableStream`, `TransformStream`, `WritableStream`) to build the sending and receiving pipelines.
- **Sending Pipeline**: Reads documents from the PouchDB changes stream, passes them through a compression `TransformStream`, and pipes them to an upload `WritableStream`. This enables automatic backpressure, keeping memory consumption stable even during large-scale synchronization.
- **Receiving Pipeline**: Processes storage file listing, downloading/decompression, and bulk application to PouchDB in a streamlined manner.

#### Decoupling the Physical Layer via IJournalStorage
To detach the storage operations from the core synchronization logic (`JournalSyncCore`), we introduced the `IJournalStorage` interface.
When adding new backend storages in the future (e.g., R2, WebDAV), developers only need to add an Adapter that implements this interface, without modifying the core replicator.

#### Strict Application of PouchDB Replication Protocols
To synchronize precisely according to the CouchDB/PouchDB protocol, the following steps were optimized:
1. **Transferring History**: Using `bulkGet({ revs: true })`, the replicator transfers not only the latest revision of a document but its entire history tree (`_revisions`) alongside the deletion flag (`_deleted`).
2. **Applying History**: On the receiving end, the replicator uses `revsDiff` to identify which incoming revisions are missing locally. It then applies them using `bulkDocs(saveDocs, { new_edits: false })`.
By specifying `new_edits: false`, PouchDB integrates the received history exactly as it is without treating them as new local edits. This prevents unexpected conflicts and redundant branching of the revision tree.

#### Connection String Support
To seamlessly connect to various physical storages, we introduced Connection Strings (e.g., `s3://accessKey:secretKey@endpoint/bucket/prefix?region=auto`).
The connection string acts as a user-friendly configuration. Each Storage Adapter exposes an `isCompatible` and `parseConnectionString` method to verify if it can handle the connection string, and if so, dynamic configuration overrides are applied to establish the connection.

### Performance and Speed Characteristics

By migrating from the previous `Trench` architecture to the Web Streams API and strict PouchDB protocol compliance, the replication speed characteristics have changed in the following ways:

1. **Consistent Throughput via Backpressure**:
   The `Trench` mechanism occasionally loaded too many items into memory or stalled during massive transfers. The Web Streams API applies automatic backpressure across the pipeline (Read `changes` -> Compress -> Upload). While peak burst speeds might appear slightly smoothed out, the **sustained throughput is far more stable**, preventing out-of-memory crashes on mobile devices and keeping network utilization optimal.

2. **Faster Receive-Side Application (`new_edits: false`)**:
   In the previous version, incoming documents were sometimes evaluated as new local edits. By utilizing PouchDB's `bulkDocs({ new_edits: false })` alongside the proper `_revisions` tree, we bypass unnecessary conflict generation and local revision hashing. This drastically **speeds up the document insertion process** on the receiving end.

3. **Optimized Network Traffic**:
   Because conflicts are resolved deterministically and revision trees are replicated exactly as they exist, the system avoids generating "echoes" (redundant syncs triggered by a device misunderstanding a history tree). This reduces unnecessary background traffic significantly.

### Consideration and Conclusion
The Journal Replicator 2nd Edition achieves robust and scalable storage synchronization through enhanced memory efficiency (via Web Streams), decoupled extensibility (via IJournalStorage), and strict protocol compliance (via `new_edits: false`).
Moving forward, this foundation will make it much easier to officially support a wider variety of backend storages.
