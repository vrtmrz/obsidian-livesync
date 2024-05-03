# Keep newborn chunks in Eden.

NOTE: This is the planned feature design document. This is planned, but not be implemented now (v0.23.3). This has not reached the design freeze and will be added to from time to time.

## Goal

Reduce the number of chunks which in volatile, and reduce the usage of storage of the remote database in middle or long term.

## Motivation

- In the current implementation, Self-hosted LiveSync splits documents into metadata and multiple chunks. In particular, chunks are split so that they do not exceed a certain length.
    - This is to optimise the transfer and take advantage of the properties of CouchDB. This also complies with the restriction of IBM Cloudant on the size of a single document.
- However, creating chunks halfway through each editing operation increases the number of unnecessary chunks.
    - Chunks are shared by several documents. For this reason, it is not clear whether these chunks are needed or not unless all revisions of all documents are checked. This makes it difficult to remove unnecessary data.
    - On the other hand, chunks are done in units that can be neatly divided as markdown to ensure relatively accurate de-duplication, even if they are created simultaneously on multiple terminals. Therefore, it is unlikely that the data in the editing process will be reused.
        - For this reason, we have made features such as Batch save available, but they are not a fundamental solution.
        - As a result, there is a large amount of data that cannot be erased and is probably unused. Therefore, `Fetch chunks on demand` is currently performed for optimal communication.
    - If the generation of unnecessary chunks is sufficiently reduced, this function will become unnecessary.
- The problem is that this unnecessary chunking slows down both local and remote operations.

## Prerequisite
- The implementation must be able to control the size of the document appropriately so that it does not become non-transferable (1).
-  The implementation must be such that data corruption can be avoided even if forward compatibility is not maintained; due to the nature of Self-hosted LiveSync, backward version connexions are expected.
- Viewed as a feature:
    - This feature should be disabled for migration users.
    - This feature should be enabled for new users and after rebuilds of migrated users.
        - Therefore, back into the implementation view, Ideally, the implementation should be such that data recovery can be achieved by immediately upgrading after replication.

## Outlined methods and implementation plans
### Abstract
To store and transfer only stable chunks independently and share them from multiple documents after stabilisation, new chunks, i.e. chunks that are considered non-stable, are modified to be stored in the document and transferred with the document. In this case, care should be taken not to exceed prerequisite (1).

If this is achieved, the non-leaf document will not be transferred, and even if it is, the chunk will be stored in the document, so that the size can be reduced by the compaction.

Details are given below.

1. The document will henceforth have the property eden.
    ```typescript
    // Paritally Type
    type EntryWithEden = {
        eden: {
            [key: DocumentID]: {
                data: string,
                epoch: number, // The document revision which this chunk has been born.
            }
        }
    }
    ```
2. The following configuration items are added:
   Note: These configurations should be shared as `Tweaks value` between each client.
    - useEden : boolean
    - Max chunks in eden : number
    - Max Total chunk lengths in eden: number
    - Max age while in eden: number
3. In the document saving operation, chunks are added to Eden within each document, having the revision number of the existing document. And if some chunks in eden are not used in the operating revision, they would be removed.
   Then after being so chosen, a few chunks are also chosen to be graduated as an independent `chunk` in following rules, and they would be left the eden:
    - Those that have already been confirmed to exist as independent chunks.
        - This confirmation of existence may ideally be determined by a fast first-order determination, e.g. by a Bloom filter.
    - Those whose length exceeds the configured maximum length.
    - Those have aged over the configured value, since epoch at the operating revision.
    - Those whose total length, when added up when they are arranged in reverse order of the revision in which they were generated, is after the point at which they exceed the max length in the configuration. Or, those after the configured maximum items.
4. In the document loading operation, chunks are firstly read from these eden.
5. In End-to-End Encryption, property `eden` of documents will also be encrypted.

### Note
- When this feature has been enabled, forward compatibility is temporarily lost. However, it is detected as missing chunks, and this data is not reflected in the storage in the old version. Therefore, no data loss will occur.

## Test strategy

1. Confirm that synchronisation with the previous version is possible with this feature disabled.
2. With this feature enabled, connect from the previous version and confirm that errors are detected in the previous version but the files are not corrupted.
3. Ensure that the two versions with this feature enabled can withstand normal use.

## Documentation strategy

- This document is published, and will be referred from the release note.
- Indeed, we lack a fulfilled configuration table. Efforts will be made and, if they can be produced, this document will then be referenced. But not required while in the experimental or beta feature.
    - However, this might be an essential feature. Further efforts are desired.

### Consideration and Conclusion
To be described after implemented, tested, and, released.