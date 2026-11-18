---
date: 2026-11-16
commonlib-version: "0.5.0"
self-hosted-livesync-version: "1.0.50"
status: accepted
---

# Recover incomplete file reflection

## Status and purpose

Accepted on 16th November, 2026. The version fields identify the reviewed
baseline (`1.0.50` with Commonlib `0.5.0`) rather than the release containing this
change. The revised integrated implementation is included in Self-hosted
LiveSync `1.0.51`, using
[Commonlib 0.6.0](https://github.com/vrtmrz/livesync-commonlib/releases/tag/0.6.0)
pinned in the manifest and lockfile, and has controlled Linux Obsidian
verification. Natural iOS connection loss and recovery on a physical iPhone
remain unverified. The historical results below are labelled by the earlier
candidate they exercised.

[Issue #1224](https://github.com/vrtmrz/obsidian-livesync/issues/1224) reports
ordinary start-up reflection failing before CouchDB becomes reachable. With
on-demand fetching, later replication can succeed without changing the affected
Metadata or retrieving its Chunks. The file then remains unapplied until another
scan. Controlled Linux Obsidian tests reproduced this on public 1.0.47 and 1.0.50
builds; the reporter's native iOS execution remains unconfirmed.

Retain one automatic recovery attempt for a current document/revision when the
resource required for its failed content read has recovered. Reuse the
received-result processor, its snapshot, and existing start-up notifications. If
the required resource cannot be confirmed, or recovery fails, retain the target
for user review.

## Scope and existing owners

This design covers ordinary Obsidian start-up DB-to-Vault reflection and normal
received Metadata reflection when required content cannot be read. Automatic
eligibility comes from the failed operation boundary's explicit resource facts,
not from an error name, message, or cause inspection.

| Responsibility | Existing mechanism to extend or reuse |
|---|---|
| Identify the failed content read | Authoritative retrieval and scanner results; carry the failed operation's `resources[]` and original error to the reflection owner |
| Retain and deduplicate targets; execute recovery | [ReplicateResultProcessor](../../src/serviceFeatures/replication/ReplicateResultProcessor.ts), including its current document queue |
| Persist unresolved work | The same processor's `replicationResultProcessorSnapshot` |
| Decide when to retry | Recovery of every resource recorded for the target, followed by the existing guarded admission and saved allowance |
| Apply current content safely | Existing [reflection paths](file_write_and_reflection_paths.md), locking, and [provenance and conflict policy](../specs_conflict_resolution.md) |
| Present unresolved targets | Existing `onScanningStartupIssues`, actionable notice, dialogue, and Hatch inspection controls |

The reflection owner retains an incomplete content read with its document ID,
revision, source, explicit resource list, and original error until its terminal
result is handled. A `resources[]` value may identify `remote`,
`local-database`, both, or no known resource. No resource, malformed resource
information, and other unclassified failures remain reviewable but are not
automatically retried. `false`, log parsing, and a shared 'last error' value do
not establish a failed resource. Keep this contract narrow and preserve unrelated
callers.

Explicit Fetch/Rebuild, Hidden File Sync, Customisation Sync, history/Inspector
reads, other transports, and general file I/O recovery are outside this change.
Authentication, configuration, compatibility, cancellation, confirmed missing
Chunks, and other explicitly handled outcomes retain their existing owners. A
failure without an explicitly recorded recovery resource remains reviewable and
does not enter automatic recovery.
Existing [Chunk omission retries](../adr/2026_07_chunk_arrival_quiescence.md),
including the #1227 behaviour, retain their current ownership and limits.

## State and retry limit

Retain one current unresolved record per document in the active local database:
document ID, target Metadata revision, ordinary entry kind, the remaining
`resources[]`, waiting/review state, whether the automatic allowance was
consumed, and a concise display reason. The resource list records the failed
operation boundary; do not derive it from an error name or cause. Retain no file
bodies, original errors, or secrets in the snapshot.

Waiting and review records are separate from runnable `queued`/`processing` work.
They hold no application activity, Wake Lock, or active queue count, and do not
delay start-up readiness.

| Event for the same unresolved revision | Result |
|---|---|
| First failure with a recognised resource | Retain as waiting, with that resource recorded and one unused automatic allowance |
| Failure with no recognised resource | Retain for review; it has no automatic eligibility |
| A recorded remote resource recovers | Remove `remote` only after successful completion of the existing finite pull or sync which can provide the required content |
| A recorded local-database resource recovers | Remove `local-database` only after same-database reopen and local recovery preparation succeed |
| All recorded resources recover | Consume and persist the shared allowance, then enqueue one guarded recovery attempt |
| Recovery still cannot complete | Retain as needs review; later replication successes do not re-enqueue it |
| Confirmed application or completed existing policy hand-off | Remove this record; conflict review continues through its existing owner |
| New current Metadata revision | Re-evaluate that revision; an older attempt cannot alter its record |
| Explicit user retry | Attempt the selected current target once; failure remains reviewable without replenishing the automatic allowance |

The resource recoveries are tracked separately and all recorded resources must be
ready before the single allowance is consumed. A remote success cannot release a
local-database dependency, or vice versa. For a target with both resources, both
must recover; the first success alone cannot dispatch a retry. Capture eligible
targets once when their last required resource becomes ready. Concurrent or
repeated completion signals, reconnects, and re-registration of the same revision
cannot grant another allowance. This is one additional file-reflection attempt,
separate from retries inside an individual Chunk read. Ordinary start-up and
explicit scans keep their existing read behaviour.

The relevant owners expose actual success through narrow existing lifecycle
integrations: successful finite replication for `remote`, and successful
same-database recovery preparation for `local-database`. A falling activity
count, an online event, acceptance of continuous replication, push-only success,
or a recovery fetch's own completion is not a substitute. Add no polling,
periodic recovery scan, or retry timer. Without every required recovery signal, a
waiting target remains available for explicit user action.

## Persistence and safe execution

Extend the existing snapshot and its single owner; add no separate store or remote
Metadata fields. Older snapshots without the additional records restore as before.
Merge restored records with new start-up failures without resetting consumed
allowances. Persist only current unresolved targets, not a history of revisions.

The consumed allowance must be saved successfully before recovery is dispatched.
If saving fails, do not start an unrecorded automatic attempt; retain the target
in memory and report that recovery state could not be saved. Durability across
restart is not guaranteed for an unsaved update. Snapshot writes must be ordered
so that an older write cannot undo consumption or resurrect cleared work. A
snapshot-save failure is a persistence failure, not a new content-read failure.

The key-value database owns its connection separately from the local Pouch
database. Recovery may replace either connection according to its owner, but it
must preserve saved target state and allowance. The presence of a KV handle does
not prove that a snapshot was saved; the processor requires successful completion
of its write before it dispatches the automatic attempt. A failed KV write is
reported and cannot be converted into successful retention.

Recovery-origin queued/processing items must be recognisable during restoration.
A consumed but unfinished automatic attempt becomes needs review after restart;
ordinary snapshot replay must not grant it another attempt. Unrelated ordinary
queued/processing work keeps its existing restoration behaviour. Reading the
snapshot itself performs no Chunk fetch and grants no allowance.

Before applying a target, re-read current Metadata, Vault state, and provenance
through the existing guarded reflection path. Respect target filters, local-only
retrieval, suspension, local edits/deletions, and conflict settings. Scanner-origin
recovery retains ordinary scan policy; using the processor must not elevate it to
forced Fetch. Saved Metadata and a saved force flag do not authorise an overwrite.
A provenance mismatch or missing record alone is not proof of failed reflection;
keep the scanner's last-seen map in its existing role.

Clear a record only after confirmed application or an explicit existing policy
disposition, such as handing preserved content to conflict review. A handler
Boolean alone does not establish that the Vault matches the database winner.
Retain inconclusive outcomes. Completion of an older revision must not clear or
reset a newer target. Confirmed local database replacement clears these records
through the processor's existing snapshot-reset lifecycle; failed replacement
must not silently discard them. Records belong to this device's local database
and are not replicated to other devices.

## Review at start-up and on demand

Restore after local KV/database readiness. Ordinary start-up work may resolve a
record; reconcile that result before presenting remaining issues. Register the
remaining review check with `onScanningStartupIssues`, following the existing
[conflict notification pattern](../../src/serviceFeatures/interactiveConflictResolution/operations.ts).

Show one actionable summary for needs-review targets. Its action opens a target
list with paths, concise reasons, and explicit retry using existing dialogue
helpers. Waiting and needs-review states remain distinguishable. Expose the same
action beside the existing Hatch inspection controls, so closing the notice does
not remove access. Retry selected targets through the guarded processor entry,
without running a full Vault scan or putting them into the conflict-merge queue.

Closing the notice hides that summary for the session and keeps unresolved
records. At the next start-up, notify again if they remain. Update or remove an
open summary when targets resolve, coalesce duplicate notices, and keep ordinary
editing and start-up independent of acknowledgement.

## Acceptance checks and remaining limits

Retain the failing public-build reproduction and focused regression coverage for
these behaviours:

- Both start-up and received-result failures recover only after every recorded
  resource is ready: remote failures after successful finite replication, local
  database failures after same-database recovery preparation, and mixed failures
  after both. Reflection preserves the selected target Metadata.
- Repeated success signals and failed recovery produce at most one automatic
  re-enqueue for the same unresolved revision; waiting/review retains no activity.
- Restart after allowance consumption cannot replay that automatic attempt;
  failed snapshot writes prevent dispatch and expose the persistence failure.
  Concurrent old/new revisions and database reset preserve the correct ownership.
- Local edits/deletions and suspension/filter/conflict policies retain existing
  protection; policy hand-off is distinguished from successful application.
- Review survives dismissal and restart, remains accessible on demand, and clears
  only on a confirmed disposition. Existing delayed-Chunk omission tests pass.

The deliberate limit is one recovery opportunity: another disconnection can leave
manual review necessary. No additional settings, general retry service, Chunk
arrival index, or notification framework is introduced. Native iPhone verification
remains outstanding.

## Implementation and publication

The existing processor owns the runnable document queue and serialised snapshot
writes. Its private [ReflectionRecoveryState](../../src/serviceFeatures/replication/reflectionRecoveryState.ts)
instance owns retained targets, recovery-attempt markers, and the database
generation. Recovery markers are saved before dispatch and remain distinguishable
from ordinary work during restoration. Only the Obsidian host enables this
integration; CLI and browser hosts keep their existing behaviour.

`ReflectionRecoveryState` owns retained reflection identity, validity, and the one-use allowance.
The resource scope owns only the lifetime of one application: it releases that
operation's resources, listeners, and running marker and awaits asynchronous
cleanup. These scopes are composed, not merged. Scope invalidation does not
cancel a started write or change which Metadata revision is selected. An
obsolete target cannot update a newer target after asynchronous work. Cleanup
failure is not reclassified as a content-read failure, and failure to save the
retained target is returned to the owner rather than hidden by cleanup. The
[single-document application](../../src/serviceFeatures/replication/applyReplicatedDocument.ts)
uses this scope without accessing mutable target maps or owning another queue.

The operation owner propagates a required read failure to the reflection owner,
which retains the target and awaits its ordered snapshot save. Intermediate
layers do not infer a resource by scanning an exception name or nested cause, or
convert the terminal exception into a callback/false result and then try to
reconstruct it. Existing lifecycle events remain where their source has no
awaiting call stack. A finite CouchDB replication completion acknowledges only
the `remote` resource; same-database recovery preparation acknowledges only the
`local-database` resource. Notifications do not await a retry from inside a
producer. The host reuses the ordinary scan policy for scanner-origin recovery
and existing reflection confirmation for retirement. Neither recording a
failure nor displaying the review list fetches Chunks.

Shutdown waits for all already-started reflection applications, failure
retention, and snapshot saves before the existing key-value shutdown flush. It
does not treat invalidating an operation scope as proof that a started write has
settled. The existing scanner policy, conflict protection, and target selection
remain in force.

The review command uses the existing dialogue and grouped notice helpers. The
same action is available beside Hatch's inspection controls. Waiting or running
targets do not produce a needs-review notice; dismissing a notice retains the
records, and restart allows the remaining issues to be presented again.

Commonlib 0.6.0 is published and adopted through the exact registry dependency
and lockfile. The reviewed Commonlib 0.5.0 and Self-hosted LiveSync 1.0.50
version fields retain their historical baseline; the host integration is
included in Self-hosted LiveSync 1.0.51. Historical runtime results retain the
candidate revisions they exercised.

## Previous standalone candidate verification

The previous standalone candidate recorded passing Commonlib unit and package
tests, LiveSync unit tests, type checks, lint, production build, and iOS 15 syntax
compatibility checks. Its focused regressions covered snapshot acknowledgement
and ordering, restart without a renewed allowance, overlapping success signals,
newer revisions, conflict hand-off, shutdown, and the review interface. These
results are historical evidence for that candidate; they do not verify the
revised integrated design or establish native iOS behaviour.

Controlled Linux Obsidian execution with unchanged Metadata gave these results:

| Condition | Candidate outcome |
|---|---|
| Offline at the first start-up Chunk read, followed by successful finite replication | Exact file content reflected automatically before any manual scan |
| Native request API connection dropped while the device remains online | Still failed to recover automatically; a later manual scan restored the exact content |
| Successful response initially omits the Chunk, then the Chunk arrives | Existing omission retry completed reflection |

The earlier online-transport failure motivated the previous integrated
candidate's request-boundary approach. These standalone results do not verify
the revised integrated design described below.

## Revised integration with local database connection recovery

The revised design retains ordinary received-file failures in the same processor
and snapshot. It records the known document ID, selected Metadata revision,
source, and operation's `resources[]` without re-reading a database that already
failed. A failure with no known resource is retained for review. Do not classify
using `RemoteRequestError`, `LocalDatabaseUnavailableError`, public PouchDB
error names, message text, or nested `cause`. Any wrapper used at an operation
boundary carries only its directly observed resource and original `cause`; it
does not introduce cause scanning as a recovery rule. Existing public PouchDB
and Boolean facade contracts remain unchanged, with internal terminal exceptions
reaching the reflection owner.

The local database owner checks its current initialised Pouch database through
`canReadCurrentDatabaseInfo()`. An actual failure from a current-owner database
operation requests this probe; that operation error alone does not declare the
connection lost. A successful probe does not reopen the database. If the probe
fails, the owner performs one finite recovery of the same selected database,
subject to its existing lifecycle lock and identity check. The host does not
construct a new Pouch database to test availability or patch public Pouch
methods. A successful finite replication releases only `remote`; successful
same-database reopen and local recovery preparation release only
`local-database`. A target which requires both resources waits for both. They
share one persisted allowance for each unresolved revision. A different error
reason, a reconnect, or a same-database reopen alone does not replenish it.
Unstarted ordinary queued work resumes without consuming this allowance.
Explicit database reset remains a separate lifecycle operation.

Recovery admission captures the eligible targets, confirms the selected current
Metadata revision, reserves and successfully persists the attempt, then enqueues
it. An explicit user selection is not silently redirected to a newer revision.
Content and provenance inspection run through the guarded reflection path;
existing file-processing concurrency and write-time protection remain. A newer
revision, reset, or unload invalidates obsolete target work without allowing it
to clear or replace a newer target.

The receiver holds new dispatch and settles started operations, including
exception propagation, retained failure records, and snapshot saves, before the
connection is replaced. Local file changes complete before the receiver resumes.
Recovery notifications do not await the retry from inside the producer, avoiding
a lifecycle dependency cycle. The KV database owns its connection independently;
successful snapshot save, rather than a handle's existence, gates automatic
dispatch. Snapshot restoration is not an additional global application-ready
condition. The review command and Hatch action use the same records for both
failure kinds, and an unmatched or suspended recovery signal does not create a
new allowance or timer.

See [local database connection recovery](local_database_connection_recovery.md)
for the connection owner and verification boundary.

## Previous integrated candidate verification (historical)

The previous integrated candidate had controlled Linux Obsidian results for
automatic reflection after an offline start-up and a native request connection
drop while online. After connectivity returned, successful finite replication
restored the exact file content before any manual scan, without changing the
target Metadata revision. The delayed-Chunk control also passed. This historical
result superseded the earlier standalone candidate's online-transport failure
for that previous integrated candidate. It does not verify the revised design or
establish native iOS behaviour.

A separate real-receiver test for the previous integrated candidate closed the
native local database connection during a Metadata read. The received target was
retained before reopening and reflected automatically afterwards, with matching
content, revision, and provenance. Unit tests for that candidate covered its
shared allowance, snapshot ordering, restart, concurrent revision changes, and
reset boundaries. These results describe the previous candidate only.

## Revised implementation verification

With the same combined Commonlib package (included in Self-hosted LiveSync 1.0.51), controlled Linux Obsidian tests pass
for offline start-up, a connection drop while online, and delayed Chunk arrival.
For both outages, the initial scan reports `completed-with-file-failures` and
leaves the file without successful provenance. After connectivity returns and
finite replication succeeds, the exact content and matching provenance are
present before any manual scan, with the Metadata revision unchanged. The
delayed-Chunk control completes through the existing bounded retrieval path.

The receiver test also passes after native local database close during a
Metadata read. The target is retained before reopening, then reflected with
matching content, revision, and provenance. Unit regressions cover mixed
resource failures, unknown failures, saved retry admission, snapshot failures,
stale targets, and asynchronous cleanup.

The matching Commonlib APIs are published in version 0.6.0 and pinned in this
repository. These tests use controlled failures; natural iOS connection loss
and recovery on a physical iPhone remain unverified.
