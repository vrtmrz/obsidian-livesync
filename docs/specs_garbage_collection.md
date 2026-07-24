# Garbage Collection V3

Garbage Collection V3 is a beta maintenance operation for CouchDB remotes. It removes chunk documents which are no longer required by the current local revision tree, propagates those logical deletions to CouchDB, and then requests remote compaction.

It is not a repair operation. Use it only when the Vault, the local LiveSync database, and the CouchDB remote are healthy, every relevant device has synchronised, and recoverable backups exist.

## Supported scope

Garbage Collection V3 is available in Edge Case mode for CouchDB. It is not offered for Object Storage or P2P:

- Object Storage has a different journal and object lifecycle.
- P2P has no central database to compact and cannot provide the accepted-device progress information required by this workflow.

The operation requires **Fetch chunks on demand** to be off so that its local reachability result is not confused with chunks which exist only on the remote.

## Workflow

After the user starts Garbage Collection V3, LiveSync:

1. completes a one-shot bidirectional CouchDB synchronisation;
2. reads the accepted-device list and current progress recorded on the remote;
3. warns when an accepted device has no current information or device progress differs, then requires explicit confirmation;
4. computes the chunks reachable from the local PouchDB revision tree;
5. creates a logical deletion for each locally present chunk which is not reachable;
6. completes a push-only replication so that those deletions reach CouchDB;
7. requests CouchDB compaction and waits for it for up to two minutes; and
8. clears the local chunk caches.

If the initial synchronisation, device inspection, or confirmation fails, the workflow stops before collection. If push-only replication fails, the local logical deletions have already been created, but remote compaction is not started; synchronise again before retrying or using another device. A compaction failure is reported separately.

## Reachability rules

A chunk remains reachable when it is referenced by any of the following:

- the current database winner for a file;
- any other live conflict revision for that file;
- an available revision on either side of a live conflict which is required to describe the divergence; or
- the nearest available revision shared by both live conflict branches.

Chunk identifiers are content-derived and shared between files. Reachability is therefore collected into one set across the database. A chunk used by two or more current files remains protected even when one file is updated or deleted.

An ordinary superseded linear revision does not protect its former chunks. Once no current file or live conflict branch references a chunk, it can be collected. After a conflict is resolved, chunks unique to the discarded branch and to no-longer-needed merge ancestry can also become eligible.

## Consequences

Garbage Collection deliberately trades historical recoverability for storage. A metadata revision may remain in the revision tree after a chunk which only that superseded revision used has been collected, so that historical body can become unreadable. Remote compaction can then discard old CouchDB revision bodies. Tombstones and retained metadata also consume storage, so the operation does not promise the smallest possible database.

Writing the same bytes again produces the same content-derived chunk identifier. If that chunk was collected previously, the normal chunk-writing path creates a new live revision for it, and ordinary replication can transfer it again. This does not recover an older file revision automatically; it only makes the newly written content available.

Garbage Collection does not reconstruct a chunk which is already missing, determine whether an unreadable revision is important, or repair a damaged local database. Use **Verify and repair all files**, another healthy replica, or a backup for those cases. Use **Overwrite Server Data with This Device's Files** only when a chosen Vault is authoritative and a deliberate remote rebuild is required.

## Verification

Commonlib tests use real in-memory PouchDB revision trees to verify:

- collection eligibility after a normal file update;
- protection of chunks shared by multiple current files;
- protection of all live conflict branches and their nearest available shared ancestor;
- eligibility of losing-branch and ancestor-only chunks after conflict resolution;
- propagation of chunk deletion to another PouchDB database; and
- recreation and propagation when the same content is written again.

Self-hosted LiveSync tests verify that Garbage Collection V3 uses Commonlib's revision-aware result, deletes only unreachable chunks, performs the initial bidirectional and final push-only replications in order, and requests remote compaction. CouchDB's own compaction implementation remains an external database boundary.
