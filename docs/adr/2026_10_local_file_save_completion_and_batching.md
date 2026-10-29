---
date: 2026-10-24
commonlib-version: "0.2.0"
self-hosted-livesync-version: "1.0.40"
status: accepted
---

# Architectural Decision Record: Local File Save Completion and Batching

## Status

Accepted on 2026-10-25. The recovery contracts and LiveSync mode batching in
implementation-order steps 1–3 are present in current Self-hosted LiveSync
1.0.42 with Commonlib 0.2.2. The version fields above retain the investigated
baseline. Further same-path coalescing in step 4 remains a follow-up.

## Context

[Issue #1207](https://github.com/vrtmrz/obsidian-livesync/issues/1207) includes
conflicts around automated note creation, editing, and renaming. Batching local
file updates can reduce the intermediate revisions which another device receives.
It also extends the period during which the Vault contains an edit which the
local database has not saved. Recovery and incoming-file protection must remain
correct throughout that period.

Two-device Obsidian E2E tests using Self-hosted LiveSync 1.0.40 and Commonlib
0.2.0 found that a test-only removal of the LiveSync mode restriction reduced
six consecutive edits from six additional revisions to one, in both directions.
Incoming identical content produced no extra conflict, while genuinely different
edits or a deletion preserved the necessary branches. A synthetic
create–edit–rename sequence still delivered intermediate content. These tests
used Vault operations, without Templater or Modal Forms themselves.

Restart tests exposed a separate recovery gap:

1. The event manager removes an event from its waiting map when its timer is
   released. It also removes a buffered event before dispatching it. Its saved
   snapshot covers buffered and waiting events, but omits work in progress.
2. `waitForIdle()` waits for the waiting gates to open, rather than for the file
   handlers to finish. `ServiceFileAccessBase` reports that pending events have
   been committed after this gate-only wait. Some handler failures also settle
   without propagating a failure to that caller.
3. If the process stops before the database write, the file can retain the new
   content while the database retains the old content and the saved event
   snapshot is empty.
4. At start-up, the Offline Scanner's `EVEN` branch tries to record missing
   provenance, then reports completion. It ignores that helper's Boolean result.
   Different content can consequently remain unsaved when both modification
   times fall in the same two-second comparison bucket.

The last condition was reproduced by pausing the target operation immediately
before database processing, then restarting the same isolated profile. A
different timestamp bucket recovered the edit; the same bucket did not. The
changed-condition success demonstrates the boundary, rather than a fix. This
does not establish the cause of the reporter's historical conflicts.

The runtime evidence covers Linux aarch64, Obsidian 1.12.7, and CouchDB 3.5.0.
Windows, mobile lifecycles, and the reporter's full automation remain outside
that evidence. The inspected Commonlib source is commit
`aa54282937c20d3db7f43778d240feeb1586cced`.

## Decision

Make local file processing recoverable until its result is established, retain
strict content and provenance reconciliation for manual and recovery scans, and
enable batching in LiveSync mode only through an explicit choice after those
contracts pass verification. Ordinary Obsidian start-up may skip a body read
only under the exact-match conditions below. Apply the recovery contract with
batching enabled or disabled.

The content-reconciliation change targets selected ordinary files in the
Offline Scanner's `NEWER_WINS` / `sync-newer` action. Keep the existing action
matrix, explicit `DB_APPLY` policy, selection and size limits, conflict guards,
and recovery suspensions. Hidden and internal files retain their owning
feature's recovery contract; an ordinary file scan cannot recover those paths
on its behalf.

### 1. Distinguish local persistence from replication

The following boundaries have different meanings:

| Boundary                   | Meaning                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch wait released        | The file operation may start. Its content can still be absent from the local database.                                                                  |
| Local processing completed | The intended change is represented durably by the local database and its required content, or has been proved already represented or safely superseded. |
| Replication completed      | A finite replication reports its own outcome. A local save alone does not prove remote receipt or reflection into another Vault.                        |

Ordinary file saving by Obsidian remains independent of database saving. Pending
and processing indicators must include work in progress and unresolved failures,
so an empty timer map cannot imply that local processing is complete.

### Optional file ownership and completion

Hidden File Sync and Customisation Sync register the new
`processOptionalFileEventWithResult` contract together. `firstHandled` tries
providers in order until one returns `completed` or `veto`; only
`not-applicable` advances to the next provider. Exceptions propagate unchanged.
`HandlerOutcome<TValue, TVetoReason>` gives completion data and refusal reasons
independent types. These saves use `void` completion data and string reasons.

A provider returns `completed` after its database operation succeeds or the
current state is already represented. Failed writes and deletions throw, and
the manager retains the event. Hidden File Sync acknowledges its processed
fingerprint after successful processing. Customisation Sync waits for the real
save after its existing 100ms quiet period. All notifications coalesced into a
V1 group receive that save's result; V2 files retain separate save groups.

A finite flush resolves each captured event's `whenFlushRequested` signal. This
releases its customisation delay and freezes that group; later groups do not
extend its completion. During start-up replay or suspension, providers use
physical database readiness rather than waiting for application readiness or
resume. Hidden File Sync loads its existing per-database caches before replay
and reuses them during the following initialisation hook.

The existing boolean optional API remains a legacy notification contract for
other callers and older hosts. Once a host registers typed providers, the
manager dispatches through that chain exclusively. Without a typed provider,
a resolved legacy notification completes that dispatch only; its boolean does
not establish a database save. Snapshot-write failures remain visible under
both contracts. No persistent journal, new snapshot schema, or automatic retry
loop is introduced.

### 2. Keep a recoverable record through processing

The event manager owns each operation from queue admission through completion.
Its existing persistent snapshot must represent buffered, waiting, and
in-progress work in an order which preserves deletion and rename dependencies.
Moving work between those states must not create a persistent gap.

An event can leave the recoverable set only after its effect is durable, current
state proves that the effect is already represented, or a durably recorded
successor safely subsumes it. Finishing an older operation must not remove a
newer operation for the same path. Cancellation of a batch timer alone is not
evidence that its content is safe to forget.

Snapshot writes must preserve mutation order. An older asynchronous write must
not replace a newer snapshot, and a failed snapshot write must remain visible
to the lifecycle caller. Reuse the existing device-local snapshot store; a
second journal and a transaction spanning the file system and database are not
part of this proposal.

The first implementation should retain the existing event snapshot format,
including event keys and rename intent, and add pending ownership within the
event manager. The persistence adapter remains responsible for storing the
ordered snapshots. Handler outcomes must distinguish a failed attempt from a
policy-approved skip before the manager can acknowledge either safely.

A crash after the database write but before snapshot removal can replay an
operation. Replay must check current storage and revision provenance, retain
the existing protection against stale restored events, and never delete a
newer same-path file. Once both the database write and provenance write have
completed, replay must not add another revision. If the database write
succeeded before provenance was recorded, replay may first create an identical
sibling even when no remote descendant has arrived. In the tested case
without a remote edit, replay creates that sibling. Duplicate handling then
tombstones one of the identical branches and converges to one live leaf with
the exact saved content.
Another restart must add no revision. Replay must remain safe to interrupt;
existing saved snapshots remain readable.

The database write and the device-local provenance write are separate,
sequential operations. A stop between them can leave the previous provenance
record in place. This pre-provenance gap is the known exception to the
no-extra-revision result after both writes complete: replay can first create a
duplicate sibling; one of the identical branches is then tombstoned while
one live leaf retains the saved bytes when no remote descendant has arrived. If continuous
replication advances the local database during the gap, replay can instead
expose the local content as a sibling of that descendant. The [conflict
resolution specification](../specs_conflict_resolution.md#known-potentially-problematic-behaviour)
records the required mergeable and manual-resolution outcomes. The per-file
lock does not fence replication writes. The interruption window is expected
to be very rare, but its field frequency is unmeasured; this decision adds no
transaction or second journal to close the interval.

Boolean failure, an exception, and an unavailable comparison are not successful
completion. Keep unresolved work recoverable and report the failure through the
existing service and diagnostic boundaries. Explicit exclusions or a verified
superseding change may finish work without a new revision; a generic handler
failure may not. Recovery may continue with independent paths, while retaining
the failed path and its dependencies. This proposal adds no unbounded retry loop.

The recoverable snapshot is an operation record, not a backup of every transient
editor buffer. File content already saved by the host remains available for
start-up reconciliation if the process stops before the first snapshot write.
Crash guarantees cannot include bytes or events which the host never persisted
or delivered, or repair arbitrary storage failure.

### 3. Give flush a finite, truthful completion boundary

An explicit commit of pending file events captures the work accepted before
that request, releases its batch delays, and waits for the actual processing
results, including buffered and already-running work. Later edits cannot extend
that boundary indefinitely. A newer coalesced operation may satisfy earlier work
only when its successful result covers that work.

The internal ordering barrier before a delete or rename waits only for its
predecessors. It must not wait for itself or later events in the same dispatch
loop. Replacing every gate wait with a wait for global idleness would risk a
dependency cycle or starvation.

Manual synchronisation and replication readiness use the completed local
boundary. Settings application must observe its result before reporting success
or resuming work which depends on it. Persisting a settings file is a separate
operation: `saveSettingData()` returning is not a file-processing completion
signal, and making every settings-saved notification synchronous is unnecessary.

When a host permits orderly shutdown, stop admitting watcher work before
draining accepted operations or preserving their pending records. Keep their
storage available until that work settles. Suspension, forced termination, and
Obsidian's synchronous unload callback cannot guarantee that asynchronous work
finishes; correctness must also follow from the persistent record and start-up
reconciliation. Remote availability must not determine whether local pending
work survives shutdown.

### 4. Preserve strict content reconciliation

Strict content checking retains the timestamp and provenance reconciliation
contract for platforms with coarse modification times. Timestamp equality,
including exactly equal raw timestamps, does not prove content equality. With
strict checking enabled, the Offline Scanner must establish one of the
following outcomes through the ordinary non-forced file handler and its
provenance rules:

| Evidence                                                                                                                | Required outcome                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Vault content already matches an eligible current revision                                                              | Record or retain valid provenance as appropriate; create no duplicate revision.                                                   |
| Vault content matches its recorded revision or saved content evidence, while the current database revision has advanced | Apply the database state through the existing protected reflection path. Do not resurrect the unchanged older content as an edit. |
| Vault content differs from its recorded revision                                                                        | Preserve the edit on that recorded branch. Keep independent concurrent branches available for conflict resolution.                |
| Vault content has no provable origin and matches no current live leaf                                                   | Preserve it according to the existing independent-branch rules. Do not attach it to an arbitrary database winner.                 |
| Required content or provenance cannot be read, or state changes during comparison                                       | Retain unresolved work and report or re-evaluate it. Do not mark it reconciled merely because the timestamp comparison is `EVEN`. |

The `strictContentCheck` scan option is strict when omitted. Ordinary Obsidian
start-up can opt out through **Strict content check on startup**, which is
disabled by default. With the option disabled, a body read may be skipped only
when the file's raw modification time, byte size, and valid device-local
provenance exactly match a conflict-free current revision and no file
processing is pending. All other files retain strict content reconciliation.
An unrecorded edit that preserves its exact size and modification time can
therefore remain undetected by ordinary start-up while the option is disabled.
Manual scans, Fetch, Rebuild, and other explicit recovery operations remain
strict. Pending-event replay, incoming-change protection, and deletion guards
remain active in both modes.

The table describes stable-state strict reconciliation, not atomic database and
provenance persistence. Replay in the pre-provenance gap may create an
identical sibling; with no remote descendant, one of the identical branches
is tombstoned, leaving one live leaf with the exact saved content. If replication has
already added a descendant, preserve its exact content through an existing
safe merge, or retain both branches for manual resolution. See [Known
potentially problematic behaviour](../specs_conflict_resolution.md#known-potentially-problematic-behaviour).

Revalidate the relevant file and database state before acting on a comparison.
Reuse the existing content and provenance checks; avoid a separate conflict
algorithm in the scanner. Metadata continues to reference Chunks containing the
file content.

`tryRecordUntrackedFileRevision()` answers whether it could safely record
provenance. Its `false` also covers an already-populated record, conflicting
history, unavailable content, and a concurrent change. It is not an 'edited
file' predicate. A fallback which treats every `false` as permission for a
forced save would violate the required outcomes.

Propagate the file handler's actual outcome into the pair result, including for
storage-to-database writes. Preserve the scanner's `completed`, `skipped`, and
`failed` distinctions and its existing `continueOnFileFailure` policy. Ordinary
Obsidian start-up can report `completed-with-file-failures` and allow unaffected
files to proceed; an unresolved pair must not become `completed` to achieve
that result. Keep the stricter callers' existing completion requirements.

Keep the original unchanged-file, edited-file, untracked-provenance,
incoming-protection, and concurrent-recheck fixtures under strict content
checking, including identical timestamps and distinct raw timestamps within
one comparison bucket. Do not weaken those strict-mode assertions to describe
the ordinary start-up opt-out. Test the opt-out separately: only the exact
stat, provenance, conflict-free, and no-pending-processing match may skip a
body read. Pending-event replay and incoming or deletion guards remain covered
with the opt-out enabled.

### 5. Make batch timing and activation explicit

Batching is a bounded delay before local database processing. The quiet-period
timer follows the latest eligible content update; the maximum intentional delay
starts with the first uncommitted update and is not reset by later edits or time
spent awaiting a processing slot. Once due, work must become eligible to run.
The maximum delay is not a guarantee of database completion, network delivery,
or another device's reflection time. Waiting timers should not consume the
capacity needed to process unrelated ready files.

For ordinary local content updates, queue the changed path and operation intent
without reading the file body merely to wait. Acquire the current content when
the operation becomes due, after coalescing eligible events. Reuse that content
snapshot within the operation for comparison, provenance evidence, and Chunk
creation. This retains the current ordinary-save boundary; it does not require
reading and hashing the file for every keystroke or queued notification.

Content reuse within one operation is distinct from keeping a body cache across
edits. A cached body would need a proven invalidation and freshness contract;
mtime and size alone cannot establish that it is current. A saved provenance
hash records evidence about earlier content, rather than replacing acquisition
of the current bytes. Restart recovery, an incoming update, or a comparison
which needs revalidation can still require additional reads. Preserve those
checks rather than making a global promise of one read per path.

Batching therefore aims to reduce repeated content acquisition, comparison,
Chunk processing, and local database updates, as well as intermediate revisions
and subsequent replication and reflection work. Event filtering, bookkeeping,
and pending-operation persistence still occur while waiting. The revision
reduction measured by the existing E2E does not quantify file reads, CPU cost,
physical disk I/O, or network traffic; measure those costs separately. Host or
operating-system caching also means that a read API call is not a physical disk
read count.

Manual flush and required deletion or rename ordering can end a batch early.
Ordinary incoming replication continues, using the existing protection for
unsaved local content. It must not require all unrelated local batches to flush
for every incoming document.

Add an independent `batchSaveInLiveSync` Boolean, defaulting to `false`
for both existing settings and new Vaults. In LiveSync mode, this value selects
batching; other modes continue to use `batchSave`. Both choices use the existing
minimum and maximum delay settings. The interface presents the choice for the
current mode. An ordinary mode switch preserves each mode's choice.

This adds one persisted setting to distinguish a new explicit choice from old
`liveSync: true, batchSave: true` configurations, where batching was ignored.
Neither upgrade nor import of that legacy pair may activate batching. An older
client continues to apply its existing LiveSync restriction. Include the new
property in Commonlib's setting policy and import/export tests; do not infer
consent from the presence of the old `batchSave` property.

The setting and scheduling changes follow the recovery work. Recovery in the
currently supported modes must pass verification before the new mode is enabled.

### 6. Keep batching separate from automation completion

The intended benefit is fewer short-lived intermediate revisions. Batching
cannot discover when a third-party template has finished, particularly while a
dialogue is open or another device also runs automation. A maximum delay or a
rename boundary can legitimately publish intermediate content.

Coalescing `CREATE` followed by `CHANGED` for the same still-existing file is a
useful follow-up, but it needs its own ordering and interruption tests. Preserve
the existing cross-path rename rule: store the destination before deleting the
proven source branch. Do not retarget or discard pending source operations
without proving the effect is already covered.

A guarantee that a multi-step template appears remotely only after completion
would need an explicit producer completion contract and its failure behaviour.
That is a separate design. Enabling batching alone must not be described as
eliminating genuine concurrent-edit conflicts or as a confirmed fix for #1207.

## Ownership and implementation order

The list below records the implementation sequence. Steps 1–3 are published
in the current version line; the further coalescing in step 4 remains planned.

1. **Commonlib recovery:** event ownership, ordered snapshot persistence,
   successful completion and failure propagation, finite flush boundaries, and
   same-time content reconciliation. Add focused failing regressions before
   changing production code. Reuse the existing event manager, file handler,
   scanner, and provenance store.
2. **Host integration:** keep the Obsidian persistence adapter and lifecycle
   wiring aligned with those contracts. Verify callers of
   `commitPendingFileEvents`, including settings application and database
   preparation, and preserve their failure outcomes. Validate the packed
   Commonlib artefact and update the consumer's exact dependency.
3. **LiveSync mode batching:** add the explicit setting and its primary-language
   presentation only after the recovery regressions pass. Establish the stated
   timing semantics and repeat the two-device comparisons with the actual
   package, including start-up with batching already enabled.
4. **Further coalescing:** assess same-path creation/editing and any proposed
   rename optimisation separately, against the original automation problem.

Keep these changes independently reviewable. Shared behaviour belongs in
Commonlib; the plug-in must not acquire a source mirror or patch installed
package files. Snapshot format changes, a second persistent store, or a new
automation transaction API require a further design decision.

## Verification required

The matrix below records the acceptance criteria for implementation steps 1–3
and remains useful for regression work. Publication in the current version line
does not extend the historical test results above to untested platforms or
automation workflows.

Use controlled promises at the manager and persistence boundaries for focused
regressions, and real PouchDB tests for content and ancestry. The acceptance
matrix is:

| Scenario                                                                                                             | Required observation                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Stop after dequeue, timer release, or during a database write                                                        | Pending work remains recoverable; restart eventually represents the saved Vault edit.                                                  |
| Database and provenance writes are complete before replay; restart twice | Replay adds no extra revision. |
| Stop after the database write but before provenance; no remote descendant; replay twice | The tested replay creates an identical sibling and tombstones one of the two branches; one live leaf retains exact saved content, and the second restart adds no revision. |
| A remote descendant arrives during the pre-provenance gap | The mergeable case preserves its exact content and ancestry; the overlapping case retains both bodies for manual resolution. |
| Old and new events share a path; snapshot writes overlap                                                             | Completing old work cannot remove new work or regress the durable snapshot.                                                            |
| Handler returns false, throws, or snapshot persistence fails                                                         | Flush reports failure; pending work is retained; unrelated recoverable work can continue.                                              |
| Buffered or in-progress work exists with no waiting timer                                                            | Flush still waits for actual completion.                                                                                               |
| A flush overlaps new typing or a rename/delete barrier                                                               | The captured work completes without waiting for later work or deadlocking.                                                             |
| Strict check: equal timestamps, unchanged or edited files, untracked or pruned provenance, unavailable Chunks, or concurrent recheck changes | Preserve correct ancestry and bytes, avoid duplicate revisions, and distinguish unresolved comparisons from successful reconciliation. |
| Start-up check disabled: exact raw time, size, and provenance match with no conflict or pending processing | The body read may be skipped; an unrecorded edit which preserves exact size and modification time remains an accepted limitation. |
| Pending-event replay and incoming or deletion guards, with either start-up setting | Keep replay and protection active; do not skip work or remove a file based only on matching statistics. |
| Settings save followed by stop; ordinary unload; interruption during replay                                          | No operation is forgotten because a settings callback or shutdown released its timer.                                                  |
| Sustained edits and more paths than available processing slots                                                       | Observe the intentional-delay deadline and progress of unrelated ready files.                                                          |
| Old settings, mode changes, explicit opt-in, and settings import                                                     | Existing LiveSync mode users retain immediate saving until they choose batching.                                                       |
| Incoming identical content, an edit, a deletion, or delete/recreate while waiting                                    | Preserve genuine branches without extra conflicts or loss of local work.                                                               |

The original E2E plan compared batching disabled, an ignored legacy setting, and
explicitly enabled batching in both directions, with manual synchronisation,
saved-snapshot restart, and controlled in-progress restart. Record the original
failure separately from repaired results; a pass with a different timestamp
bucket or a test-only bundle is not verification of the production fix. Keep
platform-specific lifecycle evidence bounded to the tested environments before
extending conclusions to Windows or mobile.

## Alternatives and consequences

- **Remove only the LiveSync guard:** leaves recovery gaps and can activate a
  previously ignored setting. The explicit choice follows correctness work.
- **Wait only at unload:** cannot cover abrupt termination and hosts which do
  not await asynchronous unload. Continuous recoverability is still required.
- **Repair only the scanner:** improves surviving-file recovery, but does not
  establish event ordering, deletion intent, or truthful flush completion.
- **Retain only in-progress events:** closes a persistence gap, but still needs
  success/failure handling, replay checks, and recovery before the first snapshot.
- **Remove timestamp rounding or force the Vault copy into the current winner:**
  fails for exactly equal timestamps and can destroy branch intent. Content and
  provenance determine the safe action.

Keeping work recoverable adds snapshot bookkeeping and can make local flush
wait longer because it now waits for real processing. Same-time reconciliation
can require additional content reads. Batching trades prompt remote visibility
for fewer database updates and may increase the window for genuine concurrent
edits. Measure these costs without weakening the content-preservation contract.

## References

- [Conflict resolution and revision provenance](../specs_conflict_resolution.md)
- [Batch database update settings](../settings.md#batch-database-update)
- [Common library package boundary](2026_07_common_library_package_boundary.md)
- [Fast Fetch persistence and completion](2026_08_fast_fetch_persistence_and_completion.md)
- [Two-device Batch save reproduction](../../test/e2e-obsidian/scripts/issue1207-livesync-batch.ts)
- [Commonlib event manager at the investigated revision](https://github.com/vrtmrz/livesync-commonlib/blob/aa54282937c20d3db7f43778d240feeb1586cced/src/managers/StorageEventManager.ts)
- [Commonlib Offline Scanner at the investigated revision](https://github.com/vrtmrz/livesync-commonlib/blob/aa54282937c20d3db7f43778d240feeb1586cced/src/serviceFeatures/offlineScanner.ts)
- [Commonlib file handler at the investigated revision](https://github.com/vrtmrz/livesync-commonlib/blob/aa54282937c20d3db7f43778d240feeb1586cced/src/serviceModules/ServiceFileHandlerBase.ts)
- [Commonlib scanner policy and stored event interpretation](https://github.com/vrtmrz/livesync-commonlib/blob/aa54282937c20d3db7f43778d240feeb1586cced/docs/offline-scanner.md)
- [Commonlib event admission and reflection contract](https://github.com/vrtmrz/livesync-commonlib/blob/aa54282937c20d3db7f43778d240feeb1586cced/docs/storage-events-and-reflection.md)
- [Existing equal-time provenance regression](https://github.com/vrtmrz/livesync-commonlib/blob/aa54282937c20d3db7f43778d240feeb1586cced/src/serviceFeatures/offlineScanner.provenance.unit.spec.ts)
