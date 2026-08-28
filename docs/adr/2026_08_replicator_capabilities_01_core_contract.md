---
date: 2026-08-27
commonlib-version: "0.1.19"
self-hosted-livesync-version: "1.0.21"
status: proposed
series: replicator-capabilities-and-lifecycle
part: 1 of 3
---

# Architectural Decision Record: Replicator Capabilities and Lifecycle Orchestration — Part 1: Core Contract

Series navigation: this is Part 1 of 3. Continue with [Part 2: P2P service and
session lifecycle](2026_08_replicator_capabilities_02_p2p_service_lifecycle.md),
then [Part 3: migration plan and verification](2026_08_replicator_capabilities_03_migration_plan.md).

## Status

Proposed. This record defines the provider, capability, lifecycle, interaction,
ownership, and probe boundaries required by current Self-hosted LiveSync
consumers. It is the generic part of the series; the P2P-specific ownership
rules live in Part 2, and implementation sequencing lives in Part 3.

The accepted P2P room and transport lifecycle record remains authoritative for
the current P2P implementation until Stage 3 in Part 3 is complete. The
supersession boundary for that record is stated in Part 2 and is not repeated
here.

## Context

Self-hosted LiveSync currently represents CouchDB, Object Storage, and P2P with
one `LiveSyncAbstractReplicator` base class. That base class requires finite
and continuous replication, full upload and download, remote creation and
reset, lock administration, preferred-tweak Metadata, on-demand Chunk reads,
remote status, integrity inspection, and connected-device inspection.

These operations do not share one support boundary:

- CouchDB supports unattended OneShot Sync, Continuous replication, central
  remote administration, and CouchDB-specific inspection and maintenance.
- Object Storage supports finite journal synchronisation, central reset and
  lock Metadata, full upload and download, and storage-size inspection. It has
  no continuous changes feed, CouchDB Chunk source, CouchDB integrity
  inspection, or CouchDB device registry.
- P2P supports peer-targeted finite transfer and an independently owned room,
  signalling, watch, and broadcast lifecycle. It has no central database to
  create, reset, lock, inspect for size, or upload during first-device setup.
  It also has peer-driven AutoSync and AutoWatch paths when the room is open.
  Those paths are detailed in Part 2.

The abstract class makes absent capabilities look like operations. Current
implementations express absence through thrown errors, `false`, empty arrays,
zero counts, silent success, and a dummy all-zero Security Seed. Callers
cannot tell whether an operation was performed, was inapplicable, or could not
be performed.

A neutral value is correct only when it is the documented identity for every
caller. For example, Object Storage has no remote-Chunk role, whereas a
supported CouchDB Chunk request may legitimately return an empty array. A
zero integrity count cannot safely stand for an inspection which did not run.

Issue 1140 exposes the lifecycle consequence. In version 1.0.21,
`ModuleReplicatorCouchDB` owns the application resume callback and excludes
Object Storage and P2P by `remoteType`. Object Storage accepts `syncOnStart`,
but no journal synchronisation starts at resume. Periodic, event-driven, and
manual calls later reach the active Replicator successfully.

The construction boundary is also overloaded. `getNewReplicator()` is an
order-dependent first-result handler which ignores false results and catches
handler errors. It is used for active Replicator acquisition, trial settings,
and temporary command instances. P2P construction can replace and close a
service-owned current transport, so an apparently temporary request can
disturb an active or adjunct transport.

Fast Setup is a separate boundary. Streaming Fetch is a CouchDB-specific
initial transfer which uses CouchDB HTTP settings and a Security Seed supplier;
it does not need a full Replicator or an owned PouchDB connection. It must not
be made a generic Replicator capability merely because the current code obtains
one as a supplier.

Finally, current operation results can hide failure. Object Storage can discard
a failed or stopped journal result and report success. A headless P2P path can
complete but return `undefined`, which the caller interprets as failure. Remote
mutations can be caught or ignored before Rebuilder continuation, and an
offline integrity inspection can be represented as zero. The contract must
make those outcomes truthful.

## Decision drivers

The design must:

1. cover every operation used by the plug-in, CLI, WebApp, WebPeer, Setup,
   Rebuilder, and maintenance flows;
2. keep lifecycle policy independent of provider class names;
3. make an omitted support decision a compile-time error when a current
   provider or capability is added;
4. carry trigger and interaction policy through `ReplicationService`, so an
   automatic trigger cannot open a dialogue;
5. distinguish capability absence, unavailable observation, and an observed
   empty value where that difference affects safety;
6. retain simple neutral results where they are safe identities for every
   caller;
7. give active Replicator, flow-specific probe, and transport resources one
   explicit owner and disposal boundary; and
8. report replication, central-remote mutation, and maintenance outcomes
   truthfully while preserving source compatibility during migration.

## Decision

### Use precise ownership terms

- A **provider definition** is the host-composed, exhaustive declaration for
  one current remote kind.
- The **active Replicator** is the selected main-remote handle owned by
  `ReplicatorService`.
- A **probe** is a short-lived, flow-specific validation resource whose caller
  owns disposal.
- The **P2P service** is the stable Commonlib implementation which supplies
  narrow P2P contract views. Its room-session ownership is defined in Part 2.
- A **room session** and **session epoch** are P2P terms defined in Part 2; an
  epoch is an internal fence, not a public capability or logical room name.

An active Replicator is a handle, not necessarily the owner of every transport
which it uses. In particular, the active P2P Replicator is a non-owning adapter
over the P2P service. Its ownership consequences are specified once in Part 2.

### Separate policy, provider selection, and the active Replicator

Application lifecycle policy decides **when** synchronisation is requested.
The selected provider and its active Replicator decide **how**, and whether,
that request can be performed. A provider module must not subscribe to the
application resume lifecycle merely because it can construct a transport.

Self-hosted LiveSync will compose one LiveSync-owned serviceFeature as the
replication scheduling boundary. The serviceFeature constructs one private
scheduling controller and connects it to `AppLifecycleService`, settings
lifecycle events, and the periodic timer. The controller owns only scheduling
state and transitions: external-poller ownership, Continuous ownership of
recurring work, the daemon's satisfied initial OneShot marker, resume
coalescing, and periodic-timer reconciliation. It does not register handlers
or acquire `LiveSyncBaseCore`.

The controller receives narrow collaborators for readiness and suspension
queries, current settings, `ReplicationService`, periodic-timer control, and
diagnostic logging. The surrounding serviceFeature owns lifecycle registration
and adapts those Services to the controller. It returns a focused control view
containing only the daemon operations to select external polling and mark the
initial OneShot as satisfied. The host may retain that view for the CLI, but
must not expose the controller's mutable state or recover it from a core-keyed
global or `WeakMap`.

This boundary is not a ServiceModule merely because it owns state. It neither
owns a shared external resource nor supplies a general operational capability
to several unrelated consumers. If a future consumer needs a stable shared
scheduling capability beyond the focused CLI view, that ownership decision
must be reviewed explicitly rather than widening the controller implicitly.

The scheduling controller uses persisted settings, `ReplicationService`, and
the active support declaration. It does not branch on `remoteType` or use
`instanceof` as a capability test. Commonlib owns the trigger-aware replication
contract; the host owns application lifecycle wiring.

The existing `onResumed` event remains the eligible-resume boundary after
initial readiness, settings application, and visibility recovery. It is not
redefined as a once-per-process event. The controller coalesces duplicate work
within one lifecycle generation and preserves readiness and suspension gates:

- configured Continuous replication starts only through an active Continuous
  role;
- otherwise, configured `syncOnStart` runs through an unattended OneShot role
  when that role is supported;
- an unsupported configured policy produces an explicit unsupported or
  not-implemented result; and
- automatic start-up, periodic, file-event, and merge triggers never open a
  dialogue. A target-requiring operation is available to an explicit user
  action or to a flow with a configured target.

`ReplicationService` remains responsible for readiness checks, bounded finite
activity, failure processing, and replication timing. It exposes distinct
user-initiated and unattended entry points, or a typed request which carries
interaction authority. The scheduling controller never calls a concrete
Replicator's `openReplication()` directly.

`P2P_AutoStart` remains a separate P2P room policy. It is not central
Continuous replication and is not `syncOnStart`; its service lifecycle is
specified in Part 2. Reopening after `EVENT_DATABASE_REBUILT` is a
flow-authorised continuation requested by the Rebuilder, not evidence that
AutoStart is enabled.

Correctness must not depend on the registration order of equal-priority resume
handlers. P2P AutoStart records persistent room demand, while an unattended P2P
OneShot records finite room demand. `P2PRoomSessionOwner` serialises both and
retains the room while either demand remains. Provider-specific P2P lifecycle
wiring and host replication scheduling may therefore run in either order.
Focused owner tests cover AutoStart-before-OneShot and OneShot-before-AutoStart;
the host feature-binding test must not encode their current registration order
as a scheduling prerequisite.

The CLI daemon owns its initial finite convergence before its mirror scan.
Restored settings mark that convergence as satisfied for the current lifecycle
generation, so `syncOnStart` does not repeat it. In `--interval` mode, the
daemon poller is the sole recurring remote-poll scheduler. In changes-feed mode,
the controller starts one configured Continuous session when supported;
otherwise it may enable the configured generic periodic timer. Continuous has
precedence when both are configured.

The controller starts resume work synchronously far enough to reserve
Continuous ownership, then lets the lifecycle handler settle without awaiting
network completion. Concurrent resume notifications share one internal
operation. Periodic reconciliation therefore observes the reservation before
it can enable a competing timer. A failed operation is logged and releases the
coalescing slot so a later resume can retry.

### Use a fixed current-provider definition

Commonlib defines the canonical current remote kinds, provider contract,
capability catalogue, support-decision type, and typed provider builder. Each
host composition explicitly declares the provider kinds which it includes and
supplies an exhaustive definition table for that set. The current catalogue is
CouchDB, Object Storage, and P2P; it is not a public third-party registration
API.

CouchDB is part of every current host composition. Object Storage and P2P are
compile-time composition choices and may be included or omitted without
changing the generic scheduling feature. Adding another current provider
requires a Commonlib kind and support declaration, host composition,
Setup/profile schema handling, and provider-specific tests. It does not require
a runtime plug-in registry or behaviour for unknown provider kinds.

Each provider definition supplies:

- canonical kind and diagnostic name;
- complete support metadata for the current catalogue;
- active Replicator construction;
- provider configuration identity and an explicit same-kind rebind-or-replace
  policy;
- flow-specific probe and initial-transfer dependency factories; and
- provider-specific entry points required by existing current flows.

The host composes CouchDB and Object Storage definitions directly. A module is
retained only when it owns separate state or behaviour; a factory-registration-
only module instance is not required. The stateful P2P service is composed
independently and may be an adjunct beside a different selected main provider.

The definition table uses `satisfies` against required record keys. Adding a
current provider or catalogue entry without a support decision is a compile-time
error. A typed builder correlates each `supported` decision with its required
role and rejects a role for an absent capability.

Support has three stable states:

```typescript
type CapabilitySupport =
    | { readonly kind: "supported" }
    | { readonly kind: "not-implemented"; readonly reason: CapabilityReason }
    | { readonly kind: "not-applicable"; readonly reason: CapabilityReason };
```

`not-implemented` means that the provider model exists but the current
implementation does not supply it. `not-applicable` means that the model does
not exist for that provider, such as central database locking for P2P. Reasons
are stable codes, not arbitrary user-facing strings.

Historical empty `remoteType` is resolved explicitly as CouchDB at the
persistence/profile boundary. Capability selection then uses that canonical
kind; it never infers CouchDB by truthiness or by a negative test such as
'neither Object Storage nor P2P'.

If a provider caches effective connection settings, its declared rebind or
replacement policy keeps the active adapter current after a same-kind profile
change. Reconciliation is serialised with active work and leaves no old
credentials, Security Seed state, journal checkpoint, adapter cache, or
diagnostic connection reachable from the reconciled handle.

### Separate exhaustive support metadata from narrow runtime roles

Every provider definition contains a required support record over the complete
current catalogue. An active Replicator exposes only the narrow roles marked as
supported by its definition. This gives compile-time completeness without a
giant runtime facade or a collection of Boolean flags.

The generic catalogue covers user-initiated and unattended OneShot Sync,
ordinary long-lived Continuous replication, full upload and download, central
reset and lock administration, preferred-tweak Metadata read and write,
on-demand remote Chunk reads, remote storage status, compromised-Chunk
inspection, central Security Seed, and a request to stop active transfer.

Full upload/download, reset/lock, and Metadata read/write remain separate roles.
Provider initialisation remains flow-specific: CouchDB may create a database,
whereas Object Storage prepares its Security Seed and does not provision a
bucket. Provider-specific CouchDB maintenance, Object Storage journal
checkpoint maintenance, and P2P room operations are narrowed facets, not
generic feature tests. P2P facets are defined in Part 2.

Local node identity initialisation is a database and Replicator lifecycle
concern, not a remote capability. Replication statistics remain a
`ReplicatorService` telemetry sink.

### Make unattended work explicit and truthful

User-initiated and unattended OneShot Sync are separate roles. Interaction
authority is an upper bound on local interaction, not an instruction to display
a dialogue. An operation may apply a stricter veto, but cannot request an
interaction which its caller did not permit. Remote refusal and incoming-peer
consent remain independent decisions.

```typescript
type UnattendedTrigger = "resume" | "periodic" | "database-event" | "editor-save" | "file-open" | "merge" | "daemon";

interface InteractionPermissions {
    readonly peerSelection: boolean;
    readonly localPeerAdmission: boolean;
    readonly configurationExchange: boolean;
    readonly failureRecovery: boolean;
}

type PermittedInteractionPermissions =
    | (InteractionPermissions & { readonly peerSelection: true })
    | (InteractionPermissions & { readonly localPeerAdmission: true })
    | (InteractionPermissions & { readonly configurationExchange: true })
    | (InteractionPermissions & { readonly failureRecovery: true });

type InteractionAuthority =
    | typeof NO_INTERACTION
    | { readonly kind: "permitted"; readonly permissions: PermittedInteractionPermissions };

const NO_INTERACTION = { kind: "forbidden" } as const;

interface UserInitiatedOneShotRequest {
    readonly trigger: "manual";
    readonly interaction: InteractionAuthority;
}

interface UserInitiatedOneShot {
    run(request: UserInitiatedOneShotRequest): Promise<ReplicationOutcome>;
}

interface UnattendedOneShot {
    run(request: {
        readonly trigger: UnattendedTrigger;
        readonly interaction: typeof NO_INTERACTION;
    }): Promise<ReplicationOutcome>;
}
```

`NO_INTERACTION` is the only all-false authority. Shared immutable authority
values are reused by hosts, avoiding a permission allocation per operation.
Operation-specific requests, including P2P configuration exchange, carry the
same upper bound and expose only relevant permissions. An unattended path may
use persisted or automatic acceptance policy, but cannot obtain local
interaction authority implicitly.

Outcomes do not collapse failure into `void` or `boolean`:

```typescript
const REPLICATION_COMPLETED = { status: "completed" } as const;
const REPLICATION_CANCELLED = { status: "cancelled" } as const;

type ReplicationOutcome =
    | typeof REPLICATION_COMPLETED
    | typeof REPLICATION_CANCELLED
    | { readonly status: "blocked"; readonly reason: ReplicationBlockReason }
    | { readonly status: "partial"; readonly detail: PartialReplicationDetail }
    | { readonly status: "failed"; readonly error: unknown };
```

Completed and cancelled values are shared singletons or literals. Blocked,
partial, and failed results may carry diagnostic detail. Central provider
initialisation, reset, lock, unlock, and resolution settle only after their
defined remote write succeeds; a Rebuilder must not continue after an ignored
mutation failure.

`cancelled` means that the requested finite operation did not reach its normal
completion boundary. It does not promise rollback. A provider may retain
documents and checkpoints from batches which had already settled before the
cancellation signal was observed, and a later operation resumes from that
durable state.

### Distinguish observation from an identity result only when required

Capability availability and operation results are separate. A supported
operation may fail, while an inapplicable operation must not be called or
reported as a network attempt.

For an observation where an empty value changes a safety decision, use a tagged
result:

```typescript
type RemoteObservation<T> =
    | { readonly kind: "observed"; readonly value: T }
    | { readonly kind: "unavailable"; readonly error?: unknown };
```

Compromised-Chunk inspection is the current example. `observed: 0` proves that
the supported inspection found no matching entries; `unavailable` says that it
did not complete, including while offline. A caller must handle every result
before declaring the remote clean.

Do not wrap every result. When an empty array is the safe, documented identity
for every current caller, retain it. High-frequency Chunk, document,
changes-feed, and queue paths keep arrays, iterators, and scalars unless a
measurement and a safety distinction justify a tag. No wrapper is added per
Chunk, document, changes-feed row, or queue item.

### Give active ownership and probes explicit boundaries

`ReplicatorService` is the sole owner of the active Replicator. Replacement is
an atomic transition under its transition lock:

```text
active -> retiring -> disposed -> replacement published
```

Acquisitions wait for the transition and receive only the replacement. A fenced
old handle cannot start work. Disposal stops Continuous activity, requests
cancellation of work which supports it, awaits work which cannot be cancelled,
and settles or reports every operation owned by the active adapter before
publication. If bounded retirement cannot settle, replacement fails visibly
and no new handle is published; the old handle is disposed when late work
settles.

The generic stop role is an idempotent request to stop a provider transfer after
transport work begins. It does not promise cancellation of readiness checks,
Security Seed acquisition, or external storage calls which do not consume a
cancellation signal. P2P implements this role through its room-session owner:
the request aborts the current finite-operation scopes without closing the room
or disabling later transfers. Its RPC request, incoming `reqSync`, and
replication batch loop consume the same effective signal. An already-started
atomic database operation may settle before cancellation completes, but no new
batch is started afterwards.

`getNewReplicator()` is not a general temporary-instance API. Setup and settings
flows request narrow probes, such as connection, preferred-tweak, or isolated
P2P signalling validation. A resource-returning factory returns an owned
resource with idempotent asynchronous `dispose()`. Trial settings are passed
to the probe itself and cannot silently read active settings. A probe cannot
replace the active Replicator or the P2P service.

Streaming Fetch receives an owned CouchDB HTTP configuration and
`RemoteSecuritySeed` supplier directly. The supplier is bound to the selected
configuration identity, invalidates cached seed state on reconciliation, and
is disposed by the initial-transfer flow. It does not construct a temporary
full Replicator.

### Keep initialisation workflows explicit

- CouchDB and Object Storage first-device rebuilds reset and lock their central
  remote, then perform the established convergence upload.
- A P2P first-device rebuild prepares the local database without pretending to
  reset, lock, or upload to a central remote.
- CouchDB and Object Storage Fetch use their central full-download flow.
- A P2P additional-device Fetch selects a peer and performs one full download.
- CouchDB Streaming Fetch remains the separate initial-transfer service above.

The Rebuilder requests capabilities and does not cast a generic Replicator to a
concrete class. Its `EVENT_DATABASE_REBUILT` continuation is separately
authorised and does not imply `syncOnStart` or P2P AutoStart.

## Target capability matrix for current providers

`S` means supported, `NI` means not implemented, and `NA` means not applicable.
Configuration and reachability are request preconditions or outcomes, not
support states.

| Generic role                            | CouchDB | Object Storage | P2P |
| --------------------------------------- | ------- | -------------- | --- |
| User-initiated OneShot Sync             | S       | S              | S   |
| Unattended OneShot Sync without UI      | S       | S              | S   |
| Ordinary long-lived Continuous session  | S       | NA             | NA  |
| Full upload to a central remote         | S       | S              | NA  |
| Full download                           | S       | S              | S   |
| Central remote reset                    | S       | S              | NA  |
| Central remote lock and resolution      | S       | S              | NA  |
| Preferred-tweak Metadata read and write | S       | S              | NA  |
| On-demand remote Chunk source           | S       | NA             | NA  |
| Remote storage status                   | S       | S              | NA  |
| Compromised-Chunk inspection            | S       | NA             | NA  |
| Central-remote Security Seed            | S       | S              | NA  |
| Request to stop active transfer         | S       | S              | S   |

P2P unattended OneShot means a role exists which uses configured target names
without opening a dialogue. Peer-room, watch, acceptance, and broadcast roles
are provider-specific facets, not the ordinary Continuous role; their trigger
matrix and de-duplication rules are owned by Part 2.

## Alternatives rejected

### Move the resume handler and retain a `remoteType` switch

This would fix issue 1140 narrowly, but would leave future providers and
triggers subject to the same omission. It would not stop automatic P2P calls
from reaching an interactive method, and capability semantics would remain
implicit.

### Use only optional methods or Boolean support flags

Optional runtime roles are useful, but they do not force a support decision when
a provider or catalogue entry is added. Exhaustive support metadata plus a
typed builder keeps runtime interfaces small while requiring the decision at
compile time.

### Use only a provider-discriminated union

A provider union is appropriate for provider-specific maintenance after
explicit narrowing. It cannot model adjunct P2P beside another selected main
provider and is not a generic feature test.

### Tag every value and hot-path return

Uniform wrappers would add allocation and noise to Chunk, document,
changes-feed, and queue paths without improving semantics where an identity is
safe. Tags remain for low-frequency observations and outcomes which affect
control flow.

### Retain `getNewReplicator()` as the trial and command factory

The handler is order-dependent, can suppress construction errors, and can
replace a feature-owned P2P transport. Flow-specific probes and the stable P2P
service make ownership explicit.

### Treat neutral compatibility results as supported operations

Dummy zero counts, empty Security Seeds, false values, and silent mutations
lose distinctions required for safety and recovery. A neutral value remains
only when every caller proves it to be the operation's identity.

## Consequences

- `syncOnStart` becomes an application policy for every unattended finite
  provider which supports it, rather than a CouchDB module behaviour.
- Adding a current provider or capability requires an explicit compile-time
  support decision.
- Unsupported central operations are no longer represented as successful P2P
  no-ops or transport errors.
- Safe identities remain simple, while safety-sensitive observations are
  explicit.
- Setup and trial configuration cannot replace an active or adjunct transport.
- Central mutations and integrity checks cannot silently turn failure or
  unavailability into success.
- P2P remains first-class without being mislabelled as central Continuous
  replication.

## Non-goals

- Do not introduce third-party remote-provider registration.
- Do not redesign every replication result or user-facing message in one
  change.
- Do not make Streaming Fetch a generic Replicator capability.
- Do not make P2P pretend to own a central remote database.
- Do not infer support from `remoteType`, constructor identity, a falsy result,
  or a neutral value.
- Do not redefine `syncOnStart` as a once-per-process setting.
- Do not change established profile persistence or Setup flag-file restart
  ordering as part of this capability split.

## References

- [Part 2: P2P service and session lifecycle](2026_08_replicator_capabilities_02_p2p_service_lifecycle.md)
- [Part 3: migration plan and verification](2026_08_replicator_capabilities_03_migration_plan.md)
- [Bounded Remote Activity](2026_07_bounded_remote_activity.md)
- [Make Onboarding Profile-Aware](2026_07_multiple_remote_onboarding.md)
- [P2P Room and Transport Lifecycle](2026_07_p2p_transport_lifecycle.md)
- [P2P Transport Compatibility Controls](2026_08_p2p_transport_compatibility.md)
- [CouchDB Remote Connection Ownership](2026_08_couchdb_remote_connection_ownership.md)
- [Package the Common Library Behind Explicit Host Boundaries](2026_07_common_library_package_boundary.md)
- [Self-hosted LiveSync issue 1140](https://github.com/vrtmrz/obsidian-livesync/issues/1140)
