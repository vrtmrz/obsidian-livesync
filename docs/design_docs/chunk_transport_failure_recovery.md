---
date: 2026-11-16
commonlib-version: "0.5.0"
self-hosted-livesync-version: "1.0.50"
status: accepted
---

# Recover file reflection after a Chunk transport failure

## Status and purpose

Accepted on 16th November, 2026. The version fields identify the reviewed
baseline. The integrated implementation is unreleased and requires an
unpublished Commonlib package; the published 1.0.50 and Commonlib 0.5.0 do not
contain it. The integrated candidate adds request-boundary classification and local database recovery; integrated validation is recorded separately from the earlier candidate evidence below.

[Issue #1224](https://github.com/vrtmrz/obsidian-livesync/issues/1224) reports
ordinary start-up reflection failing before CouchDB becomes reachable. With
on-demand fetching, later replication can succeed without changing the affected
Metadata or retrieving its Chunks. The file then remains unapplied until another
scan. Controlled Linux Obsidian tests reproduced this on public 1.0.47 and 1.0.50
builds; the reporter's native iOS execution remains unconfirmed.

Offer one automatic recovery attempt after successful finite replication. Reuse
the received-result processor, its snapshot, and existing start-up notifications.
If recovery fails, retain the target for user review.

## Scope and existing owners

This design covers ordinary Obsidian start-up DB-to-Vault reflection and normal
received Metadata reflection when CouchDB on-demand Chunk retrieval fails because
of offline status or a transient transport error.

| Responsibility | Existing mechanism to extend or reuse |
|---|---|
| Identify the failed content read | Authoritative Commonlib retrieval and scanner results; expose per-attempt failure detail to these callers |
| Retain and deduplicate targets; execute recovery | [ReplicateResultProcessor](../../src/serviceFeatures/replication/ReplicateResultProcessor.ts), including its current document queue |
| Persist unresolved work | The same processor's `replicationResultProcessorSnapshot` |
| Decide when to retry | Successful completion of an existing finite pull, catch-up, or bidirectional replication which can deliver local data |
| Apply current content safely | Existing [reflection paths](file_write_and_reflection_paths.md), locking, and [provenance and conflict policy](../specs_conflict_resolution.md) |
| Present unresolved targets | Existing `onScanningStartupIssues`, actionable notice, dialogue, and Hatch inspection controls |

The scanner registers only an eligible DB-to-Vault content-read failure, not every
failed scan pair. Commonlib must supply a structured reason for that attempt;
`false`, `Load failed`, log parsing, or a shared 'last error' value is insufficient.
Keep this contract addition narrow and preserve unrelated callers.

Explicit Fetch/Rebuild, Hidden File Sync, Customisation Sync, history/Inspector
reads, other transports, and general file I/O recovery are outside this change.
Authentication, configuration, compatibility, cancellation, confirmed missing
Chunks, and unclassified failures do not enter automatic transport recovery.
Existing [Chunk omission retries](../adr/2026_07_chunk_arrival_quiescence.md),
including the #1227 behaviour, retain their current ownership and limits.

## State and retry limit

Retain one current unresolved record per document in the active local database:
document ID, target Metadata revision, ordinary entry kind, waiting/review state,
whether the automatic allowance was consumed, and a classified reason. Retain no
file bodies or secrets.

Waiting and review records are separate from runnable `queued`/`processing` work.
They hold no application activity, Wake Lock, or active queue count, and do not
delay start-up readiness.

| Event for the same unresolved revision | Result |
|---|---|
| First eligible transport failure | Retain as waiting, with one unused automatic allowance |
| A subsequent qualifying finite replication succeeds | Consume and persist the allowance, then enqueue one guarded recovery attempt |
| Recovery still cannot complete | Retain as needs review; later replication successes do not re-enqueue it |
| Confirmed application or completed existing policy hand-off | Remove this record; conflict review continues through its existing owner |
| New current Metadata revision | Re-evaluate that revision; an older attempt cannot alter its record |
| Explicit user retry | Attempt the selected current target once; failure remains reviewable without replenishing the automatic allowance |

Successful replication captures the eligible waiting set once. Concurrent or
repeated completion signals, reconnects, and re-registration of the same revision
cannot grant another allowance. This is one additional file-reflection attempt,
separate from retries inside an individual Chunk read. Ordinary start-up and
explicit scans keep their existing read behaviour.

The replication owner must expose actual successful finite completion through a
narrow existing lifecycle integration. A falling activity count, an online event,
acceptance of continuous replication, push-only success, or the recovery fetch's
own completion is not that signal. Add no polling, periodic recovery scan, or
retry timer. Without another qualifying completion, a waiting target remains
available for explicit user action.

## Persistence and safe execution

Extend the existing snapshot and its single owner; add no separate store or remote
Metadata fields. Older snapshots without the additional records restore as before.
Merge restored records with new start-up failures without resetting consumed
allowances. Persist only current unresolved targets, not a history of revisions.

The consumed allowance must be saved before recovery is dispatched. If saving
fails, do not start an unrecorded automatic attempt; retain the target in memory
and report that recovery state could not be saved. Durability across restart is
not guaranteed for an unsaved update. Snapshot writes must be ordered so that an
older write cannot undo consumption or resurrect cleared work.

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

- Both start-up and received-result failures recover through one qualifying
  successful finite replication, with unchanged target Metadata.
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
writes. Its private [ReflectionTargets](../../src/serviceFeatures/replication/reflectionTargets.ts)
instance owns retained targets, recovery-attempt markers, and the database
generation. Recovery markers are saved before dispatch and remain distinguishable
from ordinary work during restoration. Only the Obsidian host enables this
integration; CLI and browser hosts keep their existing behaviour.

The target owner issues an application scope before the document-lock wait.
Operation-boundary checkpoints consult that owner, while failure retention uses
its separate revision and target-identity rules. Ordinary scope creation does
not register failed work or consume an allowance. Reset and stop invalidate
application scopes; same-database reopening retains the existing pause/drain
behaviour. An obsolete scope ends its own operation without classifying that
exit as a database failure; actual I/O failures retain their identity. Scope
checks do not cancel started writes or replace the existing reflection policy.
The [single-document application](../../src/serviceFeatures/replication/applyReplicatedDocument.ts)
uses this scope without accessing mutable target maps or owning another queue.

Commonlib exposes per-read content failure detail through its existing retrieval,
file-access, reflection, and scanner paths. Its finite CouchDB replication owner
emits successful completion after cancellation checks, including a pull which
receives no changed documents. The host acknowledges this notification without
awaiting recovery inspection, allowing the producer's finite activity to end
before a dependent Chunk read releases its file lock. The host reuses the ordinary
scan policy for
scanner-origin recovery and existing reflection confirmation for retirement.
Neither recording a failure nor displaying the review list fetches Chunks.

The review command uses the existing dialogue and grouped notice helpers. The
same action is available beside Hatch's inspection controls. Waiting or running
targets do not produce a needs-review notice; dismissing a notice retains the
records, and restart allows the remaining issues to be presented again.

Package publication and adoption of an exact released Commonlib dependency are
pending. Local validation uses a packed candidate built from the Commonlib 0.5.0
baseline, without changing the registry dependency or the lockfile. A fresh
registry-only installation is therefore not the validated candidate.

## Earlier standalone candidate verification

The candidate passes Commonlib unit and package tests, LiveSync unit tests, type
checks, lint, production build, and iOS 15 syntax compatibility checks. Focused
regressions cover snapshot acknowledgement and ordering, restart without a renewed
allowance, overlapping success signals, newer revisions, conflict hand-off,
shutdown, and the review interface. These checks do not establish native iOS
behaviour.

Controlled Linux Obsidian execution with unchanged Metadata gave these results:

| Condition | Candidate outcome |
|---|---|
| Offline at the first start-up Chunk read, followed by successful finite replication | Exact file content reflected automatically before any manual scan |
| Native request API connection dropped while the device remains online | Still failed to recover automatically; a later manual scan restored the exact content |
| Successful response initially omits the Chunk, then the Chunk arrives | Existing omission retry completed reflection |

The earlier native request failure motivated the integrated request-boundary error contract below. These standalone results do not verify the integrated candidate.

## Integration with local database connection recovery

The integrated candidate retains ordinary received-file failures caused by a lost
local database connection in the same processor and snapshot. A known document
ID and revision are recorded without re-reading the failed database. Internal
failure notifications distinguish `RemoteRequestError` and
`LocalDatabaseUnavailableError`, retaining the original cause. Public PouchDB
errors and existing Boolean retrieval results keep their contracts.

A matching successful finite replication releases remote failures; successful
same-database connection recovery releases local failures. These signals share
one allowance for each unresolved revision. A change of failure reason or a
same-database reopen does not replenish it. Unstarted ordinary queued work resumes
without consuming this allowance. Explicit database reset remains a separate
lifecycle operation.

Recovery admission uses an instance-scoped `withLock`: capture eligible targets,
confirm current Metadata, reserve and persist the attempt, then enqueue it.
Content and provenance inspection run during execution and completion, rather
than twice at admission and execution. Existing file-processing concurrency and
write-time protection remain. A newer revision, reset, or unload still requires
identity checks after asynchronous work.

The receiver holds new dispatch and settles started operations, including their
retained failure records, before the connection is replaced. Local file changes
complete before the receiver resumes. Recovery notifications do not await the
retry from inside the producer, avoiding a lifecycle dependency cycle.

Snapshot restoration is not an additional global application-ready condition.
The review command and Hatch action use the same records for both failure kinds.
A matching success notification received while processing is suspended may wait
for a later matching success or explicit retry; no extra signal ledger or timer
is introduced.

See [local database connection recovery](local_database_connection_recovery.md)
for the connection owner and verification boundary. Integrated runtime and iPhone
verification remain distinct from the standalone results above.

## Integrated candidate verification

Controlled Linux Obsidian tests using the combined Commonlib candidate verify
automatic reflection after both an offline start-up and a native request
connection drop while online. After connectivity returns, successful finite
replication restores the exact file content before any manual scan, without
changing the target Metadata revision. The delayed-Chunk control also passes.
This replaces the earlier online-transport failure result for the integrated
candidate; it does not establish native iOS behaviour.

A separate real-receiver test closes the native local database connection during
a Metadata read. The received target is retained before reopening and is reflected
automatically afterwards, with matching content, revision, and provenance. Unit
tests cover the shared allowance, snapshot ordering, restart, concurrent revision
changes, and reset boundaries that these controlled runtime scenarios do not
exhaust.
