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
release follows only after the target matrix, ownership boundaries, and all
production-consumer migrations in Parts 1 and 2 are complete.

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
an explicit same-kind rebind-or-replace policy. Migrate every non-active caller
before restricting `getNewReplicator()`: CouchDB connection and passphrase
checks, Object Storage connection and preferred-tweak trials, isolated P2P
Setup, CLI commands, and other host compositions. Prove that every probe leaves
the active main Replicator and adjunct P2P transport unchanged.

Migrate Streaming Fetch to the owned CouchDB initial-transfer dependencies
defined in Part 1. Add replacement-fence, late-settlement,
configuration-identity, cache-invalidation, and probe-disposal tests before
making active construction private.

## Stage 6: migrate safety-sensitive and provider-specific consumers

Migrate Setup, Rebuilder, tweak review, remote-size inspection, on-demand Chunk
retrieval, migration inspection, maintenance, and abort commands. Central
mutations settle truthfully before Rebuilder continuation. Compromised-Chunk
inspection uses `observed` or `unavailable`; an offline check is never zero.
Object Storage and P2P no longer supply dummy integrity counts, remote Chunk
results, or Security Seeds through the compatibility facade.

Move local node identity initialisation out of the provider facade. Add
idempotent asynchronous disposal and settlement tests, same-kind profile
rebind-or-replace tests, and bounded activity around the host-owned garbage-
collection workflow's CouchDB OneShots. Each consumer migration removes the
corresponding generic `remoteType` or `instanceof` feature branch and adds a
focused test.

Transport-specific settings may continue to display provider kind. Provider
identity is valid for labels and provider-specific configuration; it is not a
generic feature test.

## Stage 7: retire the giant compatibility facade

After every current consumer has migrated, stop requiring unsupported methods
on `LiveSyncAbstractReplicator`. Retain or remove compatibility exports at the
next Commonlib compatibility boundary. Do not retain dummy methods only because
the former abstract base declared them.

## Verification

### Commonlib unit and type-contract tests

Cover:

- exhaustive host-composed definitions for CouchDB, Object Storage, and P2P;
- complete support declarations and matching runtime roles;
- user-initiated, unattended, blocked, partial, cancelled, and failed OneShot
  outcomes;
- truthful Object Storage stop or transfer failure and headless P2P outcomes;
- observed and unavailable compromised-Chunk results, including offline;
- active, retiring, disposed, and replacement-published states, including
  rejection of new work during retirement and late settlement;
- same-kind rebind or replacement, configuration-identity invalidation,
  idempotent asynchronous disposal, and settlement ordering;
- probes which cannot replace the active Replicator or P2P service and dispose
  owned resources;
- the deliberately narrow active-transfer stop request, including work it
  does not claim to cancel;
- central full-transfer and remote-administration boundaries; and
- provider-specific P2P, CouchDB, and journal facets.

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
AutoStart callback.

No temporary stage is a release candidate. Release readiness requires the
target capability matrix, production-consumer migration, focused downstream
checks with the exact packed Commonlib artefact, and the real-runtime checks
appropriate to the changed boundary.

## References

- [Part 1: core contract](2026_08_replicator_capabilities_01_core_contract.md)
- [Part 2: P2P service and session lifecycle](2026_08_replicator_capabilities_02_p2p_service_lifecycle.md)
- [P2P Room and Transport Lifecycle](2026_07_p2p_transport_lifecycle.md)
- [P2P Transport Compatibility Controls](2026_08_p2p_transport_compatibility.md)
- [Bounded Remote Activity](2026_07_bounded_remote_activity.md)
- [Self-hosted LiveSync issue 1140](https://github.com/vrtmrz/obsidian-livesync/issues/1140)
