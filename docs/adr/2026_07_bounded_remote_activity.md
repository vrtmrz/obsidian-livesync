# Architectural Decision Record: Bounded Remote Activity

## Status

Accepted

## Context

Self-hosted LiveSync performs remote work through more than one path:

- finite, or bounded, replication starts for manual, event-driven, periodic, and start-up synchronisation;
- long-running rebuild uploads, standard fetches, and fast fetches;
- continuous replication keeps a channel open until the application lifecycle stops it; and
- remote chunk fetching can occur independently of replication, for example while reading history.

The existing API request and response counters do not cover every one of these paths. They therefore cannot, by themselves, provide an accurate remote-work indicator.

Long-running finite operations can also be interrupted by platform lifecycle behaviour. A mobile or desktop display may sleep while an operation is in progress. Changing Obsidian to a hidden or minimised state normally invokes the suspension lifecycle, which closes the active replicator. The existing desktop-only `keepReplicationActiveInBackground` setting deliberately provides a broader, opt-in policy for continuous and periodic replication, and should not be made a prerequisite for completing a finite operation.

Screen wake lock and background execution are related platform effects, but they are not equivalent. A screen wake lock prevents display sleep only while the platform and document visibility permit it. It does not guarantee background execution, prevent operating-system suspension, or override an explicit system sleep action.

## Decision

`ReplicatorService` owns a reactive `boundedRemoteActivityCount` and a `runBoundedRemoteActivity` closure boundary.

The boundary has the following contract:

- increment the count immediately before running a finite remote task;
- run the task through an optional host-provided activity runner;
- decrement the count in `finally`, including when the task rejects;
- allow overlapping tasks, so transitions may be `0 → 1 → 2 → 1 → 0`; and
- count logical operations, not physical connections, sockets, HTTP requests, queued work, or retry delays outside the bounded task.

`ReplicatorService` also owns a narrower `finiteReplicationActivityCount`. Callers enter it through the typed `runFiniteReplicationActivity` method; diagnostic labels do not determine behaviour. The narrower count describes operations which may still place replicated documents in the local database; it excludes rebuilds, chunk-fetch claims, and other bounded work which cannot satisfy an arbitrary missing-chunk read. It is a delivery-lifecycle capability, not a second Wake Lock policy or a connection counter.

The Obsidian host injects the screen wake-lock manager from the `octagonal-wheels` package in the Fancy Kit monorepo as the activity runner on both mobile and desktop. Unsupported or rejected wake-lock requests remain best effort and do not prevent the remote task from running. The manager is disposed when the plug-in unloads.

Finite replication enters both counts only after readiness checks have succeeded and leaves them after `openReplication(..., continuous: false, ...)` settles. A successful completion has reached the latest sequence in that operation's scope and is therefore an authoritative quiescence boundary for chunk retrieval. A failed operation does not prove latest state, but can no longer deliver documents from that attempt. Failure handling runs afterwards so a mismatch or recovery dialogue does not retain the activity. This includes the direct start-up synchronisation path as well as manual, event-driven, and periodic calls through `ReplicationService`. The unbounded continuous channel does not enter either boundary, but its finite initial pull-only catch-up does; the one-shot parameter fallback chain remains inside that boundary.

Delivery into the local database and application to the Obsidian Vault are deliberately separate lifetimes. A mobile device can have only a short opportunity to obtain remote data, while applying a large downloaded batch to the Vault is durable, offline-capable work which can continue or resume later. The replication-result queue and its recovery snapshot therefore remain outside `boundedRemoteActivityCount`. Finite remote activity ends when the transfer operation settles, even when the `📥` queue still contains documents awaiting Vault application.

This separation also keeps the activity indicators truthful: `📲` describes a finite remote operation and must not remain active solely because local Vault writes are pending. The existing replication-result count continues to describe that local queue. If a future feature offers screen-awake protection while applying downloaded documents, it must use a separately typed local-application activity or power-policy boundary, preserve the current behaviour by default, and avoid incrementing either remote-activity count.

Manual P2P commands which bypass `ReplicationService` enter the broad boundary. Direct P2P pull and push entry points are therefore both protected as finite remote work, covering the Obsidian panes, CLI, and Webapp. A pull or bidirectional synchronisation also enters the narrower finite-replication boundary because it can place documents in the local database. A push-only request remains broad-only: it cannot satisfy a local missing-chunk read and must not present itself as a delivery source. Automatic synchronisation on peer discovery, a pull requested by a remote peer, and a watched pull following a peer progress notification enter both boundaries because each can deliver local documents. A normal P2P peer-selection dialogue represents one broad finite session: it remains inside the boundary while waiting for a peer and while the person may perform repeated synchronisations, then settles when the dialogue closes and any in-flight synchronisation has finished. Closing without synchronising returns a failed result and releases the boundary. The 'Start Sync & Close' action completes its synchronisation before closing. This deliberately protects peer discovery and selection, because display sleep can interrupt discovery or connection establishment and require the person to start detection again. It may therefore retain a Wake Lock longer than the network transfer alone. A transfer performed inside that session temporarily adds a nested activity; the count remains a logical-operation count rather than a connection total.

`ChunkFetcher` enters the broad boundary synchronously when it accepts newly missing chunk identifiers, but it does not increment the finite-replication count. A typed per-identifier claim keeps the broad boundary active through queue waiting, interval throttling, `fetchRemoteChunks`, validation, local persistence, and terminal event delivery. Duplicate requests share the existing claim. Explicit absence, failure, cancellation, or a conservative five-minute period without fetcher-observable progress settles the affected claim. The five-minute value is only a last-resort leak fuse: it prevents a never-settling integration from retaining the per-identifier claim and waiter indefinitely and, once the activity runner has entered the claim task, lets the associated Wake Lock, lifecycle deferral, and indicator finish. It is not an arrival estimate, proof of remote absence, or a transport deadline. This scope is defined in detail by the chunk-arrival-quiescence ADR.

Rebuild operations use the same boundary at their destructive or remote phase:

- remote rebuild covers settings application, remote reset, and both upload passes, but releases before the completion dialogue;
- rebuild everything covers local and remote reset and both upload passes, but releases before the completion dialogue;
- standard fetch starts after any user confirmation and covers local reset, both download passes, and automatic reflection resumption; and
- fast fetch starts after remote-type selection and covers reset, resumable download retries, reflection resumption when requested, and checkpoint removal. A non-CouchDB fallback enters only the standard-fetch boundary.

Rebuilder-owned confirmation before destructive work and completion dialogues remain outside the boundary so a person cannot hold a Wake Lock indefinitely merely by leaving a dialogue open. P2P peer discovery and selection during a rebuild deliberately remain inside the boundary. They occur after destructive work has begun, and releasing protection at that point would both leave a partial rebuild unprotected and allow display sleep to interrupt peer detection, forcing the person to repeat it. The protected selection period is therefore part of the rebuild operation rather than an incidental confirmation dialogue.

The deprecated database-clean-up workflow also places its connection, one-shot replication, balancing, and remote resolution inside one `database-cleanup` boundary after the user's choice. Its preliminary count and choice dialogue remain outside.

On every platform, a visibility change to hidden defers the normal suspension lifecycle while the bounded count is non-zero. When the last bounded operation ends, the deferred suspension runs if the document is still hidden and the existing desktop background-replication setting does not apply. This does not bypass mobile operating-system restrictions: a hidden document loses its Screen Wake Lock, and the operating system may still pause or terminate the application. LiveSync merely avoids aborting the operation itself while it may still be able to finish.

Fetch rebuilds temporarily suspend file watching. Their visibility event still records the observed hidden state and a pending lifecycle suspension while bounded activity is in progress, without committing or processing file events. A hidden application is suspended after the rebuild boundary ends and can therefore resume normally when it becomes visible. If it becomes visible before the boundary ends, the pending suspension is cancelled and no unmatched resume lifecycle is emitted.

If the desktop background setting applies, its existing continuous or periodic policy remains authoritative. When a Desktop LiveSync window becomes visible during bounded activity, the normal continuous-channel teardown and resume sequence is also deferred until that activity ends, so recovery does not abort the finite operation.

The status bar separates the two meanings. `📲` is shown while the bounded remote activity count is non-zero. It therefore reports a finite logical operation, including periods such as P2P peer selection or chunk-fetch queueing when no request is currently crossing the network. An adjacent `🌐N` reports the approximate number of tracked physical-request units currently in progress. The icon values and the physical indicator's 150 ms minimum display time are named constants so their presentation can be revised without changing the activity contract.

Each physical HTTP attempt owns one balanced counter pair. The request counter is incremented immediately before invoking the selected fetch implementation, and the response counter is incremented in `finally`, whether the attempt returns or rejects. A web-fetch failure followed by the native fallback is two physical attempts and therefore contributes two balanced pairs. Callers must not add another pair around `performFetch`, because duplicated or missing increments leave the status indicator permanently active.

Object Storage contributes one approximate unit for each AWS SDK command issued by its adapter, including upload, download, listing, deletion, availability, and usage requests. A download remains active until its response body has been consumed. This boundary is above the request-handler choice, so it covers both the standard SDK handler and Obsidian's internal request API without double counting. SDK-internal retries remain within one reported command. The displayed value is therefore intentionally approximate and is not an exact count of sockets, HTTP exchanges, or bytes transferred.

P2P does not yet contribute to the physical-request count because it does not have a request unit comparable with CouchDB HTTP attempts or Object Storage SDK commands. Its finite operations remain visible through `📲`. A future P2P transfer metric should be added only when it has a stable meaning, rather than being inferred from the broad logical-operation count.

## Ownership

`ReplicatorService` is the shared ownership point because both `ReplicationService` and `ChunkFetcher` already depend on it. It owns the broad activity count and classifies the semantic subset which represents finite replication. Placing either activity state in `ReplicationService` would make chunk fetching depend in the opposite direction and risk a service dependency cycle. Adding another Service Hub service would introduce a wider capability surface without a distinct lifecycle owner.

The platform activity runner remains injected. Common library and headless consumers can omit it while retaining the same bounded activity count and operation semantics.

## Non-Goals

- Do not count continuous replication as a bounded activity.
- Do not reinterpret the count as an exact number of network connections or HTTP requests.
- Do not use either diagnostic count for replication completion, throttling, protocol correctness, or power-policy decisions.
- Do not claim or implement privileged mobile background execution.
- Do not guarantee protection against operating-system suspension, closing a laptop lid, forced termination, network loss, or a user-initiated sleep action.
- Do not add a lifecycle timeout which would abort an unusually slow rebuild. A genuinely stalled operation may postpone LiveSync's visibility suspension until it settles, but the platform may still suspend or terminate background work.
- Do not broaden `keepReplicationActiveInBackground`; it remains an opt-in desktop policy for continuous and periodic operation after finite work has ended.
- Do not include offline scans, unrelated local storage reflection, or the durable replication-result queue in this boundary. They are offline-capable and require a separate decision if activity reporting or power policy is added later.

## Verification

Before changing the transfer/application separation, add a deterministic regression scenario which leaves downloaded documents queued after finite transfer settles, verifies that remote activity has ended, persists the queued state, and resumes Vault application after suspension or restart. An optional local-application Wake Lock feature requires its own enabled and disabled cases; existing remote-operation E2E is not evidence for that separate policy.

Unit tests cover:

- overlapping bounded activities and their reactive count transitions;
- count cleanup after rejection;
- entry into the boundary only after replication readiness succeeds;
- replication failure handling occurring after the finite activity ends;
- start-up one-shot replication and continuous start-up's finite pull-only catch-up entering the boundary, while the unbounded live channel does not;
- start-up readiness failure avoiding the boundary;
- direct P2P commands entering the boundary;
- direct P2P pull and push entry points entering the broad boundary, while only pull and bidirectional operations enter the finite-delivery boundary;
- automatic synchronisation on peer discovery, remote pull requests, and watched peer progress entering the boundary;
- P2P peer-selection sessions settling on close, including cancellation, repeated synchronisation, and a close during in-flight work;
- remote chunk fetching remaining inside the shared boundary from synchronous queue acceptance through local persistence and terminal notification;
- missing-chunk waiters rechecking local storage when observed per-identifier claims and finite replication have settled;
- the finite-replication count excluding other bounded work;
- standard, fast, remote, and combined rebuild activity boundaries;
- Rebuilder-owned confirmation and completion dialogues remaining outside rebuild activity;
- fallback from fast fetch avoiding a nested activity boundary;
- fast-fetch reflection resumption and checkpoint removal remaining inside the activity;
- visibility suspension being deferred while bounded activity is in progress on desktop and mobile;
- rebuild-time file-watching suspension preserving the deferred lifecycle action;
- deferred suspension after the final activity ends while the document remains hidden;
- hidden-to-visible transitions before the final activity avoiding an unmatched resume; and
- continuous-channel recovery being deferred when a desktop window becomes visible during bounded activity.

Additional tests cover balanced physical-request counters after success and rejection, each Object Storage command boundary, response-body consumption for downloads, the split `📲` and `🌐N` status labels, and a deterministic real-Obsidian CouchDB request held while the physical indicator is observed. The Object Storage integration and real-Obsidian MinIO workflows verify that actual AWS SDK operations advance and rebalance the shared counters.

The exact Fancy Kit screen wake-lock behaviour is covered by its package and Harness tests. A real Obsidian smoke test remains appropriate when changing the platform adapter or lifecycle integration, but is not required for changes confined to the already-tested injected activity-runner contract.

## Consequences

- One finite activity definition drives Wake Lock, lifecycle protection, and status UI without coupling common library code to Obsidian or browser globals.
- Callers can observe accurate logical activity even in CLI and Webapp hosts which do not inject a Wake Lock implementation.
- Rebuild operations now retain Wake Lock and lifecycle protection across their longest interruption-sensitive phases without retaining them for Rebuilder-owned pre-operation or completion dialogues. Post-reset P2P discovery and selection remain protected as an intentional part of completing the rebuild.
- Downloaded documents may remain in the durable Vault-application queue after remote activity has ended, allowing transfer and offline application to follow different mobile lifetimes without presenting local writes as communication.
- Users can now distinguish the lifetime of a finite remote operation from approximate request activity within it.
