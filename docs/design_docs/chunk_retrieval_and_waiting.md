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

`concurrencyOfReadChunksOnline` and `minimumIntervalOfReadChunksOnline` affect only the scheduling of CouchDB on-demand requests. They do not change whether a request may be dispatched or which lifecycle a reader observes. Accepted identifiers remain claimed while they wait for a concurrency slot and while the configured interval is applied. A minimum interval of five minutes or more is an exceptional value: the inactivity fuse may release the logical claim before that deliberate pause completes. This safety precedence does not abort the delayed physical request.

## Wait State Machine

1. Read the cache and local database.
2. If every requested chunk is present, return it without entering a wait.
3. Register one shared waiter per missing identifier.
4. If policy permits direct fetch, emit `missingChunks`. `ChunkFetcher` synchronously creates the per-identifier claim before the event dispatch returns.
5. Observe both the matching claim and `finiteReplicationActivityCount`.
6. Resolve immediately if a valid chunk or explicit remote-missing event arrives.
7. If an observed producer remains active, do not charge elapsed time against an arrival budget.
8. When all observed producers end, bypass the cache and read the identifiers from the local database once.
9. Return the rechecked chunk, or return unavailable. Do not add another fixed grace after the authoritative boundary.
10. If no producer is observable after synchronous dispatch, return unavailable immediately.

If new relevant activity starts while the final database recheck is pending, that result becomes stale. The waiter remains active until the newer producer completes and a current recheck finishes.

## Meaning of Finite Replication Completion

Finite replication enters the typed `runFiniteReplicationActivity` boundary and is represented by the narrower `finiteReplicationActivityCount`. The optional `replication` label remains diagnostic and does not control this behaviour.

For a successful finite operation, completion means that its replicator has reached the latest sequence in the operation's scope and processed its replication change callbacks. No more database documents can arrive from that operation. This is the primary semantic cutoff.

If the operation fails, it has not proved remote absence or latest state. It has nevertheless stopped being a producer. The waiting layer rechecks documents which may have arrived before the failure and then returns unavailable; the replication error and retry workflow owns further recovery.

Overlapping finite replications keep the count above zero until the final operation settles. The local recheck therefore occurs only after every observed finite producer is quiescent.

The continuous live channel is intentionally excluded because it has no completion boundary and would otherwise make a chunk read unbounded. The pull-only catch-up run before opening that channel is finite and enters the same typed boundary. Its one-shot batch-size fallback remains inside that boundary. A live-channel fallback starts another continuous attempt and therefore another bounded initial catch-up.

## Meaning of an On-demand Claim

An accepted identifier remains claimed from synchronous queue acceptance through throttling, physical fetch, validation, local persistence, and terminal event delivery. The claim is identifier-scoped because a global remote-work count cannot say whether unrelated work can provide this chunk.

The claim finishes when the fetcher has recorded an outcome for the identifier. A transport error, missing active replicator, or invalid result releases the claim without emitting an explicit remote-missing result unless the remote actually supplied that information.

## Meaning of the Five-minute Value

The five-minute value is an inactivity leak fuse for an accepted on-demand claim. It is the only elapsed duration in this state machine, and it is not a normal terminal condition.

The fuse bounds retention if a faulty activity runner never enters its task, a Promise never settles, or a transport stops making observable progress. It prevents the per-identifier claim and waiter from remaining live forever. Once the bounded activity callback has entered, releasing the claim also allows Wake Lock, application-lifecycle deferral, and the remote-work indicator associated with that callback to finish. Observable progress rearms the fuse.

Five minutes is a conservative operational ceiling rather than a measured chunk-arrival expectation. It must not be used to infer that the remote lacks a chunk, and it does not abort the physical request. `fetchRemoteChunks` does not yet accept an `AbortSignal`, so the request may complete after the logical state has been released. Transport cancellation and transport-specific deadlines are separate future work.

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
- explicit remote absence versus transport or replicator failure;
- runner rejection, cancellation, teardown, and an operation which never enters its task;
- leak-fuse refresh at observable progress points; and
- continuous replication's finite initial catch-up and parameter fallback.

The service, database, and event boundaries are testable with memory-backed PouchDB and injected activity sources. A real Obsidian test is required only when a change crosses into the platform adapter, application lifecycle, or visible UI rather than for this retrieval state machine alone.
