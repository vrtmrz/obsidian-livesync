---
date: 2026-11-08
commonlib-version: "0.4.0"
self-hosted-livesync-version: "1.0.46"
status: accepted
---

# Architectural Decision Record: Retry Failed Local File Operations

## Status

Accepted on 2026-11-08. Implemented in Commonlib and initially verified through
an exact packed candidate. The version fields retain the original reviewed
baseline.

Publication note (9th November, 2026): The implementation is published in
[Commonlib 0.4.1](https://github.com/vrtmrz/livesync-commonlib/releases/tag/0.4.1).
The Self-hosted LiveSync 1.0.47 source pins that exact registry version; see
the [release notes](../../updates.md#1047).

This decision extends [local file save completion and batching](2026_10_local_file_save_completion_and_batching.md)
with finite retries during the same application session. Its durable completion,
finite flush, revision provenance, and restart recovery requirements remain in
force. This is separate from the earlier decision's deferred batching and
coalescing work.

## Context

[Issue #1331](https://github.com/vrtmrz/obsidian-livesync/issues/1331) reports an
atomic writer creating a temporary file and renaming it before Self-hosted
LiveSync reads its content. The read fails with `ENOENT`. The failed operation
remains pending, and every later replication request is refused until Obsidian
restarts. The report also observes that **Apply pending changes now** does not
recover the running session.

Commonlib 0.4.0 retains the operation correctly, but its completion promise also
permanently records the failed attempt. A later flush observes that same result.
A subsequent event for the same path depends on the failed operation and stops
before its own handler runs. Unrelated paths can still reach their handlers.
The failure therefore affects local database progress as well as the readiness
check before communication.

Reproduction against the original manager confirms repeated flush failure,
retention of the failed event, and a later same-path edit inheriting the failure.
A newly constructed manager can replay the saved intent. These controlled tests
do not measure the frequency of the timing window or establish irretrievable
content loss. Controlled read-failure injection in Obsidian 1.12.7 verifies
same-session recovery and restart with the candidate build. The natural timing
of the reported Flatpak Obsidian 1.15.0 workflow remains unverified.

### Local persistence and communication

An ordinary file operation records a change in the local database. Replication
subsequently transfers database revisions. These are different completion
boundaries:

| Situation | Required behaviour |
| --- | --- |
| A local database save succeeds, and Obsidian closes before replication | Keep the saved database revision for later replication. Being unsent does not by itself require replaying the file event. |
| A local save fails, and Obsidian closes before replication | Preserve the pending intent. On restart, replay it against current storage and reconcile the Vault before ordinary operation resumes. |
| The file changes again during the same session after a failed save | Re-evaluate the related failed predecessor and process the current file without requiring a network request or restart. |
| A temporary file disappears and receives no further events | A later finite flush must be able to re-evaluate its failed save, allowing the remaining operations to progress. |

An event snapshot records intent, not a backup of every intermediate editor
buffer. If a failed save of content B is followed by a saved file containing C,
reconciliation uses current content C and the applicable revision provenance.
There is no requirement to manufacture a separate revision for every unsaved
intermediate state. Content already stored in the database and required ancestry
remain subject to the existing preservation contract.

## Decision

Retain a failed ordinary file operation, report the failed attempt, and allow a
later existing trigger to re-evaluate it against current storage, database state,
and provenance. Apply this to `CREATE`, `CHANGED`, `DELETE`, and `RENAME`.

Keep Hidden File Sync, Customisation Sync, and other optional or internal
providers under their existing owning contracts. This decision does not add a
new provider retry policy, snapshot format, persistent journal, cross-store
transaction, timer, or setting.

### Existing triggers and ownership

The host already supplies the required entry points:

| Trigger | Existing route | Responsibility |
| --- | --- | --- |
| Start-up | Database initialisation → Vault scan → `restoreState()` | Keep the existing saved-event replay before normal watching. |
| A new ordinary file event | Vault create/modify/delete/rename → `appendQueue()` → `processFileEvent()` | Re-evaluate failed predecessors associated with the path or the rename's related paths. |
| Replication preparation | Readiness check → `commitPendingFileEvents()` → `waitForIdle()` | Complete a finite local boundary before network and remote preparation. |
| **Apply pending changes now** | `commitPendingFileEvents()` → `waitForIdle()` | Use the same local boundary without requiring communication. |
| Orderly shutdown | `onBeforeUnload` → `stopWatching()` | Stop admission, drain or retain accepted work, and persist the resulting pending record. |

File-open, window visibility, and settings-application paths also call
`commitPendingFileEvents()` under their existing conditions. File-open flushes
precede the `syncOnFileOpen` decision. They share the manager's implementation;
they do not acquire separate retry rules.

The event manager owns the operation, its attempts, dependencies, and snapshot
completion. A retry added only to the downstream file handler cannot recover a
successor rejected before that handler is invoked. `onStorageFileEvent()` is a
counter update, not an extensible recovery callback.

The readiness hook applies when a replication operation starts. It does not
pause every write of a continuous replication which is already running.
Existing revision and incoming-reflection guards remain necessary.

### Operations and attempts

Keep the operation's durable identity until its effect is accounted for and the
completion snapshot is saved. Give a new attempt a new result and completion
promise. An earlier caller continues to observe its original failure; changing
the current attempt must not rewrite the result of a completed call.

A finite flush captures accepted work, including admissions already under way,
and the attempts it will await. It may start one new attempt for each eligible
failure present at that boundary. It does not repeatedly retry failures produced
by its own attempts. Concurrent requests share an attempt already running, and
later events cannot indefinitely extend the captured work.

A new event re-evaluates only its related failed predecessors and necessary
dependencies. It does not retry every failed file in the Vault. Preserve the
ordering of deletion and rename operations. Their sentinel waits only for
predecessors, never for itself or successors. Do not make a predecessor depend
on a later deletion in order to declare the predecessor successful.

Completion belongs to the exact operation and attempt which produced it. An
older result cannot remove a later event for the same path. A failed snapshot
write leaves the operation recoverable, even when its database effect has
already succeeded.

Marking completion, saving its snapshot, and rolling back a failed completion
belong to the same serialised snapshot step. Otherwise, a neighbouring snapshot
could capture a provisional completion and later erase an operation whose own
save failed. Admission failures must also settle an active handler before a
replacement attempt can begin; reporting failure must not leave an old handler
free to complete against its replacement's ownership.

`StorageEventManager` remains the host-facing facade. Responsibility modules
under `StorageEventManager/` separate host notification conversion, event admission, batching, retry
application, queue dispatch, handler execution, snapshot persistence, and
in-memory ownership. Pure functions plan attempts, predecessor relationships,
and snapshot contents; effectful functions receive explicit state and the
callbacks they need. Applying a retry plan and starting its attempts belong to
the retry module, keeping traversal out of the facade.

The facade preserves its public and protected integration boundaries. Callbacks
resolve current settings and overridden methods when called, so extracting a
function does not capture stale configuration or bypass a host implementation.
Fancy-kit's `withSemaphore()` and `withLock()` own permit and keyed-lock release
around handler execution. `shareRunningResult()` joins concurrent dispatches
using a stable key for each manager. Snapshot persistence keeps its serial
promise chain, including its initial microtask boundary and failure rollback.
These changes preserve the retry and completion policy above.

`ServiceFileHandlerBase.ts` also retains its public class and import path, with
responsibility functions under `ServiceFileHandlerBase/`. Saving, deletion,
rename, incoming reflection, provenance, current-state selection, scanning, and
chunk repair have separate implementation boundaries. The facade retains service
references captured at construction and the existing dynamic host method calls.
Internal operations reuse the caller's document locks, and deferred conflict
hooks run after those locks are released. Reflection keeps its final storage
revalidation with the destructive operation. This split adds no persistent state
and preserves branch-selection, completion, and bounded-recheck policies.

### Re-evaluate current state

Use the existing restored-event reconciliation rules for retries. Reuse their
current-state decisions, rather than invoking whole-manager snapshot restoration
on a live manager. Start-up restoration constructs ownership before watching;
its buffer replacement is not a runtime retry mechanism.

The retry's reconciliation request is transient and accompanies that handler
invocation only. A dedicated `ReconcileFileEvent` type carries the requirement:
`createReconcileEvent()` creates it, and `isReconcileEvent()` narrows the handler's
input. Its marker belongs to the definition module. The manager continues to
persist the original event, preserving the existing snapshot schema and
compatibility with saved intents.

For an ordinary content event, an absent current file can make its old save
unnecessary under the existing policy. The event's completion does not itself
delete an earlier database entry. Following deletion, rename, and final-path
save intents retain their own ownership and required effects.

Check completed and partially completed database effects before repeating them.
A completed rename can reconcile a newer target edit. A target which already
exists while the source remains undeleted is not proof that this operation
created it; preserve the existing collision refusal. Likewise, a successful
Boolean from a deletion handler can mean that a recreated file was protected,
not that the old deletion occurred.

An unavailable read, permission failure, database failure, or provenance failure
remains a failed attempt unless current-state reconciliation establishes a
policy-approved result. Do not infer the failed stage from an `ENOENT` string:
the same code can arise after a database write or in a rename's target save.

### Preservation matrix

The classifications below express acceptance conditions, not a general licence
to ignore errors:

| Class | Meaning |
| --- | --- |
| A: guarded | Current files, necessary branches, and unresolved intent remain protected. An operation may remain pending. |
| B: idempotent | An already represented effect completes without changing content, deletion state, required history, or revision count. |
| C: additional revisions | Extra revisions are acceptable only with verified content and ancestry preservation and safe convergence. |
| D: deletion remains unmet | The existing conservative fallback retains content when the deletion's branch cannot be established. The deletion or move intent remains unmet and is passed to the existing conflict-check policy. |

| Operation and state | Expected result | Class |
| --- | --- | --- |
| Content acquisition failed; the file still exists | Read current bytes and apply the existing provenance policy. | A |
| A failed temporary-file save is now absent | Finish the obsolete save under the missing-file policy; retain subsequent deletion, rename, and final-file work. | A |
| Database and provenance are saved; only completion acknowledgement failed | Recognise the saved effect without another revision. | B |
| Database save succeeded before provenance; no remote descendant arrived | Preserve the content and required ancestry; the known duplicate-sibling case may add revisions before convergence. Repeating recovery after convergence adds none. | C, conditional |
| The same provenance gap includes a remote descendant | Preserve both relevant versions or their verified merged result and ancestry. Use manual conflict resolution when required. | A; not universally C |
| Deletion is not recorded, the source is absent, and its branch is known | Record the intended logical deletion on that branch. | A |
| Deletion is already represented | Keep the deletion without another revision. | B |
| The deleted path has been recreated | Protect the current file and retain its own save operation. | A |
| Deletion targets a conflicted document whose displayed source branch is unknown | Preserve the branches and use the existing conflict-check fallback. | D |
| Rename target acquisition fails or an unrelated target already exists | Preserve source and target; retain the unresolved operation. | A |
| Rename target was saved but source deletion is not represented | Continue only when ownership and branch conditions permit it; target existence or equal bytes alone are insufficient. | A |
| Rename target was saved but the conflicted source branch cannot be established | Preserve source branches through the existing fallback; the old path may remain. | D |
| Rename, including case-only rename, is already complete | Preserve the represented move without another revision; protect and reconcile any newer target edit. | B, with A for a later edit |
| Snapshot persistence fails | Retain the operation and retry the remaining effect or acknowledgement without losing newer ownership. | A |
| Permission or I/O failure continues | Finish the bounded attempt as failed and retain the work. | A |

D describes retained content with an unmet deletion, not successful fulfilment
of the requested operation. It is limited to the existing conservative branch
policy. Deleting newly recreated content is outside D and violates A. Neither
an empty queue nor automatic conflict resolution proves the preservation
requirements of C or D.

## Alternatives and consequences

- **Treat a missing file as success in the failing read:** a narrow rule could
  reduce the reported occurrence, but requires strict absence evidence from the
  correct storage identity. Vault index absence and permissive `stat` results
  can include other errors. It also does not recover existing failures or a
  same-path file recreated before the check.
- **Retry only failures known to precede a database write:** would require a
  phase-aware result through the current Boolean handler boundary, as well as
  the manager's attempt lifecycle. That extra classification is not required
  for the selected current-state reconciliation approach.
- **Let a later deletion clear the failed save:** a successful deletion Boolean
  can be a protective skip, and making the predecessor wait for its successor
  conflicts with the sentinel's ordering. Re-evaluate the predecessor directly.
- **Retry only before communication:** handles replication readiness but leaves
  later local edits blocked while no communication is requested.
- **Require restart:** uses existing recovery but interrupts ordinary work and
  leaves **Apply pending changes now** unable to recover the current session.
- **Automatically retry until success:** has no finite completion in a persistent
  failure and can repeat expensive reads, writes, and logs without new evidence.

A transient failure can delay synchronisation until a subsequent trigger.
Re-evaluation adds reads, database comparisons, and snapshot writes. The field
frequency and runtime cost are unmeasured. The implementation cost lies mainly
in correct attempt ownership, finite dependencies, and partial-success recovery.

The database write and provenance write remain separate operations. Their
[known interruption window](../specs_conflict_resolution.md#known-potentially-problematic-behaviour)
can produce duplicate branches or a preserved manual conflict. Recovery does
not promise automatic merging of all edits.

Obsidian's synchronous unload callback does not guarantee completion of
asynchronous work. Safety continues to depend on continuously persisted intents,
saved Vault content, and start-up reconciliation. No guarantee is added for
content the host never saved or events it never delivered.

## Verification and publication

Before changing production code, establish failing regression tests for recovery
within the same manager. Preserve the original temporary-file sequence and the
same-path subsequent-edit case. Verify bounded persistent failure, overlapping
flushes, later admission, deletion and rename ordering, snapshot failure, and
restart during recovery.

Use the real file handler and database where needed to check current content,
revision history, completed rename replay, and same-path recreation. Manager
mocks alone cannot establish those effects. Existing restored-handler tests are
useful evidence, but do not prove the new runtime attempt lifecycle.

Build and verify the Commonlib package, then validate the exact tarball through
Self-hosted LiveSync's consumer checks. Record real Obsidian atomic-write and
restart evidence separately. Update the exact consumer dependency when the
corresponding package is available, and retain the reviewed baseline and
publication status above.

Local verification on 2026-11-08 passed Commonlib's type, unit, package-boundary,
and packed-package checks, followed by Self-hosted LiveSync's clean-install,
type, lint, unit, build, and compatibility checks with that candidate. Existing
lint warnings in unchanged consumer sources remain outside this change.

After the responsibility split on 2026-11-09, Commonlib's type, unit, boundary,
and packed-package checks passed again, followed by consumer and application
type checks, the production build, the three real Obsidian scenarios, and
compatibility checks. Focused tests also verify that pure plans leave existing
ownership unchanged and that the facade preserves live settings, overridden
methods, and adapter receivers. Subsequent watcher checks preserve context,
delete conversion, and the rename-specific processing route. A type contract
also verifies that adapter file and folder types remain distinct and that file
conversion does not receive a value narrowed to `never`. The function TSDoc
records these contracts, including internal helpers and their state changes.

The subsequent file-handler split and same-named implementation directories
preserve the public facade imports. Compiler comparison confirms the handler's
public API, and characterisation tests passed against both the previous and
extracted implementations. These tests cover captured services, dynamic host
methods, callback receivers, deferred-hook error precedence, and bounded chunk
repair. The complete Commonlib and consumer checks, including the three real
Obsidian scenarios, passed with the extracted implementation. Final TSDoc-only
corrections preserve the tested package's runtime bytes and declaration syntax.

Registry-package verification on 2026-11-09 passed clean installation with npm
10 and npm 11, the complete consumer checks and unit tests, WebApp and WebPeer
builds, and all 19 CLI E2E tasks under Node.js 26. The published Commonlib 0.4.1
files matched the installed package. The 12 focused database-text assertion cases
and all three real Obsidian scenarios also passed with that registry installation.

The [real Obsidian scenario](../../test/e2e-obsidian/scripts/local-file-retry.ts)
uses ordinary Vault events and targeted read failures. It verifies a failed
temporary read followed by rename recovery, a retained same-path successor
saving the latest bytes while an earlier read is held, and local recovery after
closing and reopening the same isolated Vault and profile without replication.
Assertions check plain database content and its datatype, exact Vault content,
pending ownership, and revision history. The restart scenario verifies the
combined start-up result; it does not isolate snapshot replay from the ordinary
Vault scan. Snapshot replay itself is covered by Commonlib's dedicated
[manager](https://github.com/vrtmrz/livesync-commonlib/blob/88641a27fb33f94a30381207c1ec28390f216a93/src/managers/StorageEventManager.unit.spec.ts)
and [database replay](https://github.com/vrtmrz/livesync-commonlib/blob/88641a27fb33f94a30381207c1ec28390f216a93/src/serviceModules/ServiceFileHandlerBase.replay.unit.spec.ts)
tests. Replication against a remote service and the natural atomic-writer timing
are outside this local verification.

## References

- [Issue #1331](https://github.com/vrtmrz/obsidian-livesync/issues/1331)
- [Local file save completion and batching](2026_10_local_file_save_completion_and_batching.md)
- [Conflict resolution and revision provenance](../specs_conflict_resolution.md)
- [Common library package boundary](2026_07_common_library_package_boundary.md)
