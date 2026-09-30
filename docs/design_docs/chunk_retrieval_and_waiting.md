# Chunk Retrieval and Waiting

## Purpose

This document records how LiveSync retrieves chunks after file metadata has been found, which operation provides each terminal condition, and what the remaining time value means. It is an implementation specification for developers; it is not a user configuration guide.

The architectural decision and historical rationale are in [Chunk Arrival Quiescence](../adr/2026_07_chunk_arrival_quiescence.md).

## Invariants and Sources of Apparent Reordering

A normal local save creates and persists the chunks before it writes the metadata document which refers to them. LiveSync must preserve this invariant: publishing metadata first can expose a reference which no client can satisfy.

This ordering is not an atomic transaction across documents. A reader may still see metadata before a referenced chunk for these reasons:

- CouchDB replication transfers individual documents and does not expose the chunk and metadata writes as one atomic unit.
- With `readChunksOnline` enabled, CouchDB pull replication deliberately excludes chunk documents. Seeing metadata first is then the intended design, and the chunk is fetched by identifier.
- A winning metadata conflict revision may refer to chunks created by another revision or client which have not yet reached the local database.
- Replication persists documents before every downstream change callback and file-reflection task has necessarily observed them.
- Historical versions and removed transfer modes may have produced data which did not preserve the normal ordering invariant.

Waiting may resolve temporary visibility and processing gaps only when a known operation can still deliver the chunk. It cannot repair a chunk which is absent from every available source.

## Retrieval Capabilities

Direct on-demand fetch is currently available only for CouchDB when `useOnlyLocalChunk` is false. This capability deliberately does not depend on `readChunksOnline`:

- when `readChunksOnline` is true, direct fetch is the normal way to obtain a chunk omitted from pull replication; and
- when `readChunksOnline` is false, direct fetch remains a recovery path if a normally replicated chunk is locally absent.

MinIO's sequential replicator and P2P do not implement direct `fetchRemoteChunks` delivery through this path. Their chunks must arrive through a finite replication operation. A P2P pull or bidirectional synchronisation is such a producer. A push-only P2P request remains broad remote activity for Wake Lock and lifecycle reporting, but it is deliberately excluded from `finiteReplicationActivityCount` because it cannot deliver a local document.

`waitForReady` is a call-site policy, not a persisted user setting. `true` permits waiting for an already-observable producer. `false` normally requests an immediate local result, except that CouchDB on-demand delivery still waits for the claim which synchronous dispatch creates.

## Policy Matrix

The matrix selects whether lifecycle waiting is permitted and whether the waiter may dispatch a direct request. It does not assign elapsed arrival budgets.

| Remote  | `waitForReady` | `useOnlyLocalChunk` | Direct fetch | Wait for observed producer | Intended behaviour                                                                      |
| ------- | -------------: | ------------------: | -----------: | -------------------------: | --------------------------------------------------------------------------------------- |
| CouchDB |        `false` |             `false` |          Yes |                        Yes | Dispatch on-demand fetch and finish at its per-identifier claim boundary.               |
| CouchDB |         `true` |             `false` |          Yes |                        Yes | Accept an active finite replication or dispatch direct fetch.                           |
| CouchDB |        `false` |              `true` |           No |                         No | Return immediately after the local miss.                                                |
| CouchDB |         `true` |              `true` |           No |                        Yes | Wait for an already-active finite replication; otherwise return unavailable.            |
| MinIO   |        `false` |              Either |           No |                         No | Return immediately after the local miss.                                                |
| MinIO   |         `true` |              Either |           No |                        Yes | Wait for an already-active finite sequential replication; otherwise return unavailable. |
| P2P     |        `false` |              Either |           No |                         No | Return immediately after the local miss.                                                |
| P2P     |         `true` |              Either |           No |                        Yes | Wait for an already-active finite P2P replication; otherwise return unavailable.        |

For CouchDB, `readChunksOnline` changes what normal replication includes, not the direct-fetch capability or this matrix:

| `readChunksOnline` | CouchDB pull contains chunks | Role of direct fetch                                                     |
| -----------------: | ---------------------------: | ------------------------------------------------------------------------ |
|             `true` |                           No | Primary chunk delivery after metadata arrives.                           |
|            `false` |                          Yes | Recovery fallback for a chunk which is unexpectedly unavailable locally. |

`concurrencyOfReadChunksOnline` and `minimumIntervalOfReadChunksOnline` affect only the scheduling of CouchDB on-demand requests. They do not change whether a request may be dispatched or which lifecycle a reader observes. Accepted identifiers remain claimed while they wait for a concurrency slot and while the configured interval is applied. Backoff releases the physical concurrency slot but retains logical ownership. Eligible retries and new identifiers can share a batch of up to 100 identifiers. An owned timer wakes the queue at the earliest eligible retry without requiring a new event. New arrivals do not reset existing retry times, and eligible older work precedes newer queued work.

After every wait or asynchronous local recheck, the fetcher checks the configured interval against the latest shared request time and reserves its start synchronously. A minimum interval of five minutes or more is an exceptional value: the inactivity fuse may release the logical claim before that deliberate pause completes. An expired claim is not dispatched after the pause; an already-running physical request is not aborted by the fuse.

## Wait State Machine

1. Read the cache and local database.
2. If every requested chunk is present, return it without entering a wait.
3. Register one shared waiter per missing identifier.
4. If policy permits direct fetch, emit `missingChunks`. `ChunkFetcher` synchronously creates the per-identifier claim before the event dispatch returns.
5. Observe both the matching claim and `finiteReplicationActivityCount`.
6. Resolve immediately if a valid chunk or terminal explicit remote-missing event arrives.
7. If a successful direct-fetch response omits an identifier, apply the per-identifier retry policy below. Settle identifiers present in a partial result and retry only those which remain absent.
8. If an observed producer remains active, do not charge elapsed time against a general arrival budget.
9. When all observed producers end, bypass the cache and read the identifiers from the local database once.
10. Return the rechecked chunk, or return unavailable. Do not add another fixed grace after the authoritative boundary.
11. If no producer is observable after synchronous dispatch, return unavailable immediately.

If new relevant activity starts while the final database recheck is pending, that result becomes stale. The waiter remains active until the newer producer completes and a current recheck finishes.

## Meaning of Finite Replication Completion

Finite replication enters the typed `runFiniteReplicationActivity` boundary and is represented by the narrower `finiteReplicationActivityCount`. The optional `replication` label remains diagnostic and does not control this behaviour.

For a successful finite operation, completion means that its replicator has reached the latest sequence in the operation's scope and processed its replication change callbacks. No more database documents can arrive from that operation. This is the primary semantic cutoff.

If the operation fails, it has not proved remote absence or latest state. It has nevertheless stopped being a producer. The waiting layer rechecks documents which may have arrived before the failure and then returns unavailable; the replication error and retry workflow owns further recovery.

Overlapping finite replications keep the count above zero until the final operation settles. The local recheck therefore occurs only after every observed finite producer is quiescent.

The continuous live channel is intentionally excluded because it has no completion boundary and would otherwise make a chunk read unbounded. The pull-only catch-up run before opening that channel is finite and enters the same typed boundary. Its one-shot batch-size fallback remains inside that boundary. A live-channel fallback starts another continuous attempt and therefore another bounded initial catch-up.

## Meaning of an On-demand Claim

An accepted identifier remains claimed from synchronous queue acceptance through throttling, physical fetch, validation, local persistence, retry delays, and terminal event delivery. The claim is identifier-scoped because a global remote-work count cannot say whether unrelated work can provide this chunk.

The claim finishes when the fetcher has recorded an outcome for the identifier. A successful first omission schedules a two-second retry even if finite replication is already inactive. While finite replication remains active, each subsequent omission increases that identifier's delay by two seconds, up to ten seconds: `2, 4, 6, 8, 10, 10, ...`. Joining a different batch does not reset its retry stage. Each retry first bypasses the local cache and disables further remote dispatch and delivery waiting for its local recheck.

When the observed finite count falls to zero, remaining backoff is interrupted. The fetcher rechecks local persistence and makes a final remote probe only for still-absent identifiers, respecting concurrency and minimum request spacing. A pre-completion in-flight lookup cannot count as that final probe: if it omits the identifier, a subsequent post-completion lookup is needed, without overlapping requests for the same identifier. If another finite operation ends during the final probe, its negative result is stale too. The current final successful omission emits the terminal explicit remote-missing result and settles the current read. No retry remains for a future synchronisation.

A transport error, missing active Replicator, or invalid result releases the claim according to its existing terminal path rather than entering this missing-result retry. The retry gate is finite replication alone: neither the fetcher's own claim nor broader bounded remote work keeps it alive. There is no attempt limit or absolute elapsed limit while finite replication continues. All retry state is in memory; destruction and inactivity expiry remove queued work and its timer.

Each request retains the identity of the claims it accepted. If another read claims the same identifier after an earlier claim settles or expires, the earlier request cannot release the replacement claim, refresh its fuse, or report unavailability for it. This also applies when a partial batch has already settled one identifier but is still retrying another.

The status indicators count two disjoint sets of pending on-demand Chunk identifiers. `🛄` shows identifiers with no successful missing response yet; `🔁` shows identifiers omitted at least once, including backoff, retry requests, and the final probe. Thus `🛄3 🔁2` means five pending identifiers. The atomic `chunkFetchCounts` snapshot provides this classification, while `collectingChunks` retains their total for the existing restart-deferral check. Moving between categories does not change that total.

Each fetcher contributes its unique accepted identifiers from queueing through terminal delivery. Repeated requests and retry attempts do not increase the count. Settled, expired, and destroyed claims leave the count; one fetcher's teardown preserves another fetcher's contribution. These are not counts of replication connections or all missing Chunks. Zero means that no on-demand claims remain, not that every Chunk was retrieved successfully.

## Meaning of the Five-minute Value

The five-minute value is an inactivity leak fuse for an accepted on-demand claim. It is not a normal terminal condition and is distinct from the backoff which schedules identified follow-up lookups.

The fuse bounds retention if a faulty activity runner never enters its task, a Promise never settles, or a transport stops making observable progress. It prevents the per-identifier claim and waiter from remaining live forever. Once the bounded activity callback has entered, releasing the claim also allows Wake Lock, application-lifecycle deferral, and the remote-work indicator associated with that callback to finish. Observable progress rearms the fuse.

Five minutes is a conservative operational ceiling rather than a measured chunk-arrival expectation. It must not be used to infer that the remote lacks a chunk, and it does not abort the physical request. `fetchRemoteChunks` does not yet accept an `AbortSignal`, so the request may complete after the logical state has been released. Transport cancellation and transport-specific deadlines are separate future work.

Backoff does not resolve the waiter by elapsed time or prove that another producer will deliver the Chunk. Successful missing responses refresh the inactivity fuse, so retries can continue beyond five minutes while finite replication remains active. This is an intentional distinction between inactivity protection and a total lifetime limit.

The old 5-second and 30-second constants remain exported for source compatibility only. A positive deprecated `ChunkReadOptions.timeout` opts into lifecycle waiting, but its numeric value is ignored. Zero or a negative value still requests an immediate result. New code uses `waitForDelivery` explicitly.

## Test Obligations

Changes to this behaviour must keep automated coverage for:

- chunks-before-metadata save ordering;
- every row in the retrieval policy matrix;
- a finite replication which remains active well beyond the former 5-second and 30-second values;
- successful completion with the chunk already persisted but no arrival event delivered;
- immediate unavailability when no producer is observable;
- overlapping finite operations and overlapping per-identifier claims;
- activity restarting while a local recheck is pending;
- direct fetch queueing, throttling, persistence, and terminal notification;
- an autonomous two-second retry after a first successful omission, with bounded remote activity retained throughout;
- per-identifier `2, 4, 6, 8, 10, 10, ...` backoff while finite replication is active;
- backoff releasing physical concurrency, mixed-stage batching, and eligible retries not being starved by new work;
- expiry of the earliest queued claim preserving the scheduled retry for later identifiers;
- finite completion interrupting backoff and pre-completion in-flight requests requiring a current final probe;
- local persistence avoiding an unnecessary retry, including completion during request-interval throttling;
- partial fetch results settling available identifiers and retrying only absent identifiers;
- partial-batch completion and expired-request responses preserving replacement claims;
- disjoint initial and retry counts retaining queued identifiers without duplicates and releasing only settled ownership;
- concurrent request starts respecting the configured interval after retry and throttle waits;
- terminal unavailability after a current final successful omission;
- explicit remote absence versus transport or replicator failure;
- runner rejection, cancellation, teardown, and an operation which never enters its task;
- leak-fuse refresh at observable progress points; and
- continuous replication's finite initial catch-up and parameter fallback.

The service, database, and event boundaries are testable with memory-backed PouchDB and injected activity sources. A real Obsidian test is required only when a change crosses into the platform adapter, application lifecycle, or visible UI rather than for this retrieval state machine alone.
