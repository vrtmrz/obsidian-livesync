# Architectural Decision Record: Chunk Arrival Quiescence

## Status

Accepted

## Context

A file metadata document refers to one or more content-addressed chunk documents. LiveSync normally writes the chunks before writing the metadata, but those writes are separate database operations and are not replicated as one atomic unit. A local reader can consequently observe metadata before every referenced chunk is locally readable. This is expected when CouchDB on-demand chunk fetching is enabled, and can also occur around conflict resolution, replication event processing, and historical data.

Before this decision, a missing-chunk waiter used a fixed 5-second or 30-second timeout. Its budget included queueing, throttling, network transfer, validation, local persistence, and event delivery. A healthy operation could therefore time out immediately before it delivered the requested chunk. Conversely, when no operation was capable of delivering the chunk, the timer merely delayed the same unavailable result.

Finite replication provides a stronger boundary than elapsed wall-clock time. In the absence of an error, a finite replication does not complete until it has reached the latest sequence in its scope. Once it completes, that replication cannot deliver another chunk. An on-demand fetch is a separate finite delivery path and needs its own per-identifier boundary.

## Decision

Wait only for a delivery lifecycle which is observable when the local miss is handled. Do not guess how long an unobserved producer might take.

Two lifecycle signals are relevant:

- `finiteReplicationActivityCount` records finite replication operations which can still place database documents in the local database; and
- a `ChunkDeliveryCoordinator` claim records the complete lifetime of an accepted on-demand request for each missing chunk identifier.

The finite replication count is distinct from the broader `boundedRemoteActivityCount`. Rebuilds and other bounded remote work may need Wake Lock and lifecycle protection without being able to satisfy an arbitrary missing-chunk read. A P2P push-only operation is broad for the same reason: it sends documents away but cannot place one in the local database. P2P pull and bidirectional operations are finite-delivery sources. `ReplicatorService` updates the narrower count only through the typed `runFiniteReplicationActivity` boundary; the diagnostic activity label is not used as a behavioural discriminator.

The waiting layer follows these rules:

1. Register the waiter before requesting on-demand delivery.
2. Dispatch `missingChunks` synchronously when direct fetch is permitted. `ChunkFetcher` must claim accepted identifiers before dispatch returns, closing the scheduling gap without a timer.
3. If a matching claim or finite replication is active, wait for that observable producer.
4. A valid chunk arrival resolves the waiter immediately.
5. An explicit remote-missing result resolves it as missing immediately.
6. Once every observed producer completes, read the requested identifier from the local database once more, bypassing the cache.
7. Return the rechecked chunk, or return unavailable. Do not add a fixed grace period after the producer has stopped.
8. If no producer is observable after synchronous dispatch, return unavailable immediately. There is no operation for a duration to represent.

If new relevant activity starts while the final database recheck is pending, that result is stale. The waiter remains active until the newer producer completes and a current recheck finishes.

A successful finite replication completion is the authoritative ‘latest’ boundary. A failed operation does not prove that the remote lacks the chunk, but it is still terminal for that attempt: it can no longer deliver data. The same local recheck preserves any documents received before the failure, after which normal replication error and retry handling remains responsible for recovery. Missing-chunk code must not misreport that case as an explicit remote absence.

### On-demand fetch boundary

`ChunkFetcher` claims newly requested identifiers synchronously while handling the `missingChunks` event. The claim remains active through:

- queueing and concurrency scheduling;
- configured interval throttling;
- entry into the injected bounded-activity runner;
- `fetchRemoteChunks`;
- response validation;
- local database persistence; and
- fetched or missing event delivery.

The claim settles on every terminal path, including explicit absence, no active replicator, rejection, invalid results, destruction, and cancellation. Its completion Promise is the task passed to the bounded `chunk-fetch` activity, keeping Wake Lock, application lifecycle deferral, the remote-work indicator, and missing-chunk delivery aligned.

### Five-minute leak fuse

An accepted on-demand claim has a separate five-minute inactivity fuse. This is a last-resort leak safety valve, not a chunk-arrival budget or a remote-request timeout.

Its purpose is to prevent a faulty integration, a never-settling Promise, or a stalled transport from retaining logical ownership indefinitely. When it fires, the coordinator releases the per-identifier claim and its waiter. If the bounded activity callback has been entered, resolving the claim also allows the associated Wake Lock, application-lifecycle deferral, and remote-work indicator to be released. `ChunkFetcher` refreshes the fuse only at observable progress points, such as entering the activity boundary, beginning and completing throttling or transfer, and completing persistence.

Five minutes is deliberately a conservative operational limit, not a value derived from a network protocol, a benchmark, or evidence that a missing chunk will arrive within that period. Firing the fuse neither proves remote absence nor makes the underlying request safe to abort. The current `fetchRemoteChunks` contract has no `AbortSignal`, so a physical request may still complete after its logical claim has been released. A future cancellable transport contract should add transport-specific deadlines and explicit cancellation without changing the lifecycle-based wait rule.

### Continuous replication

The unbounded live channel is not a quiescence gate because it has no natural end. Its initial pull-only catch-up is finite, however, and must enter `runFiniteReplicationActivity`. This includes the one-shot parameter fallback chain: every retry remains within the catch-up boundary until it succeeds or stops. If continuous replication later restarts with adjusted parameters, the new initial catch-up enters a new finite boundary.

Once the live channel has begun, a chunk delivered through it still resolves an existing waiter immediately, but the channel itself does not keep a new waiter open. CouchDB on-demand fetching supplies its own per-identifier claim. If a future defect demonstrates a delivery race inside a live batch, that batch lifecycle should be exposed explicitly rather than approximated with another elapsed delay.

## Ownership

`ReplicatorService` owns both the broad bounded-operation count and the narrower finite-replication count. It is the common lifecycle owner for CouchDB, sequential, and P2P replicators.

`LayeredChunkManager` owns one `ChunkDeliveryCoordinator` and supplies it to its arrival layer and `ChunkFetcher`. `ArrivalWaitLayer` owns waiter resolution and the final local database recheck. It depends on the narrow coordinator capability rather than on `ReplicatorService` itself.

`ChunkFetcher` owns per-identifier claims because it knows when each identifier enters its queue and reaches a terminal result.

## Compatibility

- Preserve immediate reads when `waitForDelivery` is false or the deprecated call-site `timeout` is zero or negative.
- Treat a positive deprecated `timeout` only as source-compatible opt-in to lifecycle waiting. Its numeric value no longer represents an arrival duration.
- Preserve `preventRemoteRequest`: no on-demand request is dispatched, although an already-active finite replication may satisfy the waiter.
- Preserve Promise sharing for concurrent reads of the same chunk identifier.
- Preserve immediate explicit remote-missing results.
- Do not change which remote types support direct on-demand fetching.

## Historical Evidence and Scope

This decision addresses the lifecycle-race class rather than treating every ‘Load failed’ report as a timeout:

- [Issue #166](https://github.com/vrtmrz/obsidian-livesync/issues/166) contained logs where chunk collection failed shortly before related chunk writes appeared. It is evidence for the timing class, although that issue's hidden-file start-up path was repaired separately and is not claimed as a direct regression test here.
- The 2021 timing fixes in [commit `39e2eab0`](https://github.com/vrtmrz/obsidian-livesync/commit/39e2eab0238d9c37e3653cdec884cbeed543fc23) and the extended leaf timeout in [commit `9facb577`](https://github.com/vrtmrz/obsidian-livesync/commit/9facb577601d8aceff7df547cd2a6f9357fdaa29) show that elapsed timeout values have historically been used to absorb the same ordering uncertainty. They do not provide a protocol basis for retaining 5-second or 30-second delays.
- Replication pacing introduced by [commit `8d66c372`](https://github.com/vrtmrz/obsidian-livesync/commit/8d66c372e15c43a2de84a223c6385077b7724eec) and commonlib [commit `051b50c`](https://github.com/vrtmrz/livesync-commonlib/commit/051b50ca38ec4c05a11e8216ac259b4488b825f0) is a direct precedent for preventing replication progress from outrunning chunk collection. The present design expresses that dependency as an explicit lifecycle and completion recheck.
- [Issue #505](https://github.com/vrtmrz/obsidian-livesync/issues/505) was traced to chunks which were genuinely absent after the former bulk-send option broke the chunks-before-metadata guarantee. Waiting cannot recreate missing data, so this decision does not claim to fix it.
- [Issue #771](https://github.com/vrtmrz/obsidian-livesync/issues/771) and [Issue #986](https://github.com/vrtmrz/obsidian-livesync/issues/986) contain ambiguous or version-dependent `Load failed` reports. They remain unclaimed until the original writer and database state can be reproduced.

The detailed setting and replicator matrix is recorded in [Chunk Retrieval and Waiting](../design_docs/chunk_retrieval_and_waiting.md).

## Alternatives Rejected

### Increase the fixed timeout constants

Any fixed total duration can still expire immediately before a queued or progressing operation reports its result. Larger values also make genuine failures slower without defining what the system is waiting for.

### Start another grace period after finite completion

A successful finite replication has already reached its latest sequence, and the completion recheck observes documents persisted without a waiter event. Waiting an additional 5 or 30 seconds has no identified producer to wait for and merely retains the historical approximation.

### Observe all bounded remote activity

The broad count includes operations which cannot provide the requested chunk. Using it as the delivery gate lets unrelated work delay a read and makes its completion semantically meaningless. A separate finite-replication count avoids that leak.

### Keep a fallback timer for unobserved delivery

An unobserved producer has no defined start, progress, or completion semantics. A timer would therefore be a guess rather than a safety property. Relevant delivery paths must claim their work synchronously or expose a finite replication boundary; otherwise the read returns unavailable.

### Remove every timer

The arrival wait has no elapsed timer, but an implementation fault can leave a delivery claim unresolved forever. The five-minute inactivity fuse bounds that leaked logical state without being used as a successful delivery condition.

## Verification

Unit tests use deterministic clocks and deferred Promises to cover:

- a finite replication which lasts well beyond the former arrival values;
- successful finite completion causing a cache-bypassing local database recheck;
- immediate unavailability when no producer is observable;
- per-identifier claims covering queueing, throttling, remote fetch, validation, persistence, and event delivery;
- explicit missing, no-replicator, rejection, invalid response, cancellation, runner rejection, and teardown paths;
- overlapping claims and finite replications;
- a runner which never enters the task and a request which never settles;
- the five-minute fuse being refreshed by observable progress;
- continuous replication's finite initial catch-up, including its parameter fallback path; and
- the setting and replicator decision matrix.

Integration-style unit tests exercise `LayeredChunkManager`, `ChunkFetcher`, a memory-backed PouchDB database, and a deferred fake replicator together. A real Obsidian test is not required because the change remains behind the existing database, service, and event boundaries and does not alter platform UI or an adapter contract.

## Consequences

- A healthy finite replication or on-demand request no longer loses a race against an unrelated wall-clock estimate.
- Successful finite replication completion provides a precise latest boundary for missing-chunk reads.
- The local recheck closes event-delivery and cache timing gaps without extending the wait after completion.
- Reads no longer pause for 5 or 30 seconds when no observable operation can deliver the chunk.
- Relevant producers must expose a lifecycle and must continue to prove cleanup on every exceptional path.
- The five-minute fuse bounds leaked logical activity, but it neither establishes remote absence nor cancels a physical request.
