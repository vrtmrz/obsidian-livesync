---
date: 2026-08-27
commonlib-version: "0.1.19"
self-hosted-livesync-version: "1.0.21"
status: proposed
series: replicator-capabilities-and-lifecycle
part: 3 of 3
---

# Architectural Decision Record: Replicator Capabilities and Lifecycle Orchestration — Part 3: Migration Plan and Verification

Series navigation: this is Part 3 of 3. Start with [Part 1: core contract](2026_08_replicator_capabilities_01_core_contract.md),
then [Part 2: P2P service and session lifecycle](2026_08_replicator_capabilities_02_p2p_service_lifecycle.md).
This part owns implementation sequencing and verification; it does not add
another runtime contract.

## Status

Proposed. The stages below are an implementation and verification order, not
independently releasable states. Commonlib and Self-hosted LiveSync must not
publish temporary support boundaries described by an incomplete stage. A
release follows only after the target matrix, ownership boundaries, and the
contracted production-consumer migrations in Parts 1 and 2 are complete.

## Migration rules

Each Commonlib change first runs its focused unit and type-contract tests,
builds and validates the packed artefact, installs that exact artefact in
Self-hosted LiveSync, and runs focused downstream tests before either
repository advances. Compatibility methods remain until every production
consumer has migrated.

The smallest vertical contract which fixes issue 1140 takes priority over
unrelated probe, Fast Fetch, maintenance, integrity, and facade work. A stage
must not claim completion when it only changes a type declaration while a
production caller still uses the old ownership or interaction path.

## Stage 1: reproduce the current boundary failures

Add the smallest regression which configures an Object Storage active provider,
enables `syncOnStart`, invokes the resume lifecycle after readiness, and
expects one unattended finite synchronisation. Run it against 1.0.21 and
confirm the expected failure: the CouchDB-owned lifecycle handler excludes
Object Storage. Cover both an ordinary Object Storage profile and a migrated
profile which retains `liveSync: true`; unsupported Continuous must not suppress
the supported `syncOnStart` OneShot policy.

Add passing characterisation tests which inventory automatic P2P periodic,
database-save, editor-save, file-open, and merge triggers, together with P2P
AutoSync, AutoWatch, incoming-request, and nested finite-activity paths. These
tests record current ownership and dialogue behaviour so that later stages do
not accidentally remove a valid automatic path.

## Stage 2: fix issue 1140 through the minimum vertical contract

Add the fixed provider definitions and the minimum user-initiated, unattended,
and Continuous roles to Commonlib. Give `ReplicationService` typed entry points
which carry trigger and interaction policy. Immediately before changing
Object Storage handling, add a failing test in which a stopped or failed
journal transfer must not produce a completed outcome; then propagate the
actual journal result.

Add the LiveSync-owned replication scheduling serviceFeature, remove the resume
handler from `ModuleReplicatorCouchDB`, and route CouchDB Continuous and OneShot
Sync plus Object Storage `syncOnStart` through `ReplicationService`. Its private
context owns scheduling state, module-level functions implement transitions,
and the serviceFeature owns lifecycle and settings-handler registration.
Migrate every automatic caller to
the unattended entry point in this stage, so periodic and event calls cannot
fall back to an interactive P2P role. Migrate manual commands to the
user-initiated entry point.

Replace the factory-registration-only responsibilities of
`ModuleReplicatorCouchDB` and `ModuleReplicatorMinIO` with composed provider
definitions. Retain a module only for separately identified stateful
behaviour; do not retain an instance merely to add a construction handler.

Serialise active initialisation, replacement, and disposal. Publish the active
provider and Replicator as one context after initialisation, clear that context
before retiring the old adapter, and keep each typed dispatch on one context
snapshot. This is the minimum publication fence for this stage. Waiting for
in-flight adapter work and making acquisitions wait for replacement settlement
remain part of the later active-construction migration.

The scheduling context coalesces its network work internally, but an
`onResumed` handler settles once that work has been scheduled. It does not hold
later resume consumers until a OneShot transfer or Continuous start has
settled. Pass one private context with narrow replication, settings, lifecycle,
timer, and logging collaborators to module-level functions. Return only the
daemon-facing control view, pass it to host composition, and inject it into the
CLI command context. Do not retain the view as a public `LiveSyncBaseCore`
property or retain scheduling state in a core-keyed `WeakMap`.

At this boundary, existing P2P AutoSync, AutoWatch, and incoming-request
entry points receive the same non-interactive readiness and accepted-peer gate.
The no-interaction authority reaches counterpart RPC authorisation and
broadcast progress notifications. An unknown peer is blocked rather than
prompting.

Add focused Commonlib owner tests which start an unattended finite room demand
before AutoStart demand and after AutoStart demand. Both orders retain one room
until every remaining demand has settled. The LiveSync feature-binding test
must not rely on the current registration order of equal-priority resume
handlers.

Until Stage 4 supplies target-aware unattended P2P, each host composition
declares generic `P2P_SyncOnReplication` as `not-implemented`. Its automatic
request settles without UI with an explicit blocked result. Existing AutoSync,
AutoWatch, and accepted incoming-request paths continue with the Stage 2 gate.
This is a temporary migration state, not the target matrix in Part 1.

Apply and test the CLI scheduling precedence defined in Part 1, so the daemon
and scheduling context cannot schedule duplicate initial or recurring work.
Replace `ModuleReplicationLifecycle` and the replication-specific
`ModulePeriodicProcess` wiring only after equivalent context and feature-
binding tests pass. Reuse the existing timer implementation behind a narrow
timer port; changing other periodic feature owners is outside this stage.

## Stage 3: make P2P transport ownership truthful

Introduce the stable P2P service and its narrow contract views around the
existing implementation while preserving transfer semantics and changing the
necessary ownership and lifecycle behaviour. Make the active P2P Replicator a
non-owning adapter. Give the service exclusive ownership of room sessions,
session-epoch fencing, effective session binding, room open/close/replacement,
and settings reconciliation. Consolidate overlapping resume and
settings-event handlers.

Migrate Obsidian panes and commands to lifecycle, peer, admission, transfer,
change-relay, configuration-exchange, and diagnostic views as required. Migrate
CLI and WebPeer away from concrete-class checks and raw host or room access.
Preserve RTC diagnostics through `P2PDiagnostics`, rather than retaining
`rawHost`. The compatibility facade may delegate during this stage, but new
consumers cannot receive it.

Separate active-adapter release, room-session leave, and the stop request.
Implement the lower-level cooperative cancellation path before declaring the
P2P stop role supported: caller abort through RPC request cancellation,
incoming-handler signal propagation, signal-bound reverse database RPC calls,
and safe batch-boundary termination in `replicateShim`. Add room-session and
operation controllers beside internal session-demand ownership for finite
operations and policy-held AutoStart, without exposing that bookkeeping as a
general consumer API.

Add ownership regressions immediately before implementation:

- replacing or disposing the active main adapter does not close a policy-owned
  or adjunct room;
- a disposed session fences late callbacks and clients;
- a P2P setting change replaces an adjunct room while another provider remains
  the active main remote;
- persisted peer decisions survive replacement, while temporary decisions and
  advertisements do not;
- local database replacement retires database-bound feeds and publication
  before manager teardown;
- explicit database close settles every dependent cleanup owner before closing
  the physical handle, even when an earlier cleanup reports failure;
- repeated replacement does not retain platform-event subscriptions;
- an active-transfer stop aborts finite operations without closing the room,
  while a later operation can use the same room;
- room retirement aborts both locally initiated and incoming `reqSync` work,
  waits for an already-started atomic database operation to settle, and starts
  no later batch;
- RPC cancellation, timeout, peer departure, and room close abort a
  cancellation-aware handler rather than only discarding its eventual result;
- the inbound request context exists before request admission begins, so a
  cancellation received while admission waits cannot be lost;
- cancellation retains already-settled documents and checkpoints and reports
  `cancelled`, rather than claiming rollback or completion;
- a per-document batch-write failure does not advance the replication
  checkpoint past the failed revision;
- explicit disconnect suppresses AutoStart and relay reconnection until
  explicit connect, while a separately authorised rebuild continuation can
  reopen the room without clearing that automatic-start veto;
- a candidate whose settings, device identity, or database binding changes
  while it opens is retired instead of published; and
- database replacement fences both active-provider and P2P work before
  publishing the new database identity, while a failed candidate leaves one
  observable disconnected state without reviving the fenced session.

When this stage lands, add a supersession note to the accepted P2P lifecycle
record and update `devs.md` from the replaceable concrete Replicator getter to
the stable contract views. Preserve the accepted Trystero peer and relay
ownership rules rather than rewriting their historical verification.

## Stage 4: add target-aware unattended P2P orchestration

Before implementation, add failing regressions for the headless result-loss
path, delayed advertisement, an unaccepted peer, overlapping configured-target
and AutoSync requests, suspension before delayed open, and a finite-operation
demand beside policy-owned AutoStart demand.

Implement target-aware unattended P2P work without UI. Add bounded
advertisement waiting, peer-acceptance outcomes, finite-operation demands beside
policy demands, lifecycle-generation cancellation for delayed opens, and
de-duplication across AutoSync and configured-target baseline requests. Keep
AutoWatch as the relay for later changes rather than treating it as another
baseline transfer.
Route P2P automation through trigger-aware readiness without central-remote
Security Seed preflight. Add the missing finite-activity boundary to direct
shared-pane synchronisation.

Keep the detailed wait, session-demand, de-duplication, and session-epoch state
machine in Part 2 rather than expanding the generic provider contract. If
implementation evidence requires a refinement, amend Part 2 before completing
this stage. After Stage 3 is complete, Part 2 supersedes the
replaceable-Replicator and current-result ownership portions of the accepted
July 2026 record; its Trystero peer and relay decisions remain unchanged.

Commonlib's `docs/p2p-transport-lifecycle.md` design document records the
implemented Stage 3 and Stage 4 ownership, demand, automation, replacement,
and shutdown behaviour. This document remains the migration and verification
sequence rather than a second description of the implemented state.

## Stage 5: separate active construction and flow-specific probes

Make active creation a private, exhaustive `ReplicatorService` operation with
one configuration identity and replacement policy. Migrate every non-active caller
before restricting `getNewReplicator()`: CouchDB connection and passphrase
checks, Object Storage connection and preferred-tweak trials, isolated P2P
Setup, CLI commands, and other host compositions. Prove that every probe leaves
the active main Replicator and adjunct P2P transport unchanged.

Migrate Streaming Fetch to the owned CouchDB initial-transfer dependencies
defined in Part 1. Add replacement-fence, late-settlement,
configuration-identity, cache-invalidation, and probe-disposal tests before
making active construction private.

### Implementation position after Stage 5

The provider-defined active-construction path is now private to
`ReplicatorService`. The public `getNewReplicator` handler remains as a
compatibility surface, but current Self-hosted LiveSync production code no
longer calls it. Its removal belongs to Stage 7 after any external compatibility
decision has been made.

The current host composition has migrated CouchDB and Object Storage connection
checks, passphrase inspection, preferred-tweak reads, CLI remote status and
administration, isolated P2P Setup, and Streaming Fetch Security Seed access to
owned resources or focused services. Active replacement is serialised, context
acquisition waits for a queued replacement, late candidates are fenced, and
short-lived resources are disposed.

This position completes the Stage 5 construction and probe boundary. It is not
itself a release decision: the active-publication and truthful-attempt work in
Stage 6 remains required. Complete retirement of the compatibility facade is
not a prerequisite for issue 1140.

## Stage 6: harden the active lifecycle and exact attempt outcome

Replace the active dependency on `LiveSyncAbstractReplicator` with the small
`ReplicatorInstance` contract. Retain a publication only while its provider and
private configuration identity are unchanged. Every changed identity fences
new admission, requests supported transfer cancellation, drains admitted work,
closes the old instance, and only then constructs and publishes a replacement.

Reserve the exact publication around typed finite dispatch and the currently
required workflow-local directional attempts. Release before recovery or a
dialogue. CouchDB and Journal record an immutable compatibility decision inside
the attempt which owns the connection or borrowed client, and a later mutation
must re-admit that failed context. Retry and Continuous paths reassess on each
new CouchDB connection without adding another logical connection.

Preserve Journal storage read states through `getSyncParameters()`. Only an
explicit `not-found` result permits `SyncParamsHandler` to create and upload new
synchronisation parameters. An unavailable read becomes a fetch failure and
must not regenerate the shared Security Seed. This fixes issue 1147 within the
owned-observation boundary rather than adding another Replicator capability.

### Contracted Stage 6 implementation position

The retained implementation is deliberately smaller than the earlier complete
consumer-migration proposal:

- `ReplicatorInstance` contains only initialisation, `openReplication`,
  transfer termination, and close;
- provider definitions retain user-initiated and unattended OneShot runners,
  an explicit Continuous support decision, readiness, transfer stop, the four
  owned remote resources, and one optional cohesive central-remote administration
  runner;
- every changed configuration identity replaces the active instance; there is
  no same-instance rebind policy;
- typed finite dispatch reserves the exact readiness-tested publication and
  releases it before failure recovery;
- CouchDB and Journal carry only a rejected attempt-local compatibility
  decision into the failure outcome, so a transport failure cannot reuse old
  mutable fields;
- mismatch updates, unlock, and cleaned-remote reconciliation re-admit the
  failed publication before remote mutation;
- P2P uses a narrow non-owning active adapter, takes the same typed finite path,
  supports its real download workflow, and exposes no central facility;
- ordinary central preparation and Streaming Fetch use owned Security Seed
  resources which dispose their unpublished compatibility instances;
- CLI synchronisation diagnoses lock and clean rejection from the exact outcome
  while preserving the existing success and failure return policy; and
- Journal unavailable sync-parameter reads cannot enter the create-and-upload
  branch required only by explicit absence.

The active path no longer depends on the giant facade. Existing maintenance,
remote-size, on-demand Chunk, migration-inspection, and compatibility consumers
may still use focused structural checks or the legacy facade. Their complete
migration, local-node-identity redesign, generic milestone extraction, and
in-process local-database reset redesign are deferred unless a separate bounded
change proves that they are required.

Each production correction has a focused regression. The verification section
distinguishes local source and packed-consumer evidence from registry,
real-runtime, and release validation.

### Active-publication quiescing boundary

Commonlib implements the publication-scoped callback reservation defined in
Part 1 for finite provider dispatch, central-remote administration, exact
recovery mutation, and the workflow-local directional attempts which use the
active instance. Invocation queues its admission decision in the same order as
replacement and disposal. The publication object is its private generation
identity. Once admitted, release is idempotent, private, and independent of
that queue so quiescing cannot prevent the operation which allows its own drain
to settle.

Every switch follows the same order: fence admission, request supported
transfer cancellation, drain admitted callbacks, close, then publish another
context. An unchanged provider and configuration identity keeps the existing
publication.

The first implementation regressions cover:

- replacement waiting for an admitted exact-context task while ignoring an
  unrelated bounded activity;
- context acquisition waiting for a queued replacement rather than returning a
  stale or intermediate publication;
- rejecting central-remote administration releasing its reservation before
  replacement continues;
- finite failure recovery starting only after publication release;
- directional workflow retry releasing and then re-admitting the same context;
  and
- terminal unload draining admitted work before Replicator and local-database
  close, while reversible suspension retains the publication.

Keep readiness, failure presentation, dialogue, independently owned trial
resources, P2P room-session demand, and Continuous replication outside this
reservation. The callback TSDoc forbids awaiting a lifecycle transition which
would wait for the same admission to settle.

## Stage 7: perform a bounded structural review

Confirm that the contracted core is minimum and robust before a commit or
release decision. The active path must stay independent of
`LiveSyncAbstractReplicator`, but complete migration of every compatibility
consumer is separate work. Remove a dummy or abstract requirement only when
its current callers have a truthful alternative; do not turn facade retirement
into a condition for issue 1140.

The retained compatibility surface includes the broad
`LiveSyncBaseCore.replicator` view and concrete central adapters required by
maintenance and migration code. It is explicitly a partial compatibility view,
not the active provider contract. P2P's active adapter does not inherit it.

CouchDB and Object Storage Journal both have a real central milestone document,
but that fact alone does not justify a generic store. Extract a focused contract
only when a second current caller demonstrates the same ownership and mutation
semantics. P2P has no central milestone document and must not receive a stub or
synthetic implementation.

The final structural review retains the following minimum boundaries:

- central provider definitions remain outside `LiveSyncBaseCore`; its thin
  registration method remains as the construction-order composition boundary;
- P2P registration remains with the feature which owns the stable P2P service;
- `ReplicatorService` and `ReplicationService` remain cohesive services. Their
  complex state and policy already reside in `ActiveReplicatorState`,
  `TypedReplicationCoordinator`, the readiness evaluator,
  `RemoteResourceResolver`, and `CentralRemoteAdministrationCoordinator`, so
  another split would not improve the current test seams;
- every provider explicitly declares Continuous support or inapplicability;
- `IReplicatorService` exposes only acquired or admitted active-context access.
  A protected synchronous inspector remains for focused lifecycle tests;
- central-compatibility statuses, recorders, and projection helpers remain
  package-internal. Only stable rejection reason codes and public recovery
  value types remain package-index exports; and
- redundant recovery-kind data, unused active-state identity matching, and the
  externally visible legacy administration lookup helper are removed.

LiveSync implements its optional central-remote administration facility through one
shared protocol executor and provider-specific milestone readers. Provider
composition selects the reader; a reader validates only the structural
operations required for its CouchDB connection or Journal client before any
remote mutation. It does not impose concrete-class identity on the generic
runner contract.

The unpublished public contract, provider field, coordinator, and service
operation use the `CentralRemoteAdministration*` name because their complete
protocol is central-milestone-specific. The central OneShot adapters use a
separate local structural operation instead of concrete-class identity. Stable
capability-kind comparisons use `CAPABILITY_SUPPORT_KINDS`, and unavailable
capabilities settle once without a redundant post-narrowing check.

Provider-specific configuration identities remain explicit projections of the
settings which bind each adapter. They are not replaced with a generic identity
builder: the current URL normalisation and setting lists are clearer at the
provider boundary, and changing the shared header parser is separate work.

The review records, but does not prejudge, whether maintained Rebuild and Fetch
workflows still require an in-process local-database reset. Prefer a Flag File and restart
boundary if it can preserve user intent, CLI behaviour, failure recovery, and
the maintained test workflows without losing a supported continuation path.
Until that evidence exists, retain the current reset contract and its explicit
Replicator-retirement ordering rather than assuming that every workflow has
already moved to a restart.

It also records consumers which retain `LiveSyncLocalDB`, its physical PouchDB
handle, or its managers. If broad retention still leaks ownership after the
consumer migrations, keep the physical handle and teardown authority in
`LiveSyncLocalDB`, and expose only the smallest read-only view or
generation-bound operation contract required by each consumer. Do not cache a
detached handle snapshot across reset. Preserve the current single active
database contract, and add another abstraction only where the inventory shows
a concrete lifetime or testability benefit. These recorded questions do not
widen Stage 6 or make an anticipatory database abstraction part of this change.

## Verification

### Commonlib unit and type-contract tests

Cover:

- exhaustive host-composed definitions for CouchDB, Object Storage, and P2P;
- the four-method active `ReplicatorInstance` contract and provider-owned
  runtime roles;
- user-initiated, unattended, blocked, partial, cancelled, and failed OneShot
  outcomes;
- truthful Object Storage stop or transfer failure and headless P2P outcomes;
- active, quiescing, disposed, and replacement-published states, including
  rejection of new work during retirement, acquisition waiting, and late
  candidate settlement;
- unchanged-identity retention, changed-identity replacement, idempotent
  reservation release, and close ordering;
- probes which cannot replace the active Replicator or P2P service and dispose
  owned resources;
- the deliberately narrow active-transfer stop request, including work it
  does not claim to cancel;
- CouchDB compatibility and transfer using the same owned OneShot connection;
- Journal compatibility and transfer using one settings-bound borrowed client;
- attempt-local accepted, rejected, and not-assessed decisions, including retry
  and Continuous reassessment on newly opened CouchDB connections;
- Journal synchronisation-parameter reads distinguishing explicit absence from
  unavailability and never writing after the latter;
- cohesive central administration and its truthful mutation settlement; and
- the narrow non-owning P2P active adapter, including download without a
  synthetic upload or central facility.

### Self-hosted LiveSync unit tests

Cover:

- Object Storage `syncOnStart` through resume, including a migrated profile
  which retains `liveSync: true`;
- existing CouchDB Continuous and OneShot paths;
- same-generation resume coalescing, a fresh attempt after a later lifecycle
  generation, and rejection of an obsolete generation's OneShot fallback;
- a queued Periodic callback rechecking lifecycle and recurring-work ownership
  after its interval has been disabled;
- the daemon's satisfied initial OneShot marker being consumed even when a
  Continuous start throws, so a later resume may retry normally;
- periodic, database-save, editor-save, file-open, merge, and daemon triggers
  remaining free of dialogues;
- manual P2P and configured peer-targeted flows remaining available;
- P2P AutoStart cancellation across suspension, bounded advertisement waiting,
  accepted peers without unattended dialogues, remote-broadcast prerequisites,
  session-demand reference counts, and overlapping peer policies;
- the seven P2P service views sharing one room owner without exposing a raw
  host, room, or concrete Replicator;
- session replacement fencing callbacks, clients, temporary decisions,
  advertisements, and database-bound feeds while retaining persisted decisions;
- counterpart RPC authorisation and broadcast progress preserving no-dialogue
  authority;
- Setup and settings validation through probes;
- exact failed-context mismatch, unlock, and cleaned-remote recovery, including
  rejection after active replacement;
- CLI lock diagnostics from the exact finite outcome rather than mutable fields
  on a later active Replicator;
- first-device and additional-device initialisation for each current provider;
- P2P as the main remote and as an adjunct transport; and
- CLI, WebApp, and WebPeer composition against the same contracts, including
  daemon scheduling after settings restoration and P2P AutoStart reconciliation
  after a settings change.

### Focused integration and real-Obsidian verification

Cover an Object Storage change arriving immediately after start-up without
waiting for the periodic interval, ordinary CouchDB start-up, and P2P start-up
without an unexpected selection dialogue or transport replacement. P2P
validation also covers an accepted configured peer advertising after room open,
a watched peer whose remote side broadcasts, and suspension before a delayed
AutoStart callback. Object Storage validation must also confirm that a
temporarily unavailable synchronisation-parameter read does not upload a new
Security Seed.

No temporary stage is a release candidate. Release readiness requires the
target capability matrix, the contracted core and in-scope consumer migration,
focused downstream checks with the exact packed Commonlib artefact, and the
real-runtime checks appropriate to the changed boundary. Complete legacy-facade
retirement remains a separately reviewed compatibility change.

## References

- [Part 1: core contract](2026_08_replicator_capabilities_01_core_contract.md)
- [Part 2: P2P service and session lifecycle](2026_08_replicator_capabilities_02_p2p_service_lifecycle.md)
- [P2P Room and Transport Lifecycle](2026_07_p2p_transport_lifecycle.md)
- [P2P Transport Compatibility Controls](2026_08_p2p_transport_compatibility.md)
- [Bounded Remote Activity](2026_07_bounded_remote_activity.md)
- [Self-hosted LiveSync issue 1140](https://github.com/vrtmrz/obsidian-livesync/issues/1140)
- [Self-hosted LiveSync issue 1147](https://github.com/vrtmrz/obsidian-livesync/issues/1147)
