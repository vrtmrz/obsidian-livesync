---
date: 2026-11-10
commonlib-version: "0.4.1"
self-hosted-livesync-version: "1.0.47"
status: accepted; published in Self-hosted LiveSync 1.0.48 with Commonlib 0.4.2
---

# Recover unapplied database deletions during an ordinary scan

## Status and purpose

Accepted on 10 November 2026 after the content-preservation, Fetcher-policy,
startup integration, and three-file concurrency review. Commonlib implementation
is published in
[0.4.2](https://github.com/vrtmrz/livesync-commonlib/releases/tag/0.4.2).
The Obsidian integration consumes that exact registry version and is published in
[Self-hosted LiveSync 1.0.48](https://github.com/vrtmrz/obsidian-livesync/releases/tag/1.0.48).
The reviewed versions describe the
baseline, not a release containing this recovery. Historical review findings and measured
baseline calls remain below; implementation verification is tracked separately.

The [current write-path reference](file_write_and_reflection_paths.md) records
which entry points preserve content, what their completion means, and who retries
failed work. [Issue #1338](https://github.com/vrtmrz/obsidian-livesync/issues/1338)
exposes a gap after a received deletion reaches the local database but its Vault
reflection does not complete. The original iPhone failure remains unconfirmed.

An existing ordinary scan should apply a retained, newer deletion to a provably
unchanged file without Fetching the database again. It should also finish
associated provenance and last-seen cleanup after interruption. Preserving unique
local content takes priority over automatic convergence. Runtime storage access,
memory, and persistence overhead are design constraints.

## Recommended scope

Add this policy to ordinary `NEWER_WINS` with no explicit extra policy. Reuse the
scanner's collected pairs and existing last-seen map. Let `N` be the selected
pairs already examined by the scan. Distinguish:

- `K`: selected ordinary files paired with valid, retained logical-deletion
  Metadata, no conflicts, and a deletion newer under the existing freshness
  comparison. Freshness selects candidates; it never proves unchanged content.
- `D`: selected paths with valid, retained logical-deletion Metadata and no Vault
  file or conflicts. These are candidates for bookkeeping cleanup only.
- `P`: existing provenance keys in the device-local namespace. When `D` is
  non-empty, obtain these keys once, without reading their record values or file
  bodies. `A` is the subset of `D` with a provenance key or last-seen entry.

`K` and `A` share normal target, identity, and suspension checks. Equal-time or
storage-newer present files retain the existing conservative policy. Logical
deletions removed by retention or already absent from normal Metadata enumeration
remain outside this scope; the proposal does not change retention order.

The extra key enumeration is an explicit change from the initial present-file
proposal. It discovers interrupted cleanup without a durable retry journal.
There is no additional Vault listing, Metadata traversal, or historical-revision
search. Pairs outside `K` and `A` incur no added body reads or persistent writes;
the provenance key enumeration still has a cost proportional to `P`.

Commonlib owns shared comparison, document locking, reflection, and scanner
policy. The Obsidian host supplies complete, namespace-scoped provenance key
enumeration through its existing key-value store and presents scan results.
The current provenance interface has no enumeration method: exposing this
capability is part of the proposed work. It must use keys only and the correct
namespace bounds, rather than a general database scan or the current store
wrapper's default empty range. This capability does not add a stored index.
Other hosts retain their existing behaviour until they supply and verify it.

## Proposed outcomes

The implementation models these observations as named subtypes of
`DeletionRecoveryResult`, rather than an unrestricted product of status fields.
Only an absent file with cleared provenance can be applied. Pending cleanup and
unknown removal effects retain retry evidence; a protected edited or unprovable
file need not converge automatically. The subtype table is recorded in Commonlib's
`docs/deletion-recovery.md`, included in published Commonlib 0.4.2 and adopted by
Self-hosted LiveSync 1.0.48.

Represent file effect, bookkeeping, and reason separately. For example, the file
can be unchanged, confirmed absent, or unknown after an error; provenance can be
unchanged, cleared, or pending. Scanner-owned last-seen persistence has its own
completion result. A Boolean cannot express these boundaries.

| Observed state | Required automatic recovery result |
| --- | --- |
| Recorded evidence matches the present file and final checks agree | Remove the file, confirm absence, attempt provenance cleanup, and remove its in-memory last-seen entry. Report complete only after the required persistence succeeds. |
| No provenance record, unprovable origin, or differing content | Defer without changing the file, provenance, or database tree. Preserve ordinary observation bookkeeping. |
| Provenance, base retrieval, or verification I/O fails | Report the phase and failure, rather than treating the error as a missing record. Do not delete on incomplete evidence. |
| A conflict, restoration, replacement revision, or changed file is observed | Defer this attempt. Do not follow successive revisions or loop on the same path. |
| Removal fails and the file remains present | Report failure; the pair remains discoverable as a present-file candidate. Retain its provenance and observation bookkeeping. |
| The file is confirmed absent but provenance cleanup fails | Report physical completion with cleanup pending. Remove the in-memory last-seen entry; remaining provenance keys rediscover the cleanup on a later scan. |
| The file's state cannot be established after an error | Report an unknown file effect and retain bookkeeping. Reconcile current state on a later scan; do not infer absence from an exception. |
| A previously absent file still has bookkeeping | Revalidate the absent-file/deleted-Metadata pair under the document lock, then clear only its stale bookkeeping. Do not invoke physical deletion. |
| Only empty-parent removal fails | Report the file's actual result and a folder-cleanup warning. The empty folder does not make the file deletion incomplete, and this proposal creates no folder retry queue. |

The host reports applied deletions, conservative deferrals, failed verification
or removal, and pending bookkeeping separately in one scan summary. A skipped or
deferred file is not reported as converged. Detailed paths and reasons remain
available through diagnostics and existing inspection; emit no per-file notice
storm for a large backlog.

## Processing and ownership

### Read-only eligibility and final checks

Acquire the existing document lock before loading content. Do not call public
wrappers which reacquire that lock. Recheck the current target, file, winning
deletion, and conflicts after waiting for the lock, then read provenance strictly.
An error is distinct from an absent record. The new operation always requires
preservation, including when `writeDocumentsIfConflicted` is enabled; existing
incoming reflection and explicit overwrite choices keep their current policy.

Use the recorded-content comparison through a read-only boundary for file
Metadata and provenance. Normal cache updates and persistence of remotely
delivered Chunks remain owned by the retrieval pipeline and are included in
its I/O cost:

1. Missing provenance defers before a body read. A valid saved content size which
   differs from the observed file size may also defer cheaply. Size can reject
   automatic deletion, but cannot authorise it.
2. With valid saved hash evidence, read and hash the current file once. A mismatch
   defers immediately; it does not need old Chunks, live-leaf searches, branch
   creation, or provenance deletion to establish this decision. Hashing failure
   is a verification failure, not proof of a mismatch.
3. For a legacy record without usable hash evidence, try only its exact recorded
   base through the existing Chunk retrieval pipeline before loading the current
   file. Do not force `localOnly: true`, suppress remote requests, or disable
   delivery waiting merely because this is recovery eligibility. Respect the
   pipeline's existing settings, transport capabilities, and delivery lifecycle.
   A base unavailable after that policy settles defers; a distinguishable access
   failure fails.
   If the current database boundary conflates these cases, make that boundary
   explicit as part of this operation. Compare readable base bytes with one
   captured current body and release the base when classification finishes.
4. For a match, make one final fresh body read and compare it with the captured
   body. A changed path or raw mtime defers even if the bytes match; equal stats
   alone never establish equality. Recheck provenance, candidate freshness, and
   the same winning deletion and conflict state; a matching `_rev` alone does not
   rule out a newly arrived conflict. Perform the final path/type/target check
   and removal in the same reflection stage,
   without unrelated awaited work or falling back to forced deletion.

Reuse the actual content-evidence and equality rules. Do not call the full
`classifyStorageContent` or conflict-preservation fallback unchanged: those
helpers can mutate provenance or write branches. Keep their existing callers'
behaviour when extracting the observational comparison.

These checks are not a transaction across storage, replication, and provenance.
Document locks exclude competing file-handler operations, not external edits or
database replication. Preserve and test the final-check protection; do not claim
protection against every edit after the last observation. The two-read target
must not be met by removing a required protection.

### Physical deletion and provenance cleanup

The shared storage responsibility must expose the file effect separately from
selection no-ops and empty-parent cleanup. A resolved `deleteVaultItem` call alone
does not prove removal. Confirm the target is absent through a fresh storage
lookup, including after an error, before acknowledging removal or clearing its
provenance. A replacement or recreated file prevents cleanup based on the old
observation. The lookup adds no body read; its real adapter cost is measured.

Attempt provenance deletion only after confirming absence, while still holding
the document lock and respecting the current deletion. Use an error-propagating
cleanup operation; the existing best-effort helper cannot express pending work.
Clearing provenance before file removal is rejected because interruption could
leave the remaining file without the evidence needed for safe recovery.

Do not roll back a confirmed file deletion merely because later bookkeeping
fails. Do not retry physical deletion to finish bookkeeping. Optional parent
cleanup retains the host's existing preferences, but its result is separate.

### Rediscovering cleanup after interruption

During pair preparation, compute `D`. If it is empty, skip provenance enumeration.
Otherwise, obtain the namespaced key list once and intersect it with the existing
pair and last-seen maps to construct `A`. Process these pre-existing absent-file
cases before starting new candidate deletions. A failed cleanup is attempted at
most once in this scan, without being immediately requeued.

For each path in `A`, acquire the document lock and freshly verify that the file
remains absent and the current database result is a conflict-free logical
deletion. Defer if a file, restoration, or conflict has appeared. Clear remaining
provenance when a key exists, and remove the last-seen entry after confirmed
absence even if provenance cleanup fails. The owner must not delete a new record
or file on the strength of an old enumeration alone.

This covers interruption after file removal but before either cleanup: provenance
keys or the persisted last-seen map supply the remaining evidence. If provenance
cleanup succeeded but map persistence did not, the old map entry identifies the
remaining work. If both are gone, there is no bookkeeping left to retry. No new
failure record, completion marker, journal, or queue snapshot is written.

If key enumeration fails, report maintenance failure and do not acknowledge that
cleanup as complete. Independently verifiable present-file work may proceed; a
later existing scan can retry discovery. These guarantees require retained
logical-deletion Metadata, successful future scans, and the required storage
capabilities. They do not extend to tombstone discovery or database reset.

### Last-seen correctness and persistence cost

Update the already loaded map in memory. A confirmed absent target removes its
entry; a deferred or still-present target retains ordinary observed-file mtime
bookkeeping and receives no successful-reflection timestamp. An unknown physical
outcome does not authorise clearing the entry.

Recovery must not call `clearOfflineScannerLastSeen` per path: that public helper
reads and writes the complete persisted map each time. Coalesce recovery changes
into the scanner's end-of-scan persistence, with no new per-path timer or write.
Await the ordered flush of the latest map, including previously queued writes,
before reporting bookkeeping completion. Capture the map inside the existing
serialisation boundary so that an older snapshot cannot replace newer changes.

The recovery policy schedules at most one additional final whole-map flush per
scan when necessary. Existing unrelated scanner writes remain separately counted.
Suppressing recovery's per-path persistence requests is part of this change;
merely using a one-second debounce during a long backlog does not meet this
budget. A flush failure produces an incomplete-bookkeeping result, not a claim
that removed files remain present. The next scan uses the persisted map and
provenance keys to reconcile the retained logical-deletion pairs again.

### Repeated deferrals and bounded work

Each candidate receives at most one attempt per existing scan. There is no new
timer, automatic full rescan, or same-session retry loop. A changed file may stay
deferred if no local event saves it; report that state and retain existing
inspection choices. This is preservation, not automatic convergence.

Allow at most three recovery file operations at a time per Vault, including
waiting for their document locks and Chunk delivery. Acquire the shared recovery
permit before the document lock and before loading or reconstructing bodies;
release it in every completion, deferral, failure, and cancellation path. Share
this cap across overlapping recovery invocations for the same Vault. Recovery
occupies the scan's existing worker slots: do not add three workers on top of the
reviewed scanner's ten. Other scan paths retain their existing limit.

Use a continuously replenished pool: when one operation finishes, start the next
eligible file without waiting for the other two. Do not process fixed groups of
three or introduce an ordered-result barrier. This allows small files to continue
while a large file waits for storage or remote delivery. Reuse the existing
bounded-concurrency primitives; no new scheduler or dependency is required.

Keep Fetcher's own request concurrency, spacing, and retry ownership unchanged.
Keep the shared content-hash semaphore unchanged too: it currently serialises
hash-buffer allocation and hashing. Three file operations allow overlap around
those boundaries; they do not promise three simultaneous hashes or continued
progress if a shared dependency itself stalls.

Release bodies between candidates and do not preload queued files. Honour
existing suspension/cancellation boundaries between attempts, and do not cache a
destructive eligibility decision by path, mtime, or size. No persistent or
session-wide negative cache is proposed.

The choice deliberately accepts a repeat cost for deferred content on later
scans. Valid size mismatches and missing evidence avoid body reads; a hash mismatch
costs at most one current-body read per scan. For `r` scans of unchanged deferred
candidates, budget up to `r * sum(S_deferred)` additional logical current-body
bytes, plus any exact legacy-base retrievals, remote delivery, and Fetcher-owned
retries. One recovery attempt is not a limit on Fetcher attempts. If this exceeds measured device
limits, reconsider scheduling or a safe deferral cache as a separate decision;
do not hide that trade-off behind the successful-deletion read count.

### Chunk retrieval policy and the start-up boundary

The eligibility operation must delegate missing-Chunk handling to the existing
[retrieval policy](chunk_retrieval_and_waiting.md) and its
[accepted lifecycle contract](../adr/2026_07_chunk_arrival_quiescence.md).
`localOnly: true` currently forces both `preventRemoteRequest: true` and
`waitForDelivery: false`; it would bypass delivery even when the ordinary policy
could obtain the required Chunks. The earlier proposal's unconditional local-only
restriction is withdrawn following user review. This changes the proposed
recovery, not the recorded Commonlib 0.4.1 reflection baseline.

For CouchDB, direct retrieval is available when `useOnlyLocalChunk` is false,
independently of `readChunksOnline`. Other transports and suppression settings
retain their established policy, including waiting for an already-observable
finite producer where permitted. Use the normal delivery-waiting read; do not
change a global setting, start another replication, call the remote directly,
or introduce recovery-specific arrival deadlines or missing-result retries.
Local absence is not proof of remote absence. Issue
[#1224](https://github.com/vrtmrz/obsidian-livesync/issues/1224) is a related timing
precedent: Metadata can become visible before its Chunks, so the delivery owner
must finish its retry and completion policy before the read is abandoned.

Integrate recovery into the same ordinary start-up scan. Reuse its collected
pairs, run pre-existing absent-file cleanup before new recovery attempts, and
include candidate processing and the final map flush in that scan's completion.
This is not a second concurrent Vault/Metadata scan. Restored local work keeps
its existing ordering before pair collection. Normal non-recovery pairs retain
their existing bounded processing; recovery operations use the shared
three-file cap within those scan slots.

The current `prepareDatabaseForUse` awaits `scanVault` before initialisation
handlers, pending-event commit, and `markIsReady`; the Obsidian host awaits that
initialisation before applying its normal synchronisation settings. Additional
recovery on this path can therefore delay LiveSync readiness. The word
'offline' identifies reconciliation of local database and Vault observations; it
does not prohibit the Chunk pipeline's existing on-demand delivery.

Use this workload model rather than a promised start-up time. The current ordinary scan skips these present-file deletion pairs, so
their verification and removal are additional work relative to current start-up.
The four-to-two comparison measures reuse versus the proposed handler, not a
speed-up over the existing scan:

`additional work ≈ key discovery + absent-file cleanup + sum(candidate work) + final map persistence`.

Candidate work includes body reads, hashing/comparison, current-state checks,
removal, and provenance cleanup. For legacy evidence, add exact-base assembly,
Fetcher queueing/throttling, remote delivery and local Chunk persistence, and any
retry/waiting time. Some normal scan work may overlap; shared resource contention
can also change its duration. Measure the change in the actual start-up boundary
rather than equating the work sum with a precise wall-clock delay.

For illustration only, 1,160 candidates averaging 10 ms locally represent 11.6
seconds of serial work; at 50 ms they represent 58 seconds. With three equally
busy operations and perfect overlap, these become about 3.9 and 19.3 seconds of
candidate processing. These are hypothetical sensitivity examples, not iPhone
measurements or promises: the slowest file, storage contention, serial hashing,
Fetcher limits, key discovery, cleanup, and final persistence can dominate.

A missing first remote response can introduce the Fetcher's two-second retry;
active finite delivery can extend the wait further. There is no fixed total
arrival deadline, and the five-minute inactivity fuse is not a five-minute
start-up cap. Three file operations permit more cross-file request overlap, while
Fetcher still owns physical request concurrency and batching.

User review identified the head-of-line cost of a single large file, so the
previous one-file proposal is replaced by a three-file cap. This balances overlap
against the number of retained file snapshots; it is not a verified latency or
memory guarantee. Compare one and three operations with representative mixed-size
and remote-dependent backlogs. Do not obtain a faster start by silently disabling
permitted Chunk delivery or by adding an independent timeout.

## Existing access cost and proposed budget

A source trace and a small execution probe of Commonlib 0.4.1's actual
`applyDatabaseEntryToStorage` export establish the following stable successful
core path. The probe supplies synthetic storage, database, and provenance
boundaries, uses Node.js 24.18.0, and performs no real Vault I/O. It verifies
logical calls, not mobile latency, physical reads, cache effectiveness, or caller
preparation. No production code was changed for the probe.

| Core operation | Matching saved hash | Legacy record with readable matching base |
| --- | ---: | ---: |
| `readFileFromStub` | 4 | 4 |
| `getStub` | 4 | 4 |
| Provenance reads | 4 | 4 |
| Current Metadata reads | 1 | 1 |
| Conflict queries | 1 | 1 |
| Exact recorded-base body fetches | 0 | 1 |
| Vault deletions / provenance deletions | 1 / 1 | 1 / 1 |

The four current-body requests are the initial protection read, validation inside
protection, validation on returning to deletion, and final validation after the
current database revision check. Caller preparation adds work, and a database or
storage operation can contain several lower-level reads. A matching hash avoids
the old Chunk read pipeline; it still hashes current file bytes. The legacy
fallback reads the exact base using local-only Chunk retrieval.

For `K` stable deletions of sizes `S_i`, unmodified reuse of that core requests
`4K` Vault-body reads, representing `4 * sum(S_i)` logical file-body bytes before
Chunk reads, comparisons, hashing, adapter effects, and caches. For a backlog of
1,160 such files, that is 4,640 body-read requests. The report does not establish
all those file sizes, so it does not establish elapsed time or physical I/O.
The unchanged `N - K` pairs must not inherit these additional reads.

The proposed budgets below are acceptance targets, not measured performance of
an implementation:

| Scope | Additional work proposed |
| --- | --- |
| Neither `K` nor `D` exists | No added body reads, provenance enumeration, or persistent writes. |
| `D` exists, including a normally clean deleted-file backlog | One provenance keys-only enumeration of `P`; in-memory intersections; no record-value fetch for each healthy file. This cost occurs even when `A` is empty. |
| Missing provenance or valid size mismatch | No Vault-body read, no Chunk read, and no mutation from eligibility classification. |
| Valid hash mismatch | At most one Vault-body read and hash; no historical Chunk or live-leaf search and no preservation write. |
| Stable hash-matching deletion | Two current-body reads as the target; fresh database/provenance/storage checks; one file removal and one provenance deletion. No Metadata revision or Chunk write. |
| Legacy evidence | One reconstruction request for the exact recorded base per recovery attempt, using normal Chunk policy; remote reads, Fetcher retries, and fetched-Chunk persistence are possible. Add zero, one, or two current-body reads according to availability and comparison. |
| Previously absent cleanup, `A` | Fresh target/absence/database checks; provenance deletion only for a remaining key; no file-body read or physical file deletion. |
| Recovery last-seen changes | In-memory updates and a shared, awaited final map flush; no per-path whole-map persistence. |

The initial 1,160-file example would target 2,320 current-body requests for stable,
proven hash-matching deletions, compared with the measured core's 4,640. It does
not include key enumeration, verification lookups, provenance writes, parent
cleanup, or adapter internals, and it is not a prediction of elapsed time.

The three-file cap bounds admitted recovery operations, not memory to three file
sizes. Each operation may retain its captured and final bodies, or a legacy base;
comparison and hashing can allocate further whole-file buffers. Other scan work
and Chunk caches also consume memory. Do not preload waiting candidates. Apply existing
target-size rules and measure memory at the intended attachment sizes. Key
enumeration and the existing map also consume memory proportional to their keys.
A single keys-only call is not necessarily cheaper than targeted record reads
when `D` is small and `P` is large; compare that alternative in the device
measurements before accepting the discovery cost.

## Alternatives and implementation cost

| Approach | Consequences | Assessment |
| --- | --- | --- |
| Guarded candidate recovery, keys-only cleanup discovery, and coalesced bookkeeping | Changes shared read-only comparison, storage/result reporting, provenance capability, and scanner integration. Adds one conditional key enumeration and per-target verification; no persistent schema or journal. | Recommended proposed design. More work than a dispatch-only change. |
| Reuse ordinary non-forced reflection unchanged | Four body reads on the measured stable path; changed/unknown content can write branches; settings can bypass protection and cleanup errors can be hidden. | Does not meet this policy. |
| Read provenance separately for every absent deleted pair | Avoids the enumeration capability but adds one store read for every `D` path on every scan, including already clean deletions. | Simpler fallback with potentially large recurring call overhead; not the default proposal. |
| Persist a cleanup queue or completion marker | Can target retries, but adds writes, acknowledgement/interruption rules, bootstrap, and reset semantics. | Not justified before measuring keys-only discovery. |
| Clear provenance before deleting the file | Avoids stale provenance after deletion, but a failed/interrupted removal can leave a present file with no recovery evidence. | Rejected for this recovery policy. |
| Retain failed received items and retry existing triggers | Addresses future queue retention, not old failures already dropped. Requires separate outcome and snapshot ownership work. | Separate follow-up. |
| Requeue every document, add a full Vault/Metadata scan, or force-delete ordinary pairs | Broader work or loss of the required content protection. | Outside this design. Existing explicit Fetch/Inspector choices remain available. |

Implement Commonlib's small shared boundaries first, then scanner dispatch,
cleanup discovery, result aggregation, and persistence integration. The host
supplies the enumeration capability and summary. Keep old public wrappers and
their existing caller behaviour where possible; validate any shared extraction
against saving and incoming reflection tests. No new third-party dependency,
setting, translation, or retry timer is required by this proposal.

## Verification before accepting an implementation

1. Reproduce the current skip using a newer logical deletion, an unchanged file,
   known provenance, and no pending received snapshot. Confirm the expected
   failure on unmodified production code before implementing the fix.
2. Verify content and revision history, provenance, last-seen persistence, and
   restart using the real shared handler and database. No recovery-created
   Metadata revision or conflict branch is permitted for these attempts. Normal
   persistence of Chunks delivered by Fetcher remains permitted and is measured.
3. Inject interruption after physical removal, after provenance deletion, and
   before/after map flush. On restart, verify discovered cleanup and no repeated
   physical deletion. Test map flush failure, enumeration failure, strict
   provenance failure, selection no-op, and empty-parent removal failure.
4. Cover same-stat edits, missing/invalid/legacy evidence, pruned bases, conflicts
   arriving without a winning-revision change, restoration during verification,
   file recreation during cleanup, competing handlers, and database reset. A
   stale key enumeration must not delete a new file or its valid provenance.
5. Preserve explicit Fetch/Inspector choices, incoming policy, selectors, Unicode
   identity, quarantine, retention, and equal-time/storage-newer boundaries.
   Test permitted on-demand delivery, explicit suppression, both
   `readChunksOnline` settings, unsupported direct-fetch transports, delayed Chunk
   arrival, terminal absence, and transport failure. Startup waiting must not
   depend on work which can start only after the same scan has returned.
   Hosts without the new capability keep existing behaviour. Recheck existing
   save and reflection contracts after extracting shared comparisons.
6. Assert the operation budgets above, including clean retained deletions with
   `D > 0, A = 0`, `K = D = 0`, stable deletion, persistent deferral, and cleanup
   failure. Include a large `P` with only one absent deletion, so that the cost of
   key enumeration is not hidden by a large backlog. Count keys and bytes returned,
   record/Metadata/Chunk reads and writes,
   hashing, full-map serialisations, and physical adapter calls separately. Run
   repeated scans, not only a successful initial backlog.
7. Compare elapsed time, peak memory, responsiveness, and suspension recovery for
   representative notes and attachments with the same baseline and conditions.
   Include cold remote-dependent legacy bases, Fetcher backoff/throttling, and
   the actual boundary from `initialiseDatabase` to `markIsReady`. Separate
   scan/recovery time, remote wait time, and overall plug-in readiness.
   Compare the one-file baseline with the proposed three-file cap. Hold one
   operation at a controlled I/O or delivery boundary and require later small
   files to complete through the other slots. Also cover three large files,
   same-document serialisation, overlapping scans, permit release after failure,
   unchanged Fetcher/hash limits, and absence of a three-at-a-time batch barrier.
   Check that recovery does not expand the existing scan worker limit or preload
   waiting files. Mobile latency and memory acceptance require device
   measurements; the proposal does
   not invent acceptable timings from logical call counts. Unexpected whole-Vault
   body work, per-candidate map writes, or removed preservation checks fail the
   design budget regardless of a favourable timing result.

Validate Commonlib's exact packed artefact, then the pinned Self-hosted LiveSync
consumer and real Obsidian restart boundary. Physical iPhone suspension and
performance remain separate evidence requirements. The proposed state transitions
resolve the review's design questions; implementation and runtime acceptance still
require these tests and measurements.

## Design review before implementation

The original 10 November review identified the following gaps. This revision
records the agreed responses while retaining the baseline evidence. They are
implemented in the then-unreleased source candidate. The current publication and
validation status is recorded below.

### Physical deletion, cleanup, and restart outcomes

The original present-file scope could not rediscover cleanup after the file was
gone. Current `deleteProvenance` swallows errors, and `deleteVaultItem` can resolve
a selection no-op or throw after successful file removal. The proposed response
separates physical effect and cleanup, exposes failures, and discovers remaining
bookkeeping through `D`, existing provenance keys, and the loaded last-seen map.

### Last-seen correctness and persistence cost

The current public clear helper performs a complete map read/write per call; a
probe of the actual 0.4.1 export observed three reads and three writes for three
paths. A stale entry can also affect a later `db-only` decision. The proposed
response removes confirmed-absent entries in memory and awaits one shared final
flush, with no per-candidate persistence request.

### Read-only classification and error propagation

The current classifier may delete unavailable legacy provenance and search live
leaves; default snapshot reads can mask an access error as absence. The proposed
response extracts observational comparison, uses strict reads, and stops after
a proved mismatch instead of invoking preservation fallbacks.

### Repeated deferrals and performance acceptance

The original four-to-two comparison covered successful deletion only. This
revision budgets repeated deferrals, keys-only cleanup discovery, whole-map
persistence, and bounded recovery concurrency explicitly. User review replaced
the initial one-file proposal with a three-file cap so that one large waiting
file does not monopolise recovery. User review also withdrew the blanket
local-only restriction; exact-base reads follow existing Chunk delivery policy,
with remote waits and fetched-Chunk writes counted separately. Device performance
remains unverified; the implementation must establish its suitability before
release.


## Implementation design

Commonlib owns `ServiceFileHandlerBase/deletionRecovery.ts`, exposed by the
existing facade through `recoverDatabaseDeletion`. Its result reports decision,
physical file state, provenance state, and a diagnostic reason independently.
`supportsDeletionRecovery` is a metadata-only capability check; enumeration is
invoked only for absent-file cleanup discovery. `listDeletionRecoveryPaths`
forwards the optional provenance capability. The existing `IFileHandler` methods
remain source compatible for hosts which do not opt in.

`StoredFileReflectionProvenance` enables namespace enumeration only when its host
opts in. The shared host factory defaults to disabled; Obsidian composition
explicitly enables it using the existing reset-scoped store. CLI and browser
composition retain the default capability until separately adopted. The key-value adapter must enumerate
the full namespace with correct inclusive/exclusive bounds, including paths
above a U+FFFF sentinel, without loading record values.

The scanner discovers recovery pairs from its existing collection. It processes
previously absent cleanup pairs before new deletions, then includes both results
in its normal scan summary. Recovery updates last-seen state in memory and awaits
a final ordered flush. Status and timers belong to the host key-value store;
overlapping scans of that store are serialised so that a stale load or write
cannot overwrite an in-progress recovery. No persistent format changes.

The handler shares three recovery permits for a Vault's provenance owner and
retains the existing document lock. Normal scanner admission remains ten. The
permit covers waiting, validation, removal, and cleanup, and is released on all
outcomes. Existing shared hashing and Fetcher ownership remain intact.

A legacy read which returns only `false` cannot establish why the existing
retrieval pipeline failed. Report `base-unavailable` as failed verification,
retain the file, and do not claim remote absence. Exceptions retain their phase
and diagnostic cause. This conservative result avoids changing existing Chunk
retrieval semantics or adding a second retry policy.

The implementation was prepared against an exact local packed Commonlib artefact.
The application now pins registry Commonlib 0.4.2 and its integrity. Registry
validation establishes the published bytes; it does not establish iPhone performance.


## Implementation and publication status

The guarded handler, opt-in provenance enumeration, cleanup discovery, shared
three-file admission, and ordered scanner bookkeeping are implemented in the
published Commonlib 0.4.2 package. Self-hosted LiveSync 1.0.48 enables the capability
in the Obsidian host.
The reviewed-version frontmatter remains the published baseline, not a claim
that registry Commonlib 0.4.1 includes this change.

Owner tests establish the two-body-read path and preservation/restart contracts
through real local revision storage with injected host boundaries. Packed-package
checks validate the candidate independently. Real Obsidian restart validation and
consumer checks use those same packed bytes; physical iPhone timing and peak
memory remain separate evidence. The application dependency now selects that
exact published immutable Commonlib version and integrity.

The published plug-in assets passed deletion-recovery E2E in real Obsidian,
including edited-content protection and exact Metadata history across two
restarts. Their build attestations were verified against the release tag and
source commit. BRAT installation and start-up were accepted before stable
promotion. An actual Vault start-up check reported no noticeable delay; no
quantitative device timing or peak-memory measurement was supplied. Physical
iPhone measurements remain a separate follow-up.
