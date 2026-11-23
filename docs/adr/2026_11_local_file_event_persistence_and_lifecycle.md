---
date: 2026-11-23
commonlib-version: "0.7.0"
self-hosted-livesync-version: "1.0.52"
status: proposed
---

# Architectural Decision Record: Local File Event Persistence, Batching, Recovery, and Lifecycle

## Status

Proposed on 2026-11-23. Investigated baseline: Self-hosted LiveSync `1.0.52` with
`@vrtmrz/livesync-commonlib` `0.7.0`.

This decision consolidates and updates the local file-event contracts formerly
recorded across two earlier decisions:

- [Local File Save Completion and Batching](2026_10_local_file_save_completion_and_batching.md)
  (accepted 2026-10-25; baseline Commonlib `0.2.0` / Self-hosted LiveSync `1.0.40`;
  published in Commonlib `0.2.2` / Self-hosted LiveSync `1.0.42`)
- [Retry Failed Local File Operations](2026_11_local_file_operation_retry.md)
  (accepted 2026-11-08; baseline Commonlib `0.4.0` / Self-hosted LiveSync `1.0.46`;
  published in Commonlib `0.4.1` / Self-hosted LiveSync `1.0.47`)

Once accepted and implemented, this document becomes the single maintained
architectural reference for local file-event admission, snapshot persistence,
batching, same-session retry, start-up reconciliation, and unload lifecycle.
The two earlier ADRs remain historical records with their original decision
dates, reviewed-version baselines, and publication notes preserved; their entry
points will link here when this proposal is accepted.

## Evolution from Earlier Decisions

### Summary of the journey

1. **October 2026 — Recoverable local completion and opt-in LiveSync batching
   ([#1207](https://github.com/vrtmrz/obsidian-livesync/issues/1207)):**
   Restart testing exposed a recovery gap where `StorageEventManager` removed an
   event from its buffer or waiting map before database processing completed,
   while `waitForIdle()` waited only for batch timers rather than handler
   completion. The October decision made local operations recoverable from
   admission through completion, gave `waitForIdle()` and
   `commitPendingFileEvents()` a finite completion boundary, defined typed
   optional-provider completion (`processOptionalFileEventWithResult`),
   preserved strict content and revision-provenance reconciliation with an
   explicit start-up opt-out (`strictContentCheckOnStartup`), and introduced
   opt-in `batchSaveInLiveSync` (default `false`). To keep the initial scope
   bounded, it reused the existing single-key array snapshot format and deferred
   format changes and `CREATE`-plus-`CHANGED` coalescing to later work.
2. **November 2026 — Finite same-session retries and responsibility split
   ([#1331](https://github.com/vrtmrz/obsidian-livesync/issues/1331)):**
   Atomic temporary-file saves could fail with `ENOENT`, leaving a permanently
   settled failure in the running manager that blocked subsequent flushes and
   same-path edits until restart. The November decision retained failed ordinary
   operations (`CREATE`, `CHANGED`, `DELETE`, and `RENAME`) and allowed existing
   finite triggers (`commitPendingFileEvents()` and related later events) to
   start one bounded retry attempt using transient `ReconcileFileEvent`
   revalidation against current storage, database state, and provenance. It
   recorded the A/B/C/D preservation matrix and split `StorageEventManager` and
   `ServiceFileHandlerBase` into responsibility modules, while retaining a
   one-to-one serial `snapshotTail` chain and `stopWatching() -> waitForIdle()`.
3. **November 2026 (this decision) — Bounded persistence cost, non-stalling
   restoration, and truthful unload retirement
   ([#1380](https://github.com/vrtmrz/obsidian-livesync/issues/1380)):**
   Field profiling on an affected desktop Vault with a 7,453-entry
   `storage-event-manager-snapshot` demonstrated that the October and November
   persistence and shutdown implementations break down under large backlogs.
   This decision preserves every verified data-preservation contract from both
   earlier ADRs while replacing the uncoalesced whole-array snapshot loop,
   unbounded restore dispatch, editor-change payload duplication, and
   blocking-queue unload behaviour.

### What changes relative to the October and November ADRs

| Area | Earlier decision or assumption | Problem exposed by #1380 and code audit | New contract in this ADR |
|---|---|---|---|
| Snapshot storage format | October ADR §2 retained the single-key full-array format (`storage-event-manager-snapshot`) and deferred format changes. | Synchronous `IDBObjectStore.put` structured-cloning of 7,453 entries blocked the Obsidian renderer for ~1.23 s per write ($O(N)$ per mutation). | Add an optional incremental persistence adapter contract (`IStorageEventIncrementalPersistenceAdapter`) with atomic per-entry IndexedDB transactions and crash-safe staged migration, while retaining full-array fallback for other adapters. |
| Serial snapshot writer | November ADR kept one-to-one `snapshotTail` writes per request and mutated `entry.completed` before save. | Restored and burst events queued thousands of redundant full saves ahead of `completeSnapshot()`, starving queue reduction; pre-commit `entry.completed = true` also leaked a temporary false negative to `hasPendingFileEvent()`. | Use detached immutable commit batches with generation-based coalescing, writer-local provisional completions, settled per-attempt admission persistence, and zero redundant writes for already-durable restored state. |
| Restoration and dispatch | Restored events were dispatched in an unbounded loop and `restoreState()` was callable again during a live manual scan (`performFullScan()`). | 7,453 concurrent attempts piled up ahead of `Semaphore(5)`, and a live manual scan calling `restoreState()` could replace the buffer or falsely certify unpersisted live work. | Make `restoreState()` exclusive single-flight initialisation per selected store and manager ownership period, and enforce a non-deadlocking bounded dispatch rule where waits never hold producer capacity. |
| Editor timing hints and payload | October ADR §5 required reading current bytes at execution time and stated `args.cache` is not a historical file version, but `watchEditorChange` kept enqueueing new `FileEventItem`s with full note text in `args.cache`. | With `batchSave: true`, repeated typing accumulated duplicate entries carrying full note text in `pendingSnapshot` and triggered redundant snapshot writes. | Treat `watchEditorChange` as a timing-only reschedule on the current eligible waiting gate, and omit `args.cache` and transient restore flags from persisted snapshot records. |
| Orderly unload (`stopWatching()`) | October ADR §3 allowed either draining or preserving pending records, but the implementation called `waitForIdle()` unconditionally; `databaseConnectionRecovery` also resumed paused dispatch at `onBeforeUnload` priority `-100`. | Hot-disabling this plug-in hung inside `onBeforeUnload`, prevented `KeyValueDB` and local database closure, left `IDBObjectStore.put` running until restart, and risked old-manager interference on immediate hot re-enable. | Standardise `stopWatching()` on **preserve-and-stop** with a synchronous terminal unload fence, drain only operations that crossed handler start through terminal acknowledgement, abort in-progress restore and scanner flows, and fence same-store ownership across hot re-enable. |
| Host adapter error semantics | Earlier ADRs assumed adapter resolution implied committed persistence. | Both CLI (`CLIStorageEventManagerAdapter`) and WebApp (`FSAPIStorageEventManagerAdapter`) caught and swallowed save/read errors, and WebApp resolved on `request.onsuccess` instead of transaction completion. | Require every persistence adapter to reject failed reads and writes, distinguish absent from unreadable state, and resolve IndexedDB writes only after `transaction.oncomplete`. |

## Context

[Issue #1380](https://github.com/vrtmrz/obsidian-livesync/issues/1380) reported
repeated ~1.2-second renderer stalls in an existing Obsidian desktop Vault
(Obsidian 1.15.1, Self-hosted LiveSync 1.0.51, Commonlib 0.6.0, macOS Apple M1
Max; `liveSync=false`, `batchSave=true`, `batchSaveMinimumDelay=5`,
`batchSaveMaximumDelay=60`, `syncOnFileOpen=true`, `syncOnSave=true`,
`syncOnStart=true`):

- Twelve trusted inputs per condition showed cursor placement latencies of
  8.5 / 1,149.6 ms (median / maximum) and tab switching latencies of
  848.1 / 879.1 ms while enabled, versus 9.8 / 18.1 ms and 21.4 / 25.5 ms after
  disabling and restarting Obsidian.
- Hot-disabling this plug-in removed its registry entry, yet latencies remained
  9.4 / 1,135.6 ms and 851.4 / 898.1 ms and the expensive `put` stack continued
  until Obsidian restarted. The enabled lifecycle reported `ready=false`.
- Bounded IndexedDB instrumentation recorded seven consecutive writes to
  `storage-event-manager-snapshot`, each an Array of **7,453 entries**, taking
  **1,177.7–1,260.9 ms (median 1,231.7 ms)** synchronously inside native
  `IDBObjectStore.put`, with request success following 0.1–18.5 ms later.
- Rebuilding the local index from remote (which destroys the device-local
  key-value database) resolved the lag immediately.

Direct comparison of the published Commonlib `0.6.0` installation against the
SHA-512-verified Commonlib `0.7.0` tarball pinned in Self-hosted LiveSync
`1.0.52` confirms that the `StorageEventManager`, `offlineScanner`,
`ServiceFileAccessBase`, and `ControlService` modules are identical across both
versions (apart from the optional `INTERNAL` target-selection hook).

Code inspection establishes the following causal chain:

1. During start-up (`prepareDatabaseForUse` -> `scanVault` -> `performFullScan`),
   `restoreState()` runs before `appLifecycle.markIsReady()`. Because replay
   stalls, `ready` remains `false`.
2. `restoreStorageEvents()` places all loaded entries into `buffer` with
   `skipBatchWait: true` and calls `dispatchBufferedEvents()`, which shifts
   every item before the first `TYPE_SENTINEL_FLUSH` and starts all of them
   concurrently via `fireAndForget(processFileEvent(event))`.
3. Every `processStorageEventAttempt()` calls `await effects.takeSnapshot()`
   **before** acquiring `Semaphore(5)`, chaining up to 7,453 uncoalesced full
   writes onto `state.snapshotTail`. The first few completed handlers append
   `completeSnapshot()` to the tail behind thousands of redundant
   pre-execution writes, starving queue reduction so all observed writes retain
   7,453 entries.
4. `ObsidianPersistenceAdapter.saveSnapshot()` passes the entire array to
   `IDBKeyValueDatabase.set()` -> `db.put()`, paying the full $O(N)$
   synchronous Structured Clone cost on the renderer main thread on every write.
5. `ObsidianLiveSyncPlugin.onunload()` triggers `ControlService._onLiveSyncUnload()`,
   which awaits `appLifecycle.onBeforeUnload()` before `onUnload()` (where
   `KeyValueDBService.closeKeyValueDB()` is registered at priority `100`) and
   `closeDatabase()`. `ServiceFileAccessBase` awaits `stopWatching()` ->
   `waitForIdle()` inside `onBeforeUnload()`, hanging behind the stalled queue.
   Meanwhile `databaseConnectionRecovery` runs at `onBeforeUnload` priority
   `-100` and calls `resumeDispatch()` before `stopWatching()` even runs.
6. Unmeasured unknowns remain explicitly separate from confirmed code causes:
   how the reporter's original 7,453-entry backlog formed, whether `args.cache`
   was present inside those 7,453 entries, and the exact single-read latency of
   loading a 7,453-entry legacy snapshot during first-time migration.

## Decision

Retain all proven local preservation, ordering, reconciliation, and finite-retry
guarantees from the October and November decisions, and replace the persistence,
scheduling, editor-hint, and unload mechanisms with the unified contracts below.

### 1. Completion Boundaries and Ownership

Distinguish five separate boundaries; none implies a later one:

| Boundary | Meaning |
|---|---|
| Intent committed | The accepted operation intent is durably stored in the device-local event store. Handler execution cannot begin before this boundary succeeds. |
| Batch wait released | Intentional batching delay has ended and the operation is eligible to run. Local database state can still predate the Vault edit. |
| Local effect and provenance established | The intended change is represented in the local database (with its required Chunks and best-effort provenance), or current state proves it is already represented or safely covered by policy. |
| Acknowledgement committed | The completed operation's removal from the device-local event store has durably committed. Only after this commit can the operation leave in-memory `pendingSnapshot`. |
| Replication completed | A finite replication reports its own outcome. Local completion does not prove remote receipt or reflection on another device. |

The event manager owns each accepted operation from queue admission through
acknowledgement commit. Buffered, waiting, executing, and failed operations all
remain pending. Only the exact owning operation and current attempt can
acknowledge completion; finishing an older operation must never remove a newer
operation for the same path.

#### Optional file providers

Hidden File Sync and Customisation Sync continue to use the typed
`processOptionalFileEventWithResult` chain (`firstHandled` returning
`HandlerOutcome<void, string>`):

- `not-applicable` advances to the next provider (completing as a
  policy-approved skip when none applies).
- `completed` stops dispatch and commits acknowledgement after the provider's
  real save or verified no-op.
- `veto` and thrown/rejected errors retain the operation pending.
- A finite flush resolves `whenFlushRequested` to release captured customisation
  delays without letting later groups extend the captured boundary.
- During start-up replay and unload/settings flushes, providers rely on physical
  database readiness rather than application readiness or resume events.
- Hosts without typed providers retain the narrower legacy
  `processOptionalFileEvent` notification contract; snapshot persistence
  failures remain visible under both contracts.

### 2. Coalesced Snapshot Persistence, Visibility, and Adapter Durability

#### Immutable detached commit batches

`persistFileEventSnapshot` preserves its serialised commit tail and initial
microtask start, while coalescing concurrent durability and completion requests:

1. **Detached planning boundary:** Before starting persistence I/O, the writer
   detaches the current `pendingBatch` (`completions[]`, `waiters[]`,
   `requiredMutationVersion`), freezes the exact mutations and `coveredGeneration`
   for that commit, and routes every mutation or request arriving during I/O
   into the **next** batch.
2. **Monotonic durability watermark:** Track `snapshotMutationVersion`,
   `persistedMutationVersion`, and `hasPersisted` per store lifetime. On
   commit success, advance `persistedMutationVersion` only to the detached
   batch's frozen `coveredGeneration` — never to the live
   `snapshotMutationVersion` that may already include newer arrivals.
3. **Writer-local provisional completion (fixing pending-guard visibility):**
   Do not mutate `entry.completed = true` on shared state before the persistence
   commit succeeds. Keep provisional completions and sentinel acknowledgements
   local to the active writer step so `hasPendingFileEvent()` and status
   observers never see a false 'no pending event' window during an uncommitted
   or failing write. Apply removals to `state.pendingSnapshot` only after the
   commit resolves.
4. **Failure isolation and rollback:**
   - Evaluate stale ownership and admission failures per completion item so one
     stale or admission-rejected item settles only its own caller without
     poisoning unrelated completions in the same batch.
   - Tie completion removal to the attempt's **settled admission-persistence
     outcome** (kept separate from the subsequent `runQueuedEvents()` promise,
     which can itself wait on processing). A started handler must drain before
     any replacement retry attempt begins.
   - If the persistence commit rejects, leave `state.pendingSnapshot`,
     `persistedMutationVersion`, and the committed-ID baseline unchanged (all
     uncommitted upserts and removals remain dirty), and reject every waiter
     whose durability depended on that failed commit.
5. **No-op skip:** When a detached batch has zero valid provisional completions,
   zero newly acknowledgeable sentinels, and
   `hasPersisted && persistedMutationVersion >= batch.requiredMutationVersion`,
   resolve its waiters without performing storage I/O.

#### Persisted payload hygiene and O(1) bookkeeping

- Persisted snapshot records capture operation intent only. Serialise a clean
  copy omitting `args.cache` and transient restore markers
  (`restoredFromPreviousRuntime`, `skipBatchWait`) while keeping in-memory
  event object identity untouched. Preserve `args.ctx` carefully because its
  type is `unknown` and custom hosts may supply serialisable context.
- Retain coalesced predecessors in durable storage until their covering
  successor commits completion. Dropping a predecessor merely upon successor
  admission would alter failed-successor replay and retry semantics; any future
  durable subsumption requires its own crash and failed-successor proof.
- Maintain O(1) pending-count bookkeeping for `updateStatus()` and incremental
  dirty tracking so high-frequency status updates and delta planning do not
  re-traverse thousands of `pendingSnapshot` entries on the renderer thread.

#### Mandatory adapter durability contract

Every persistence adapter (Obsidian, CLI, WebApp, and custom hosts) MUST:

- **Reject on write failure:** Never catch, log, and resolve a failed write.
- **Distinguish absence from read failure:** Return `null` only when no
  snapshot exists; reject on corrupt, permission-denied, or unreadable storage.
- **Resolve on commit completion:** IndexedDB adapters MUST resolve only after
  `transaction.oncomplete` (never merely `request.onsuccess`), and MUST
  explicitly abort an open transaction if constructing a subsequent request
  throws synchronously (for example, a structured-clone error).

### 3. Exclusive Store-Scoped Restoration and Non-Deadlocking Dispatch

#### Single-flight restoration per store ownership period

`restoreState()` is reachable not only at boot-up, but also from manual Vault
scans (`performFullScan()`) while a manager is already running. Running
whole-buffer restoration on a live manager would duplicate operation identities,
drop live buffered entries, or certify unpersisted live work as durable.

Therefore:

- Make `restoreState()` an **exclusive, single-flight initialisation per
  selected store and manager ownership period**.
- Subsequent scans against an already-initialised store join the in-flight
  initialisation or reuse existing in-memory ownership without re-reading or
  replacing `buffer`.
- Only entries loaded from the owned store during that initial load may start
  marked already durable; any live admission staged concurrently must retain its
  own higher mutation generation and require persistence before handler start.
- Stopping before load finishes must leave the as-yet-unread store intact.
- When `resetDatabase` destroys and replaces the key-value store, or database
  selection changes, invalidate the store generation, committed-ID baseline,
  pending writer, and migration ownership together so an old store's completion
  can never certify a replacement store.

#### Bounded dispatch without dependency deadlocks

Unbounded concurrent fan-out of thousands of restored events creates thousands
of simultaneous promises, status scans, and snapshot requests. Dispatching must
remain bounded **without** introducing slot starvation:

- **No wait holds execution capacity:** Dependency waits (`prerequisites` and
  `orderedPredecessors`), coalesced-successor waits, `dispatchPaused` holds, and
  batch-delay timers MUST NOT occupy semaphore or dispatch-window capacity
  needed by their producers or retries.
- **Progress for retries, sentinels, and explicit flushes:** Eligible captured
  retries (`captureFileEventAttempts`), already-captured buffered operations
  under `waitForIdle()`, and predecessors behind a `TYPE_SENTINEL_FLUSH` must
  always be schedulable while waiting callers observe them.
- **Exit wake-up:** Preserve a wake-up whenever new items arrive as a shared
  queue dispatch run is exiting so no ready item can be stranded in `buffer`.

#### Finite flush (`waitForIdle()` / `commitPendingFileEvents()`)

Explicit local flushes retain their full October and November contracts:

- Capture already-running admissions and pending operations present at entry,
  release their batch delays, start at most one new retry attempt (`ReconcileFileEvent`)
  for each eligible prior ordinary failure (`CREATE`, `CHANGED`, `DELETE`, or
  `RENAME`) present before the flush boundary, and await actual handler and
  acknowledgement-commit results.
- Later admissions cannot extend the captured boundary indefinitely. Overlapping
  flushes share running attempts, and earlier callers retain their original
  failure results.
- Unrelated paths continue progressing even when another path has failed.

### 4. Batch Timing, Editor Timing Hints, and Ordering

- Retain independent `batchSave` (non-LiveSync modes) and `batchSaveInLiveSync`
  (LiveSync mode, default `false` for both existing settings and new Vaults,
  never inferred from legacy `batchSave`).
- Keep earliest uncommitted `since` for `batchSaveMaximumDelay` and latest
  eligible activity for `batchSaveMinimumDelay`. Manual flush, settings apply,
  and destructive ordering barriers may release a batch early.
- **Timing-only `watchEditorChange`:**
  - When `watchEditorChange` observes an editor change on a path with an active
    batch gate, it acts strictly as a quiet-period timing hint rather than
    enqueueing a duplicate `FileEventItem` with `cachedData`.
  - Verify live settings (`isConfigured`, not suspended, not in remediation),
    non-processing status, exact gate identity, `!operation.flushRequested`, and
    that the waiting operation is still the latest owner for that path
    (including either side of an admitted rename). Revalidate ownership after
    any asynchronous check.
  - Reschedule the existing `waitInfo.deadline` using `planBatchDeadline` with
    the original `waitInfo.since`. Once the maximum delay has expired, release
    the gate once rather than repeatedly replacing a zero-delay timer.
  - Genuine Vault `modify` notifications still enter normal admission.
    Coalescing `CREATE` followed by a genuine Vault `CHANGED` remains a separate
    follow-up unless explicitly adopted with its own ordering tests.
- **`DELETE` / `RENAME` ordering sentinels (`TYPE_SENTINEL_FLUSH`):**
  - Admitted atomically with their owning `DELETE` or `RENAME` operation.
  - Wait only for strictly earlier operations, never for themselves or
    successors.
  - Acknowledge and remove a sentinel only after it has been dispatched and
    every preceding operation has committed completion.

### 5. Orderly Unload (`stopWatching()`), Recovery Fence, and Hot Re-enable

Obsidian's `Plugin.onunload()` is synchronous and does not await asynchronous
teardown, and CLI daemons can receive `SIGINT` or `SIGTERM` while thousands of
events are queued. Orderly shutdown therefore standardises on
**preserve-and-stop** rather than draining arbitrary unstarted backlogs:

1. **Synchronous terminal unload fence:** Install a synchronous terminal stop
   fence at unload entry, before any asynchronous `onBeforeUnload` hook or
   recovery handler runs.
2. **Recovery hook alignment:** `databaseConnectionRecovery` (registered at
   `onBeforeUnload` priority `-100`) MUST NOT call `resumeDispatch()` to start
   new queue work during unload. Instead, paused dispatches wake directly into
   the stopped outcome while retaining their durable intents.
3. **`stopWatching()` sequence:**
   - Synchronously mark `acceptingEvents = false` and `stopping = true`.
   - Stop dispatching any unstarted buffered or restored events.
   - Dispose all pending `_waitingMap` batch timers and settle their gates with
     an explicit shutdown outcome (for example, `'stopped'`, distinct from
     coalesced `false`) so waiting callers settle cleanly without running
     handlers or raising spurious 'without a successor' errors, while retaining
     their entries in `pendingSnapshot`.
   - Track every operation that has crossed the handler-start boundary
     (`inFlightOperations`) **all the way through its terminal completion and
     acknowledgement commit** (not merely until the inner handler returns).
   - Await only already-started admissions and `inFlightOperations` (bounded by
     the concurrency limit), then **join any in-flight persistence I/O and the
     serial writer (`snapshotTail` fence)**, perform at most one additional
     final persistence flush if uncommitted changes remain, and mark
     `stopped = true` so no subsequent `triggerTakeSnapshot()` or background
     write can run.
4. **Cancellation propagation to scanner and readiness:**
   - Check the stop state after asynchronous snapshot loading, while awaiting
     replay, before watcher registration (`beginWatch()`), and before
     `markIsReady()`.
   - When `stopWatching()` interrupts `restoreState()` (or occurs on an
     uninitialised store where the scanner skips restore), propagate an explicit
     aborted outcome so `offlineScanner` (`performFullScan()`) and
     `prepareDatabaseForUse()` exit immediately without running
     `collectDeletedFiles`, full Vault scanning, or `markIsReady()`.
   - Any concurrent explicit `waitForIdle()` settles cleanly with the stopped
     outcome rather than hanging indefinitely.
5. **Hot re-enable and CLI teardown coordination:**
   - Because Obsidian returns immediately from synchronous `onunload()`, a user
     can hot-disable and immediately hot-re-enable this plug-in while old
     teardown is still finishing. Coordinate same-store ownership (generation
     fence / handoff lock) so a retiring manager's final flush or database close
     cannot overwrite or close a newly enabled manager's store.
   - In the CLI (`src/apps/cli/main.ts`), `SIGINT`/`SIGTERM` handlers and normal
     command cleanup MUST share a single-flight `unload()` teardown promise so
     repeated signals or overlapping exit paths do not race.

### 6. Incremental Persistence Adapter and Crash-Safe Legacy Migration

#### Optional Commonlib adapter contract

Retain `IStorageEventPersistenceAdapter` (`saveSnapshot` / `loadSnapshot`) for
backward compatibility, and add an optional incremental extension:

```ts
export interface StorageEventSnapshotRecord {
    readonly id: string;
    readonly event: QueuedFileEvent;
}

export interface StorageEventSnapshotDelta {
    readonly upsert: readonly StorageEventSnapshotRecord[];
    readonly remove: readonly string[];
}

export interface IStorageEventIncrementalPersistenceAdapter extends IStorageEventPersistenceAdapter {
    loadSnapshotEntries(): Promise<readonly StorageEventSnapshotRecord[] | null>;
    applySnapshotDelta(delta: StorageEventSnapshotDelta): Promise<void>;
}
```

- Activate incremental mode only when both methods are present. Once selected,
  keep that mode authoritative after I/O failures (never silently fall back to
  full-snapshot mode on error).
- Require disjoint `upsert` and `remove` IDs in each delta (or apply an explicit
  precedence rule).
- Persist `TYPE_SENTINEL_FLUSH` entries with their own ordered IDs atomically
  alongside their `DELETE` or `RENAME` operation, and remove them only when
  dispatched and every preceding operation has committed completion.

#### Ordering IDs and IndexedDB layout (Obsidian host)

- **Monotonic store-scoped sequence:** Allocate durable entry order from a
  store-scoped monotonic sequence high-water mark under exclusive ownership or
  inside the write transaction. Never derive durable ordering from wall-clock
  timestamps, random event keys, paths, or runtime-only counters. Preserve each
  entry's ID across retries, failed commits, and reloads.
- **Collision-free IndexedDB keys and typed service boundary:**
  - Expose atomic multi-key batch (`applyBatch`) and range enumeration through a
    typed capability on the key-value database service rather than ad-hoc casts
    on the narrow `KeyValueDatabase` interface.
  - Use numeric compound IndexedDB keys (for example,
    `['storage-event-manager-entry', sequence]`) or an explicitly disjoint key
    space that cannot collide with `openSimpleStore(kind)`'s `${kind}-` string
    prefix bounds (in particular, avoiding string keys starting with `storage-`
    that `openSimpleStore('storage')` could enumerate).
  - Execute each `applySnapshotDelta` in a single IndexedDB `readwrite`
    transaction, aborting explicitly on synchronous request errors and resolving
    only on `transaction.oncomplete`.

#### Crash-safe migration from legacy `storage-event-manager-snapshot`

Migration must never lose pending intents on interruption and must never
resurrect completed intents once the incremental store becomes empty:

1. **Legacy authority during staging:** Keep the existing
   `storage-event-manager-snapshot` key immutable and authoritative while
   staging.
2. **Deterministic bounded staging:** Assign deterministic sequence IDs from
   each legacy entry's array position, write bounded chunks (yielding between
   transactions so the renderer stays responsive), and permit idempotent rerun
   if interrupted after any chunk.
3. **Single-transaction cutover:** In one final IndexedDB `readwrite`
   transaction, publish the incremental-format active marker (with the
   high-water mark and a store-scoped `storeId`) and delete the legacy
   `storage-event-manager-snapshot` key.
4. **Explicit reader states:** `loadSnapshotEntries()` reads both the active
   marker and the legacy key before choosing a format.
   - `staged` (legacy key present, active marker absent) resumes or finishes
     deterministic migration from the authoritative legacy key.
   - `active` (active marker present) loads committed incremental entries,
     including the `active-empty` case when the queue has been drained. If the
     legacy key also exists, the reader validates it, appends its events after
     the committed high-water mark, and removes the legacy key in the same
     transaction. An empty legacy array only removes the legacy key.
   - `absent` (neither marker, legacy key, nor incremental entries) represents
     a fresh empty store. Orphaned records or malformed active keys are errors.
5. **Reset and downgrade behaviour:**
   - `resetDatabase` destroys and recreates the IndexedDB store via
     `kvDB.destroy()`, wiping all incremental records and markers cleanly.
   - An older plug-in release reads only the legacy
     `storage-event-manager-snapshot` key. During a downgrade, surviving Vault
     files can be reconciled by the start-up Offline Scanner. Pending
     incremental intents remain in IndexedDB for the next upgrade, when they
     are restored before any events still pending in the legacy format.

Note: migrating an already-accumulated 7,453-entry legacy record still performs
one initial IndexedDB `get` of that existing structured-clone value. This design
eliminates repeated full-array `put` writes and bounds all new write batches;
the latency of that one-time legacy `get` must be measured rather than assumed
stall-free.

### 7. Reconciliation, Revision Provenance, and Preservation Matrix

All content reconciliation and conflict-preservation rules from the October and
November decisions remain in force without weakening.

#### Strict content reconciliation and ordinary start-up opt-out

Under strict checking (`strictContentCheck: true`, the default when omitted, and
mandatory for manual scans, Fetch, Rebuild, and explicit recovery), timestamp
equality (including identical raw timestamps) never proves content equality.
The Offline Scanner's `NEWER_WINS` / `sync-newer` path must establish one of the
following outcomes through the ordinary non-forced file handler:

| Evidence | Required outcome |
|---|---|
| Vault content matches an eligible current leaf | Record or retain valid provenance as appropriate; create no duplicate revision. |
| Vault content matches its recorded displayed revision or saved content evidence, while the current database winner has advanced | Apply the database state through the protected reflection path; never resurrect unchanged older content as an edit. |
| Vault content differs from its recorded displayed revision | Preserve the edit on that recorded branch; keep independent concurrent branches available for conflict resolution. |
| Vault content has no provable origin and matches no current non-deleted leaf | Preserve it according to independent-branch rules; never attach it to an arbitrary database winner. |
| Required content or provenance cannot be read, or state changes during comparison | Retain unresolved work and report or re-evaluate it; never mark it reconciled merely because timestamps compare `EVEN`. |

Ordinary Obsidian start-up may opt out via **Strict content check on startup**
(`strictContentCheckOnStartup`, disabled by default). With the opt-out active,
a body read may be skipped **only** when the file's raw modification time, byte
size, and valid device-local provenance exactly match a conflict-free current
leaf and no file processing is pending (`!hasPendingFileEvent(path)`). An
unrecorded edit preserving exact size and raw modification time remains an
accepted limitation of that opt-out. Pending-event replay, incoming-change
protection, and deletion guards remain active in both modes.

#### Replay and retry preservation matrix

| Class | Meaning |
|---|---|
| **A: guarded** | Current files, necessary branches, and unresolved intent remain protected. An operation may remain pending. |
| **B: idempotent** | An already-represented effect completes without changing content, deletion state, required history, or revision count. |
| **C: additional revisions** | Extra revisions are acceptable only with verified content and ancestry preservation and safe convergence. |
| **D: deletion remains unmet** | Conservative fallback retains content when the deletion's source branch cannot be established; passed to conflict-check policy. Deleting newly recreated content violates A and is outside D. |

| Operation and current state | Required outcome | Class |
|---|---|---|
| Content acquisition failed; file still exists | Read current bytes and apply provenance policy. | A |
| Failed temporary-file save is now absent | Finish obsolete save under missing-file policy; retain following delete, rename, and final-file work. | A |
| Database and provenance saved; only acknowledgement failed | Recognise saved effect without another revision. | B |
| Database saved before provenance; no remote descendant arrived | Known pre-provenance gap: replay may create an identical sibling, tombstone one branch, and converge to one non-deleted leaf with exact saved bytes; a subsequent converged restart adds no revision. | C, conditional |
| Same pre-provenance gap with a remote descendant | Preserve both versions or their verified merge and ancestry; use manual conflict resolution where required. | A |
| Logical deletion unrecorded, source absent, displayed branch known | Record logical deletion on that branch. | A |
| Logical deletion already represented | Retain deletion without another revision. | B |
| Deleted path has been recreated | Protect current file and retain its own save operation. | A |
| Deletion targets a conflicted document whose displayed source branch is unknown | Preserve branches via conflict-check fallback. | D |
| Rename target acquisition fails or unrelated target exists | Preserve source and target; retain unresolved operation. | A |
| Rename target saved, source deletion unrepresented | Continue only when ownership and branch conditions prove target ownership; target existence or equal bytes alone are insufficient. | A |
| Rename target saved, conflicted source branch unknown | Preserve source branches via conservative fallback; old path may remain. | D |
| Rename (including case-only) already complete | Preserve move without another revision; protect and reconcile any newer target edit. | B (+ A for later edit) |
| Snapshot or delta persistence fails | Retain operation and retry remaining effect or acknowledgement without losing newer ownership. | A |
| Permission or I/O failure continues | Settle bounded attempt as failed and retain work. | A |

## Ownership and Implementation Order

Keep changes cleanly separated across package boundaries (`AGENTS.md` and
[Common library package boundary](2026_07_common_library_package_boundary.md)):

1. **Step 1 — `@vrtmrz/livesync-commonlib`:**
   - Implement Layer A (`StorageEventManager` detached coalescing batches,
     writer-local provisional completion, O(1) status counters, exclusive
     single-flight store-scoped `restoreState()`, non-deadlocking bounded
     dispatch, timing-only `watchEditorChange`, payload hygiene, preserve-and-stop
     `stopWatching()`, and `offlineScanner` / `prepareDatabaseForUse`
     cancellation propagation).
   - Add the optional `IStorageEventIncrementalPersistenceAdapter` contract and
     delta-planning support with automatic fallback to `saveSnapshot` /
     `loadSnapshot`.
   - Pass Commonlib's standalone verification (`npm run verify:package`) and
     produce a verified packed artefact.
2. **Step 2 — `obsidian-livesync`:**
   - Install the exact packed Commonlib candidate and implement Layer B in
     `IDBKeyValueDatabase` (`src/common/KeyValueDBv2.ts`) and
     `ObsidianPersistenceAdapter`
     (`src/managers/ObsidianStorageEventManagerAdapter.ts`), including
     store-scoped monotonic keys, single-transaction delta application,
     crash-safe staged migration, and same-store hot re-enable ownership fencing.
   - Fix host adapter error propagation in `CLIStorageEventManagerAdapter` and
     `FSAPIStorageEventManagerAdapter`, unify CLI signal/normal `unload()` into
     one single-flight teardown promise, and update `databaseConnectionRecovery`
     (`onBeforeUnload` priority `-100`) and its unit tests for the terminal
     unload fence.
   - Run the consumer checks, acceptance suites, and renderer cost measurements,
     then publish Commonlib, pin the immutable registry version, mark this ADR
     `accepted` with recorded evidence, and add superseding links to the October
     and November ADRs and `docs/README.md`.

## Verification Required

Implementation is not complete until all four acceptance suites pass and their
evidence is recorded here:

1. **Durability under interleaving (full-snapshot and incremental adapters):**
   Block transaction A, admit event B during A, mix a stale completion and an
   admission-rejected completion with a valid completion, and fail transaction
   A. Assert exact stored contents, `hasPendingFileEvent()` remaining `true`
   throughout uncommitted writes, exact per-caller outcomes, and that B's
   handler cannot start before B's committed admission.
2. **Scheduler progress (dispatch window 1 and 5):**
   Combine buffered work, failed-predecessor retry chains, coalesced
   successors, a `TYPE_SENTINEL_FLUSH`, overlapping finite `waitForIdle()`
   flushes, and an unrelated ready path. Assert zero deadlocks, exact handler
   dispatch order and counts, bounded failure retries, and that later
   admissions cannot extend an active flush indefinitely.
3. **Unload, hot re-enable, and restart:**
   Invoke `stopWatching()` / `onUnload()` during each phase: initial snapshot
   load, batch wait, database-recovery pause, active handler execution,
   acknowledgement I/O, uninitialised-store scan, and an active explicit flush.
   Immediately construct a second manager on the same store (simulating hot
   re-enable). Assert that no unstarted old-manager handler launches, every
   caller settles with its specified outcome, `offlineScanner` does not proceed
   to scan or `markIsReady()`, the old manager performs zero writes or closes
   after handoff, and restart recovers the exact pending intents.
4. **Migration and renderer cost (7,453-entry synthetic fixture):**
   Populate 7,453 legacy entries with representative cached-text sizes,
   duplicate paths, filtered renames, and `TYPE_SENTINEL_FLUSH` markers. Inject
   interruption after each staging chunk and on both sides of the final cutover
   transaction. Verify exact order preservation, `staged` vs `active-empty` vs
   `absent` behaviour, database reset, and documented downgrade semantics.
   Separately measure: (a) one-time legacy read latency, (b) longest renderer
   main-thread task, (c) bytes submitted to `IDBObjectStore.put`, (d)
   post-restore persistence write count, and (e) pure CPU cost with IndexedDB
   writes suppressed (confirming O(1) status and delta bookkeeping).

### Recorded verification evidence

The local verification used the packed Commonlib `0.7.0` candidate with the
iOS 15 compatibility fix. Its SHA-256 was
`c73c75e7420e42db91588c689f95f75bd13689e7c8b20f02258e1963b9714ae6`.
Self-hosted LiveSync consumed those exact bytes through its package manifest
and lockfile. The verified lockfile integrity was
`sha512-+c3HUJxuOj/4CYtiolA2ike7RuTU9PXB5WdV2Yzq+/w6+e49h4BR3pQQsZ2fk33BdLa6V3X/1ODyN2aHpFbe9A==`.
[vrtmrz/livesync-commonlib#237](https://github.com/vrtmrz/livesync-commonlib/pull/237).

The decision remains proposed pending publication of the reviewed Commonlib
artefact, the immutable registry pin, clean `npm ci` verification against that
pin, and the acceptance and superseding links described in Step 2.

**Step 1 — Commonlib.** `npm run verify:package` passed on Node.js 26.13.1 and
Linux arm64. The gate covered 4,373 unit tests across 215 files, 10 boundary tests,
32 release tests, and the packed consumer checks.

An earlier Step 1 run measured the 7,453-entry in-memory incremental replay at
448.8 ms elapsed and 634.6 ms process CPU time, with
5,481 acknowledgement writes, zero redundant admission writes, and a peak of
five handlers. The full-array projection with storage I/O suppressed took
1,001.9 ms elapsed and 1,329.4 ms process CPU time, with 6,604 acknowledgement
writes and a peak of five handlers. These are Node.js measurements from the
Commonlib fixture.

**Step 2 — Self-hosted LiveSync.** The commands below passed on Linux arm64
with Node.js 26.13.1. The real-host scenarios used Obsidian `1.12.7`. The
Issue #1380 scenario ran through `test:e2e:obsidian:focused`, which reproduced
the production plug-in bundle SHA-256
`300de745505be958be83d85fa7b7404b1d5799ce12da50cbd48a847d374ea94f`.
The CLI production bundle SHA-256 was
`f77ad798ffd8303a3ad5e529057b210fcb38b14780fef1339911846ab3ccbb4d`.
The WebApp entry script SHA-256 was
`12d49c043b1fccce867d01fa7e2d446dc2e6556978e79bcb26d3a72c69f754d9`.
The WebPeer entry script SHA-256 was
`34949e3eec2276b8d15bb045739e67467ddcec5b1ebfbab9fb0914880f9d7aec`.

| Verification | Result |
| --- | --- |
| `npm run check` | Passed, including the production build and iOS 15 syntax check |
| `npm run test:unit` | 2,708 passed across 229 files, two skipped |
| `npm run build` | Production plug-in build passed |
| `npm run build:browser-apps` | WebApp and WebPeer production builds passed |
| `npm run build --workspace self-hosted-livesync-cli` | CLI production build passed |
| `issue1380-persistence-lifecycle` | 4/4 passed, covering legacy cutover and second restart, immediate hot disable and re-enable, unload during a held recovery pause, and real editor `batchSave` timing |
| `log-lifecycle` | 2/2 passed, covering ordinary shutdown and an injected close failure |
| `local-file-retry` | Passed for rename, same-path edit, and restart recovery |
| `optional-file-save-completion` | Passed for all three provider modes and replayed both failed saves before readiness |
| `issue1207-livesync-batch` | 24/24 passed |
| CLI `test:snapshot-durability` | 3/3 passed, including `SIGINT` and `SIGTERM` |
| WebApp `test:browser` | 3/3 passed, including native IndexedDB reload and transaction-abort durability |

The reconnection unit cases verify that a surviving store retains its `storeId`
and committed IDs after connection termination or a version upgrade. When an
external deletion follows termination—including when a recreated store commits a
replacement event under a colliding sequence and entry ID (`000000000001`)—the
first write on the old generation detects the changed `storeId`, invalidates the
old generation without touching the replacement record, and leaves retained work
to commit cleanly after reacquisition. Additional cases verify that connection
termination or a non-destructive version upgrade during legacy migration before
cutover rejects the interrupted restoration rather than caching a fulfilled
promise, so retrying `restoreState()` on the same manager replays the legacy
event once and permits subsequent snapshots.

The first real Obsidian run exposed a queue-key compatibility gap during legacy
restart. The host snapshot readers now derive missing keys from the saved
file path and preserve existing keys. Obsidian regression tests cover both
legacy migration and reading already-active records, and the CLI and WebApp
tests cover reading their full-array snapshots. The reset test also verifies
that an old-store completion cannot certify the replacement, and that writing
the retained intent succeeds once the replacement is acquired.

The first unit run against an earlier candidate rejected a synthetic CLI snapshot
fixture that contained a file path alone. The older CLI writer included both
the file name and stat. The corrected fixture verifies that an otherwise valid
event without a queue key is restored without rewriting the snapshot. A
separate assertion verifies that the incomplete record is rejected and its
contents are preserved.

Earlier candidate verification also passed `smoke`, `stale-file-restart`,
`database-recovery`, and `database-probe` in Obsidian `1.12.7`.

| Acceptance suite | Candidate evidence |
| --- | --- |
| 1. Durability under interleaving | Commonlib exercises failed detached writes with full-snapshot and incremental adapters, including stale, rejected, and valid completions. LiveSync exercises concurrent admissions and completions across successful and failed IndexedDB batches using the production adapter and an in-memory IndexedDB implementation. |
| 2. Scheduler progress | Commonlib exercises windows of one and five with bounded retries, coalescing, a sentinel, and overlapping finite flushes. The Chromium probe checks exact handler order and a peak of five handlers on the restored backlog. |
| 3. Unload, hot re-enable, and restart | Commonlib exercises early and active stop phases, including load, batch wait, recovery pause, running handlers, and an explicit flush. LiveSync exercises same-store handoff, interrupted migration, acknowledgement I/O, and cancellation during database recovery. Scanner and start-up tests check cancellation before scanning or marking the application ready. |
| 4. Migration and renderer cost | The Chromium probe below exercises production persistence and replay on native IndexedDB. The LiveSync unit suite also covers atomic cutover, including interruption during the transaction. |

**Step 2 — Chromium IndexedDB.** The browser probe passed on headless
Chromium 149.0.7827.0, Ubuntu 22.04.5 LTS (Linux arm64, Neoverse-N1). The probe
bundle SHA-256 was
`df30143395c8cec333e5c9c096c1f3d12e0961c1bdea41de578a0e13404f2ab6`.
The synthetic legacy array contained 7,453 entries, including
3,507 cached 2,048-byte Markdown strings, 6,262 repeated-path entries, 438
filtered renames represented as deletions with `renameTarget`, and 439 flush
sentinels. Migration staged 38 chunks of at most 200 entries.

Run `node --import tsx test/browser-apps/storage-event-persistence-probe/run.ts`
from the repository root to reproduce the measurement. The runner writes
`chromium.json` to `DATABASE_PROBE_EVIDENCE_DIR` when set, or to
`/tmp/livesync-storage-event-probe` by default. The JSON records the tarball
SHA-256, lockfile integrity, and probe bundle SHA-256.
[Browser probe runner](../../test/browser-apps/storage-event-persistence-probe/run.ts).

| IndexedDB phase | Elapsed time | Longest renderer task | Longest synchronous `put` | Native `put` calls | Total value bytes sent to `put` | Largest transaction by value bytes | Committed write transactions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Legacy full-array write | 30.9 ms | 29.714 ms | 28.8 ms | 1 | 9,242,185 | 9,242,185 | 1 |
| Candidate migration and cutover | 849.4 ms | 19.416 ms | 1.4 ms | 7,454 | 1,430,795 | 38,615 | 39 |
| Candidate replay after reopening | 5,274.2 ms | 32.578 ms | 1.1 ms | 3,069 | 309,969 | 101 | 3,069 |

The reopened baseline `get('storage-event-manager-snapshot')` took 25.9 ms.
The production migration's single keyed `getEntries` read took 22.2 ms,
including its IndexedDB requests and transaction completion. Chromium's
DevTools trace measures renderer main-thread tasks within each marked phase.
The byte counts sum the UTF-8 JSON sizes of the values passed to native
`IDBObjectStore.put`. They exclude keys, deletes, and storage overhead. JSON
encoding for the count ran outside the measured phases.

Replay started all 7,014 file handlers in the exact fixture order and reached
five concurrent handlers. It issued zero admission writes and 3,069
acknowledgement delta commits. The commits removed all 7,453 entries once each,
with each sentinel acknowledged after its predecessors. With IndexedDB writes
suppressed, the same replay took 185.3 ms elapsed. Chromium reported 210.489 ms
of renderer thread CPU time for the whole instrumented CPU scenario, including
fixture setup and assertions. The timed replay occupied one 185.361 ms renderer
task. The CPU run recorded 4,381 acknowledgement batches and zero IndexedDB
writes. The probe ran 10,000 status updates in 1.3 ms without iterating the
pending snapshot. At depths one, three, and twelve, 10,000 pending-path
queries took 2.0 ms, 4.1 ms, and 33.9 ms, with exactly 10,000, 30,000, and
120,000 path-index lookups. The pending-snapshot iterator recorded 29,368
visits across replay, including delta and sentinel planning, about four per
fixture entry.

The probe interrupted and reopened the same database after each of the 38
staging commits. Each reopening exposed the exact staged prefix and the
unchanged legacy snapshot, including after the last chunk and before cutover.
On interruption immediately after the cutover commit, the reopened incremental
reader returned all 7,453 ordered records and the expected high-water mark. The
legacy key was absent, so an older plug-in reader could not see those pending
intents. A reopened store after replay returned `active-empty` with only the
active marker present. After `destroy()`, reopening returned `absent` with no
keys. These checks use disposable databases and controlled handlers in
Chromium. The synthetic timings and the affected Obsidian Vault's field
profile describe separate environments.

## Alternatives Considered

- **Longer throttle on `triggerTakeSnapshot` alone:** Does not affect direct
  `takeSnapshot()` / `completeSnapshot()` barriers or reduce the ~1.23 s cost
  of a single 7,453-entry `IDBObjectStore.put`.
- **Coalescing only (Layer A without Layer B):** Eliminates the multi-hour
  `snapshotTail` starvation loop and fixes hot-disable, but leaves every
  remaining write to a large backlog paying an $O(N)$ synchronous main-thread
  Structured Clone stall.
- **Worker offloading of IndexedDB writes alone:** Moving `put` into a Web
  Worker still requires renderer-side `postMessage` Structured Clone of the
  entire 7,453-entry array on every write unless persistence itself becomes
  incremental.
- **Subsuming coalesced predecessors on disk at successor admission:** Would
  weaken failed-successor retry semantics currently verified by
  `StorageEventManager.unit.spec.ts` without a separate crash and retry proof.
  Making `watchEditorChange` timing-only and moving to incremental records
  removes the practical bloat without altering that contract.

## References

- [Issue #1380](https://github.com/vrtmrz/obsidian-livesync/issues/1380)
- [Local File Save Completion and Batching (October 2026 ADR)](2026_10_local_file_save_completion_and_batching.md)
- [Retry Failed Local File Operations (November 2026 ADR)](2026_11_local_file_operation_retry.md)
- [Conflict resolution and revision provenance](../specs_conflict_resolution.md)
- [File writing and database-to-Vault reflection](../design_docs/file_write_and_reflection_paths.md)
- [Local database connection recovery](../design_docs/local_database_connection_recovery.md)
- [Common library package boundary](2026_07_common_library_package_boundary.md)
- [Commonlib event admission and reflection contract](https://github.com/vrtmrz/livesync-commonlib/blob/main/docs/storage-events-and-reflection.md)
