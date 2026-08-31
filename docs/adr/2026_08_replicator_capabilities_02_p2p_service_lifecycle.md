---
date: 2026-08-27
commonlib-version: "0.1.19"
self-hosted-livesync-version: "1.0.21"
status: proposed
series: replicator-capabilities-and-lifecycle
part: 2 of 3
---

# Architectural Decision Record: Replicator Capabilities and Lifecycle Orchestration — Part 2: P2P Service and Session Lifecycle

Series navigation: this is Part 2 of 3. Read [Part 1: core contract](2026_08_replicator_capabilities_01_core_contract.md)
first, then continue with [Part 3: migration plan and verification](2026_08_replicator_capabilities_03_migration_plan.md).

## Status

Proposed. This record defines the P2P service owner, room-session boundary,
narrow contract views, automation demands, replacement fencing, and trigger
semantics. Generic provider and capability rules are owned by Part 1; the
implementation and verification order is owned by Part 3.

The implemented state is recorded separately in Commonlib's
`docs/p2p-transport-lifecycle.md` design document. It supersedes the
replaceable LiveSync P2P Replicator and current-result ownership described by
the accepted [P2P Room and Transport Lifecycle](2026_07_p2p_transport_lifecycle.md)
record. The accepted record's decisions about serialised room operations,
`room.leave()`, Trystero-owned physical peers, and relay reconnection remain in
force. This ADR remains the decision and migration target; the Commonlib
design document records the names and ownership boundaries which actually
landed.

## Scope and context

The Commonlib P2P feature currently spans `TrysteroReplicatorP2PServer`,
`TrysteroReplicator`, and the LiveSync-specific `LiveSyncTrysteroReplicator`.
The current result resolves a replaceable Replicator while the room, signalling,
watch, broadcast, diagnostics, platform-event subscriptions, and database
feeds have longer-lived relationships. Installing that replaceable object as
the active Replicator makes ordinary active-handle disposal capable of closing
an adjunct or policy-owned room.

The same room membership serves several independent behaviours:

- P2P AutoStart opens the room and signalling service;
- AutoSync reacts to an advertised and accepted peer with one finite transfer;
- AutoWatch follows later changes broadcast by a selected peer;
- AutoBroadcast publishes local database changes;
- explicit commands pull, push, or synchronise against a selected peer;
- incoming `reqSync` requests pull from an accepted peer; and
- diagnostics and platform events observe the transport.

These behaviours must share one room owner, but they must not share one
implicit policy. A setting change may replace the room session while another
provider remains the selected main remote. A setup probe must not close that
session. A finite operation may need a room even when AutoStart is disabled.

## Decision

### One stable P2P service owns each room session

The host composes one stable P2P service independently of the selected main
provider. It may be present as an adjunct beside CouchDB or Object Storage, or
its non-owning adapter may serve as the selected main P2P Replicator. The host
owns the service lifetime; the service owns all LiveSync-specific room
resources.

A **P2P room session** is one active room membership and every resource whose
validity depends on that membership:

- the Trystero room, RPC actions, and `RpcRoom`;
- its internal session epoch, session controller, and finite-operation
  registry;
- advertisement state and temporary peer decisions;
- peer-bound RPC clients and remote database proxies;
- connection, diagnostic, and platform-event subscriptions; and
- RPC publication, the watch set, database and broadcast change feeds, and
  in-flight finite-transfer de-duplication bound to the local database.

A **session epoch** is the internal identity and fence of one room-session
object. It is not a public capability, a persisted profile identifier, or a
synonym for the logical room. Peer callbacks and finite-operation tokens carry
that identity and cannot be routed into a replacement session.

Closing or replacing a session fences its epoch, stops new operations, settles
or fails in-flight work, closes RPC and client resources, and leaves the room
in the transport-owned order. Persisted peer acceptance decisions survive;
temporary decisions, advertisements, clients, listeners, and feeds do not.
The underlying WebRTC peer remains under Trystero's shared-peer ownership as
specified by the accepted lifecycle record.

### Expose narrow contract views

The service does not expose a room session, raw host, or concrete Replicator to
ordinary consumers. It supplies these views over the same owner:

1. `P2PTransportLifecycle` observes room state and accepts explicit,
   user-owned connect or disconnect requests.
2. `P2PConnectionProbeAdmission` arbitrates a complete Setup signalling check
   against the current relay binding without exposing or replacing the room.
3. `P2PPeerDirectory` supplies peer snapshots and peer arrival or departure.
4. `P2PPeerAdmission` evaluates incoming peers and administers temporary or
   persisted acceptance decisions.
5. `P2PTargetedTransfer` performs pull, requested push, and bidirectional
   finite synchronisation against an explicit peer, and executes the persisted
   configured-target set without interactive peer selection.
6. `P2PChangeRelay` administers peer watch and local-change broadcast.
7. `P2PConfigurationExchange` performs peer configuration exchange under its
   declared interaction authority.
8. `P2PDiagnostics` supplies status and RTC diagnostics without exposing raw
   room or peer connections.

These are stable service-level contract views, not independent wrapper or state
owners. One implementation may satisfy several views.
Advertisement and admission state remain under one peer-access owner, while
pull, push, and bidirectional transfer remain under one transfer owner. A
consumer which needs more than one view receives those views explicitly; it
does not receive a general P2P context or service locator.

The views resolve the current published session at invocation. Finite transfer
work which carries an old epoch is rejected or cancelled rather than dispatched
into a replacement. A configuration or diagnostic request which was already
admitted may settle against its originating session, while persisted peer
admission decisions intentionally settle independently of room replacement.
These operations are outside active-transfer cancellation and cannot publish
the former session's peer callbacks or status into its replacement. The epoch
remains internal. The active P2P Replicator is a non-owning adapter over the
views, and its disposal cannot implicitly leave the service-owned room.

### Make explicit disconnect a veto, not another policy demand

`P2PTransportLifecycle` distinguishes user intent from automation:

- explicit connect resumes relay reconnection and establishes a user-owned
  room demand;
- explicit disconnect is the sole force-close path, retires the current
  session, invalidates all demands under the retirement contract, pauses relay
  reconnection, and establishes a service-lifetime veto against AutoStart; and
- only a later explicit connect clears that veto.

Automated policies and finite operations acquire or release only their own
demands. They cannot close a room held by another demand and cannot override an
explicit disconnect veto. This is a lifecycle veto, not the opposite of
`InteractionAuthority`: local interaction authority is the upper bound used by
operations, as specified in Part 1. An operation may impose a stricter veto,
but an unattended operation cannot gain permission to open a dialogue.

`EVENT_DATABASE_REBUILT` is a separately authorised continuation of the owning
Rebuilder workflow, not an AutoStart demand. After the replacement database is
ready, that continuation may request a room independently of the AutoStart
veto. It does not clear the veto for later automatic-start events.

Host lifecycle closure has a second, private, reversible state. The host sets
that state before it cancels delayed automation and closes the room. While it
is set, settings reconciliation and finite stable-view operations cannot add a
room demand. Only explicit connect, database-rebuild continuation, or the
AutoStart schedule established by a resumed host lifecycle clears it; merely
reconciling saved settings does not.

This state does not replace or clear the explicit-disconnect veto. Explicit
connect clears both states, resumed AutoStart still observes the user's veto,
and Rebuild remains the separately authorised continuation described above.
The distinction is private service policy, not another public capability or
room owner.

### Separate automation policy from room ownership

P2P automation is a composed service feature. It owns `P2P_AutoStart`,
AutoSync, AutoWatch, and AutoBroadcast policy, including delayed work and
automatic-trigger coalescing. It consumes the transport, peer, admission,
transfer, and change-relay views but does not own their mutable state.

`P2PChangeRelay` owns the actual watch set and database changes feed.
`P2PTargetedTransfer` owns explicit finite-transfer and configured-target
execution. The stable automation coordinator owns baseline de-duplication
shared by AutoSync and configured-target requests. Incoming-peer consent is
distinct from a local caller's authority to select a peer or open a dialogue.
Persisted or automatic acceptance may authorise an unattended path; it cannot
create local interaction authority implicitly.

Every finite operation which needs a room obtains an internal demand from the
room-session owner. Once a session admits the operation, that session owns its
operation controller and settlement. The operation consumes an effective
signal composed from the room session, its operation controller, and any
narrower caller or incoming-RPC signal. Neither the adapter nor the UI consumer
owns this bookkeeping.

Acquiring another demand does not open another session. Releasing it never
closes a session still required by AutoStart, another finite operation, or
another host consumer. A request to stop active transfer aborts the registered
finite-operation controllers but does not abort the room-session controller;
the room remains usable and later transfers obtain fresh operation controllers.
Retiring the room session aborts its session controller, which cancels every
remaining child operation. Demand and controller bookkeeping is internal to the
service and is not a general consumer contract; it cannot turn a finite transfer
into persistent transport policy.

Cancellation is cooperative and does not roll back durable work. Pull,
requested push, and bidirectional synchronisation propagate the effective
signal through the initiating RPC, incoming `reqSync`, the reverse database RPC
calls, and the replication batch loop. An atomic PouchDB read or write which has
already begun may settle. If a batch write has begun, the operation processes
its successful writes and records the batch checkpoint only after every
required revision has settled successfully. Cancellation before the write does
not advance that checkpoint. The operation then reports a cancelled result and
does not start another batch. Session retirement awaits that settlement before
releasing RPC and room resources.

### Reconcile session settings atomically

The effective P2P session binding is derived from the selected profile, the
settings which affect transport, the device identity, and the current local
database identity. It is not a new persisted profile identifier or a
device-local override. Automation and admission policy is reconciled on the
current room. The service reconciles the binding independently of the selected
main provider, so an adjunct room can be replaced while CouchDB or Object
Storage remains active.

A change to any binding input retires the whole room session and opens a
replacement when policy still requires one. A profile-selection or policy-only
change which preserves the effective binding keeps the room and reconciles its
current policy. A real replacement preserves one atomic listener and policy
boundary: advertisements and temporary peer decisions are reacquired, while
persisted peer decisions survive. AutoStart reconnects when it remains enabled,
host lifecycle closure has been resumed, and no explicit-disconnect veto is
active. No old listener, credential, client, or policy demand remains reachable
after replacement.

The candidate captures its settings, device identity, and local database object
when it is constructed. The owner re-reads the effective binding after the room
has opened and publishes the candidate only when it still matches. A setting or
database change during open therefore retires the stale candidate rather than
making it current.

Reconciliation is serialised with room lifecycle operations:

1. fence new session work;
2. abort the old session's finite-operation scopes and await their cooperative
   settlement;
3. close and leave the old room in transport-owned order;
4. open and validate the candidate session; and
5. publish the replacement only after it has opened successfully.

The service never exposes a partly initialised candidate or treats a cancellation
request as rollback. If bounded settlement or candidate opening fails,
reconciliation reports the failure and publishes no mixed old and new session.
A candidate-open failure leaves one observable disconnected state with policy
demands unsatisfied; it does not revive the fenced session or start an unbounded
retry loop. A later lifecycle trigger or explicit connect may retry.

### Order local database replacement across both owners

The database lifecycle transition owns ordering above `ReplicatorService` and
the P2P service:

1. fence acquisition of active Replicator and P2P room work;
2. retire the active adapter;
3. settle and retire P2P database-bound feeds and publication;
4. publish the replacement local database identity only after both boundaries
   have settled;
5. rebind or replace the active provider;
6. reconcile P2P against the new database identity; and
7. let the Rebuilder request its separately authorised reopen.

Each service serialises its own resources. The database transition owns the
cross-service ordering rather than introducing one transport-wide lock. Reset
preparation and explicit database close both await service-owned room
retirement before database managers are torn down and the old physical handle
is destroyed or closed. Explicit close settles every registered cleanup handler
sequentially, even when an earlier cleanup fails; its aggregate result is
diagnostic rather than a close veto.

### De-duplicate by logical lifecycle, not by room epoch

Completed AutoSync baselines are scoped by normalised peer name and application
lifecycle generation. In-flight baseline promises are indexed by normalised
peer name until they settle. Trigger provenance and session epoch are not part
of either lookup, so a transport-only reconnect cannot repeat an in-flight or
completed baseline transfer.

Both the in-flight baseline promise and completed baseline history belong to
the stable automation coordinator and survive transport-only or policy-only
session replacement. The originating room session still owns cancellation and
settlement of the actual transfer. A lifecycle or logical-identity change clears
completed history, but does not clear an in-flight promise. A request for the
same normalised peer name may therefore share that promise until it settles.
Work from an older automation generation may settle, but cannot publish
completion into the current generation. Only completed per-peer baselines are
recorded; partial requests record completed peers only, while blocked,
cancelled, failed, and incomplete peers remain eligible for a later bounded
retry.

The automation owner clears settled records when the logical peer namespace or
local database identity changes. It retains them across transport-only and
policy-only replacement. Watch may follow a later advertised change, but does
not immediately repeat a completed baseline transfer.

### Define the P2P trigger matrix

| Trigger                 | Required preconditions                                                                               | Effect                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `P2P_AutoStart`         | P2P enabled, resumed lifecycle, cleared host closure, and no user disconnect veto                    | Open room; do not itself transfer files      |
| `P2P_AutoSyncPeers`     | Open room, matching advertisement, and accepted peer policy                                          | Run one bidirectional finite synchronisation |
| `P2P_AutoWatchPeers`    | Open room, matching accepted advertisement, and remote broadcasting                                  | Pull later announced updates                 |
| `P2P_AutoBroadcast`     | Open room and local broadcasting enabled                                                             | Announce later local database changes        |
| `P2P_SyncOnReplication` | Cleared host closure, no disconnect veto, configured names, and advertisements within a bounded wait | Run target-aware unattended OneShot Sync     |
| Explicit peer command   | Supplied peer target and accepted connection                                                         | Run user-owned finite synchronisation        |
| Incoming `reqSync`      | Accepted peer and ordinary readiness                                                                 | Pull from requesting peer                    |

`P2P_AutoStart` is a transport policy, not central Continuous replication and
not `syncOnStart`. AutoSync, AutoWatch, and accepted incoming requests remain
unattended when their persisted policies permit them. A configured-target
request waits for advertisement for a bounded period; it does not inspect a
possibly stale snapshot immediately after opening. Missing, undiscovered,
unaccepted, or partly successful targets are explicit operation results. An
unknown peer never opens an acceptance dialogue on an unattended path.
An enabled P2P provider with an empty configured target set settles as
`blocked/no-targets`; it is not reported as an unconfigured provider.

Delayed opens belong to the lifecycle generation which scheduled them.
Suspension cancels them or makes them harmless, and the callback rechecks
current settings and suspension state before opening. Ordinary automation uses
the trigger-aware readiness policy rather than bypassing readiness, pending-file
settlement, clean-up, or version gates. Fetch and Rebuild retain their
separately authorised bypasses.

### Arbitrate Setup signalling checks through the room owner

The current Setup check establishes only whether its signalling transport can
be opened. It does not validate peer discovery, room credentials against
another device, or a TURN or WebRTC data path. The host therefore receives a
`P2PConnectionProbeAdmission` view over the existing room-session owner instead
of constructing an uncoordinated second transport.

The admission receives the requested relay settings and a continuation which
owns one short-lived raw signalling trial. The room owner serialises the whole
decision on its existing lifecycle queue:

- a serving room whose active relay set covers every requested relay returns
  `observed-active` without entering the continuation;
- a serving room which does not cover the requested relay set returns the
  stable `active-p2p-relay-binding-conflict` decision code without entering the
  continuation; and
- an idle owner runs the continuation and does not settle admission until the
  caller has disposed the raw Replicator and its temporary database.

Relay admission uses the same split-and-trim projection as transport setup,
then compares de-duplicated sets. It does not infer URI equivalence which the
Trystero relay key does not implement. The continuation must not await another
lifecycle transition on the same service while it holds this serialisation
boundary.

This view adds neither a second room owner nor a process-global relay lease.
It does not change raw `TrysteroReplicator.dispose()` semantics, pause or close
an active relay, or silently retire the active service to make an incompatible
trial possible. A future check which genuinely needs peer-, room-, TURN-, or
WebRTC-level evidence requires its own bounded contract rather than widening
this signalling-only result implicitly.

### Keep provider composition explicit

The stable P2P service can be composed even when P2P is not the selected main
provider, while the generic provider table in Part 1 can include or omit the
P2P provider at compile time. No runtime unknown-provider registry is implied.
When P2P is selected as main, its active adapter delegates to this same service
and does not publish a second P2P lifecycle owner.

## Consequences

- P2P room, signalling-check admission, peer, watch, acceptance, transfer,
  configuration, and diagnostics have one explicit owner and focused
  contracts.
- Disposing an active adapter cannot close a policy-owned or adjunct room.
- Explicit user disconnect has a clear veto boundary and cannot be undone by
  AutoStart or a finite operation.
- Host lifecycle closure cannot be undone by settings reconciliation or a
  finite operation before an explicit resume boundary.
- Finite operations can request a room without changing persistent room policy.
- Settings and local database replacement cannot publish mixed-session state.
- Reconnects do not repeat completed baseline transfers merely because the room
  epoch changed.
- Setup can observe a compatible active signalling binding or run an idle
  trial without mutating the active transport; an incompatible active binding
  is reported explicitly.

## Non-goals

- Do not make the P2P service a general service locator.
- Do not expose room, raw host, peer connection, or concrete Replicator state
  to ordinary consumers.
- Do not make P2P own a central remote database.
- Do not reinterpret P2P AutoStart as `syncOnStart` or central Continuous
  replication.
- Do not replace the accepted Trystero physical-peer and relay ownership
  decisions.
- Do not add unbounded retry loops or pretend that a missing lower-level stop
  operation is end-to-end cancellation.

## References

- [Part 1: core contract](2026_08_replicator_capabilities_01_core_contract.md)
- [Part 3: migration plan and verification](2026_08_replicator_capabilities_03_migration_plan.md)
- [P2P Room and Transport Lifecycle](2026_07_p2p_transport_lifecycle.md)
- [P2P Transport Compatibility Controls](2026_08_p2p_transport_compatibility.md)
- [Bounded Remote Activity](2026_07_bounded_remote_activity.md)
