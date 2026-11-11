---
date: 2026-11-10
commonlib-version: "0.4.1"
self-hosted-livesync-version: "1.0.47"
status: reference
---

# File writing and database-to-Vault reflection

## Scope and baseline

This implementation reference maps ordinary file events, incoming replication,
full scans, Simple Fetch, and Inspector actions in the Obsidian host. It records
Self-hosted LiveSync `517f5c248fdd777acb657f6d70de3913ba6390aa` with the exact
Commonlib 0.4.1 registry package selected by its lockfile. It describes current
behaviour of that published baseline; it introduces no new recovery guarantee.
The [accepted deletion recovery design](database_to_vault_deletion_recovery.md)
records the additional opt-in policy in the unreleased implementation candidate.

Hidden File Sync and Customisation Sync retain their owning contracts. Document
History restoration has a separate [restoration contract](document_history_revision_restoration.md).
CLI and browser hosts share Commonlib operations, but their lifecycle and storage
adapters require separate verification.

Commonlib owns file handling, per-document locking, provenance, and scanner
policy. This repository owns Obsidian composition, received-result processing,
Fetch choices, and confirmation dialogues. Use the linked owner contracts rather
than copying their complete action matrices into this reference.

## Directions and responsibilities

A local file event records a change which has already happened in the Vault.
Its handler updates Metadata and Chunks in the local database. A queued
`DELETE` therefore requests a database change, not a physical file deletion.

Incoming replication first changes the local database. Result processing then
requests database-to-Vault reflection. Receiving a database revision does not
establish that its file effect completed. Full scans reconcile current database
and storage observations independently of the received-result queue.

`ServiceFileHandlerBase` remains Commonlib's public facade. Its responsibility
functions separate saving, deletion, renaming, reflection, protection,
provenance, selection, and locking. Public operations acquire document locks;
internal operations reuse the lock already held. Final storage revalidation and
the destructive operation remain together in reflection. See the
[Commonlib implementation map](https://github.com/vrtmrz/livesync-commonlib/blob/0.4.1/docs/development.md#ordinary-file-handler-implementation).

## Entry points and protection

The following rows describe selected ordinary files under the owning target,
identity, size, conflict, and suspension policies.

| Entry | Operation | Protection and important policy differences |
| --- | --- | --- |
| Vault watcher, restored event, or same-session local retry | `StorageEventManager` dispatches ordinary or reconciled file events to the file handler. | Saves retain the displayed branch or preserve unknown content independently. Deletion and rename revalidate current storage and source ownership. They update the database. |
| Incoming replicated Metadata | `ReplicateResultProcessor` calls `processSynchroniseResult`; Commonlib enters `dbToStorageCore` through its replicated-event handler. | Reflection is non-forced. With `writeDocumentsIfConflicted` disabled, current content and provenance protect unsynchronised edits; a changed winning revision is re-read before deletion. |
| `NEWER_WINS`, existing live database entry and Vault file | `syncFileBetweenDBandStorage` compares freshness. Its database-newer branch calls `dbToStorage(..., false)`. | The non-forced reflection checks still apply. Equal-time reconciliation follows its separate content/provenance contract. `strictContentCheckOnStartup` only affects an eligible equal-time optimisation. |
| Scanner `update-storage`, including `DB_APPLY` live entries and database-only creation | `updateToStorage` calls `dbToStorage(path, null, true)`. | This is a forced operation selected by scanner policy. Deleted entries are skipped by this helper. It cannot implement guarded deletion merely by changing the pair action. |
| Simple Fetch with an explicit deletion choice | The selected `DB_APPLY` or `NEWER_WINS` options can choose `delete-local`. | `delete-local` calls `storageAccess.delete(path, true)` directly. It does not enter the file handler's content/provenance protection. The choice belongs to this explicit recovery workflow. |
| Inspector: apply a readable revision or logical deletion | `dbToStorageWithSpecificRev(path, revision, true)` after the relevant confirmation. | The selected revision must still be a current leaf. Explicit force permits the selected branch to replace/remove the Vault file; it does not mean that the selected branch is the winner. |

`force: false` alone is not an unconditional preservation guarantee:
`writeDocumentsIfConflicted` bypasses conflict deferral and incoming-content
protection in the reviewed handler. Recovery design must account for that
setting explicitly. A new automatic path must not inherit forced behaviour just
because another caller uses the same facade.

In this Obsidian host, both adapter `delete` and `trash` delegate to
`FileManager.trashFile`, following Obsidian's deletion preferences. A direct
scanner delete bypasses provenance checks; it does not by itself prove permanent
erasure. The legacy `trashInsteadDelete` value is not a substitute for checking
which operation the caller invokes.

## Completion, retained work, and restart

| Owner | What completion establishes | Failure and later processing |
| --- | --- | --- |
| Local file-event manager | Admission is distinct from handler completion. A failed attempt remains associated with its pending operation until the owning completion/snapshot step succeeds. | Existing finite flushes and related later events can retry eligible ordinary failures. Start-up restores stored event intents and reconciles current state before collecting scan pairs. See the [local retry ADR](../adr/2026_11_local_file_operation_retry.md). |
| Received-result processor | Queue counters show queued/running application work. Its handler Boolean can also represent conflict deferral, protected local content, or an accepted no-op. | `parseDocumentChange` removes an item in `finally`, including after reflection returns false or throws. A later snapshot can therefore contain no failed item. Persisted queued/running items can be restored, but this is not a durable ledger of failed reflection. |
| Full scanner | Each selected pair is `completed`, `skipped`, or `failed`. A policy skip is a successful scan outcome without proving Vault/database equality. | A later scan re-evaluates current pairs. Ordinary Obsidian start-up can return `completed-with-file-failures`; explicit Fetch remains strict. A failed path must not acquire a successful database reflection timestamp in the last-seen map. |
| Simple Fetch | Database reconstruction and subsequent Vault reflection are separate stages. | A failed scan offers the workflow's retry/release decision. Re-entering Fetch can repeat database reconstruction; it is more work than retrying one retained local pair. |
| Inspector mutation | The action attempts the exact selected live revision and refreshes inspection through its owning UI workflow. | It is an explicit action, not a background retry registration. A failed action must be assessed from its result and refreshed state. |

A true file-handler result does not universally mean that the Vault now matches
the database winner. In particular, preserving a local edit as a conflict and
queuing conflict review can return true. Conversely, failed or inconclusive
reflection is not proof that a deletion was intentionally rejected.

Local database persistence, provenance persistence, snapshot acknowledgement,
remote replication, and physical Vault reflection are separate boundaries.
They do not form a cross-store transaction.

## Current deletion recovery gap

For a valid, retained logical-deletion Metadata document and an existing Vault
file, ordinary `NEWER_WINS` without extra options selects `both-db-deleted` and
`skip`. It does not reach freshness comparison or content protection. This is
an explicit conservative entry in the
[Commonlib action matrix](https://github.com/vrtmrz/livesync-commonlib/blob/0.4.1/docs/offline-scanner.md#action-matrix).

Consequently, after incoming reflection fails and its item leaves the received
queue, restarting need not apply the deletion. A log which says the path remains
eligible for a later scan does not establish deletion recovery. This path is
consistent with [issue #1338](https://github.com/vrtmrz/obsidian-livesync/issues/1338);
it does not identify the cause of the original iPhone reflection failure.

Snapshot recovery remains useful when pending work was saved. The processor also
accepts an explicitly requeued copy of the current latest revision; its revision
check rejects known older ancestors, not every revision already in the database.
Changing reflection-filter settings has its own stored-document requeue path,
but ordinary restart and a failed application do not trigger that full requeue.

Deletion retention is a separate limitation. Before pair collection, enabled
`automaticallyDeleteMetadataOfDeletedFiles` can tombstone expired logical
Metadata. A remaining file can then become `storage-only`; the logical-deletion
pair rule no longer applies. Likewise, already-tombstoned entries which are
absent from normal document enumeration need a different discovery source.

## Runtime access costs

Count operations at their owning boundary. A Vault index lookup or `getStub`
call is not necessarily a physical filesystem read. A database body fetch can
read several Chunks or use cached data. A content hash still requires reading
the file bytes. Cache hits, remote Chunk requests, and physical I/O must be
measured separately.

The existing scanner already collects selected Vault files and normal Metadata,
validates document identity, and constructs pairs. Recognising an additional
`both-db-deleted` action can reuse those observations. It does not require
another Vault listing or body reads for every otherwise unaffected file.

Existing non-forced deletion reflection reads current content and can re-read
it for snapshot validation before deletion. Valid saved content evidence can
avoid reconstructing an old revision body; it does not avoid reading the current
Vault file. Real edits or unknown provenance can cause database writes to retain
content. These costs differ from a forced scanner delete, which bypasses that
protection.

The last-seen map and the received/event snapshots also have costs. The scanner
coalesces last-seen persistence and serialises it; a scheduled write serialises
the map, not just one changed path. Adding a new per-file journal, second full
scan, or whole-queue snapshot on every retry is therefore a separate cost decision.

This reference records source-level access paths, not a latency or memory
benchmark. The
[deletion recovery proposal](database_to_vault_deletion_recovery.md)
compares work limited to candidate pairs with other recovery approaches and states the
measurement still required before implementation is accepted.

## Source and contract map

| Responsibility | Maintained reference or implementation |
| --- | --- |
| Obsidian start-up scan options | [ModuleLiveSyncMain](../../src/modules/main/ModuleLiveSyncMain.ts) |
| Received-result admission, application, and snapshots | [ReplicateResultProcessor](../../src/serviceFeatures/replication/ReplicateResultProcessor.ts), [composition](../../src/serviceFeatures/replication/index.ts), and [filter requeue](../../src/serviceFeatures/replication/automaticTriggers.ts) |
| Simple Fetch mode and deletion choices | [redFlag.simpleFetch](../../src/serviceFeatures/redFlag.simpleFetch.ts) |
| Exact-revision Inspector actions | [PaneHatch](../../src/modules/features/SettingDialogue/PaneHatch.ts) and [action policy](../../src/serviceFeatures/fileRepairPresentation.ts) |
| Ordinary events and shared reflection | [Commonlib event/reflection contract](https://github.com/vrtmrz/livesync-commonlib/blob/0.4.1/docs/storage-events-and-reflection.md) |
| Scanner pair policies and result meanings | [Commonlib offline scanner](https://github.com/vrtmrz/livesync-commonlib/blob/0.4.1/docs/offline-scanner.md) |
| Revision identity and content preservation | [Conflict and provenance contract](../specs_conflict_resolution.md) |
| Accepted local operation completion and retries | [Save completion ADR](../adr/2026_10_local_file_save_completion_and_batching.md) and [retry ADR](../adr/2026_11_local_file_operation_retry.md) |
