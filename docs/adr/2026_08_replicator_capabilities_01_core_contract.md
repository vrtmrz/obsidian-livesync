---
date: 2026-08-27
commonlib-version: "0.1.20"
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

- CouchDB supports unattended OneShot Sync, Continuous replication,
  central-remote administration, and CouchDB-specific inspection and
  maintenance.
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
replication scheduling boundary. The serviceFeature creates one private
scheduling context and passes it to module-level transition functions. The
context contains only scheduling state and narrow collaborators; the functions
implement external-poller ownership, Continuous ownership of recurring work,
the daemon's satisfied initial OneShot marker, resume coalescing, and
periodic-timer reconciliation. They do not register handlers or acquire
`LiveSyncBaseCore`.

The context receives narrow collaborators for readiness and suspension queries,
current settings, `ReplicationService`, periodic-timer control, and diagnostic
logging. The surrounding serviceFeature owns the context lifetime, lifecycle
registration, and adaptation from those Services. It returns a focused control
view containing only the daemon operations to select external polling and mark
the initial OneShot as satisfied. Core construction passes a frozen bundle of
built-in feature views to host composition, without retaining those views as
public `LiveSyncBaseCore` properties. The CLI injects the scheduling view into
its command context; other hosts may ignore it. No host may expose the context's
mutable state or recover it from a core-keyed global or `WeakMap`.

This boundary is not a ServiceModule merely because it owns state. It neither
owns a shared external resource nor supplies a general operational capability
to several unrelated consumers. If a future consumer needs a stable shared
scheduling capability beyond the focused CLI view, that ownership decision
must be reviewed explicitly rather than widening the returned view implicitly.

The scheduling functions use persisted settings, `ReplicationService`, and
the active support declaration. They do not branch on `remoteType` or use
`instanceof` as a capability test. Commonlib owns the trigger-aware replication
contract; the host owns application lifecycle wiring.

The existing `onResumed` event remains the eligible-resume boundary after
initial readiness, settings application, and visibility recovery. It is not
redefined as a once-per-process event. The context-backed functions coalesce
duplicate work within one lifecycle generation and preserve readiness and
suspension gates:

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
interaction authority. The scheduling functions never call a concrete
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
the scheduling functions start one configured Continuous session when
supported; otherwise they may enable the configured generic periodic timer.
Continuous has precedence when both are configured.

The resume function starts work synchronously far enough to reserve
Continuous ownership, then lets the lifecycle handler settle without awaiting
network completion. Concurrent resume notifications share one internal
operation. Periodic reconciliation therefore observes the reservation before
it can enable a competing timer. A failed operation is logged and releases the
coalescing slot so a later resume can retry.

Coalescing applies only within one observed lifecycle generation. If the
application suspends and resumes while an earlier operation is still settling,
the context retains the newer generation and runs it after the earlier
operation releases the slot. A result from the obsolete generation cannot
change recurring-work ownership or initiate a OneShot fallback for the newer
generation.

Disabling an interval does not retract a callback which the runtime has already
queued. Each Periodic callback therefore rechecks lifecycle eligibility,
readiness, suspension, configuration, external-poller ownership, and
Continuous ownership immediately before it requests replication.

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
- active Replicator construction;
- a configuration predicate and private configuration identity;
- explicit user-initiated and unattended OneShot runners;
- readiness requirements, an explicit Continuous support decision, and a
  transfer-stop runner;
- the exhaustive current remote-resource catalogue; and
- an optional cohesive central-remote administration runner.

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

The private configuration identity covers every effective setting which binds
the active adapter. The active publication is retained only while both the
provider and identity are unchanged. Every changed identity follows the same
serialised replacement transition; there is no same-instance rebind branch.

### Keep the active contract small and compose the differing roles

The active object implements only the lifecycle and transport primitives which
are real for CouchDB, Object Storage Journal, and P2P:

```typescript
interface ReplicatorInstance {
    initializeDatabaseForReplication(): Promise<boolean>;
    openReplication(
        setting: RemoteDBSettings,
        keepAlive: boolean,
        showResult: boolean,
        ignoreCleanLock: boolean
    ): Promise<void | boolean>;
    terminateSync(): void | Promise<void>;
    closeReplication(): void | Promise<void>;
}
```

Provider runners compose the differences in interaction authority, readiness,
typed settlement, explicit Continuous support or inapplicability, and P2P room
demand. Short-lived connection, preferred-tweak, Security Seed, and
synchronisation-information operations remain caller-owned resources. Central
administration remains one optional cohesive runner. None of those differences
widens `ReplicatorInstance`.

The LiveSync central-remote administration composition shares only local-identity
preparation, mutation ordering, milestone interpretation, and result
settlement. Its CouchDB and Object Storage adapters retain their own milestone
readers and connection or client ownership. The fixed provider definition has
already selected the adapter, so those readers validate only the additional
operations which they use; they do not rediscover capability support through a
concrete-class `instanceof` test.

The central OneShot adapters likewise require only the local structural
`openOneShotReplicationWithOutcome()` operation. Concrete constructors remain
at the host-composition boundary, but constructor identity is not a capability
test. A structurally incomplete active instance settles as a failed outcome
rather than falling back to the legacy `openReplication()` operation.

Directional Fetch and Rebuild, Streaming Fetch, CouchDB on-demand Chunk reads,
remote-size inspection, compromised-Chunk inspection, Garbage Collection,
compaction, and journal checkpoint maintenance are workflow or
provider-specific concerns. They do not become exhaustive provider
capabilities merely because an application flow branches by topology.

Local node identity initialisation remains at the established Replicator and
local-database initialisation boundary for this change. A later physical
database-lifetime review may move it only after establishing a concrete owner
and migration benefit. Replication statistics remain a `ReplicatorService`
telemetry sink.

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

The same authority bounds presentation. An unattended P2P path may retain an
informational diagnostic, but no-target, authentication, tweak-mismatch, and
overlapping-transfer settlements must not promote themselves to a Notice.
User-initiated paths retain their existing Notice-level presentation. This is
a caller-authority rule, not a new process-wide presentation framework.

Outcomes do not collapse failure into `void` or `boolean`:

```typescript
const REPLICATION_COMPLETED = { status: "completed" } as const;
const REPLICATION_CANCELLED = { status: "cancelled" } as const;

type ReplicationOutcome =
    | typeof REPLICATION_COMPLETED
    | typeof REPLICATION_CANCELLED
    | { readonly status: "blocked"; readonly reason: ReplicationBlockReason }
    | { readonly status: "partial"; readonly detail: PartialReplicationDetail }
    | {
          readonly status: "failed";
          readonly error: unknown;
          readonly recoveryHint?: CentralCompatibilityRecoveryHint;
      };
```

Completed and cancelled values are shared singletons or literals. Blocked,
partial, and failed results may carry diagnostic detail. Central provider
initialisation, reset, lock, unlock, and resolution settle only after their
defined remote write succeeds; a Rebuilder must not continue after an ignored
mutation failure.

CouchDB and Object Storage Journal record one immutable central-compatibility
decision inside the finite attempt which owns the connection or borrowed
client. Only a rejection from that exact attempt becomes a recovery hint. A
transport failure before assessment, or after an accepted assessment, cannot
reuse mutable mismatch or lock state from an earlier attempt. P2P produces no
central-compatibility decision. The recovery field is already specific to this
contract, so its value carries the stable rejection reason and any preferred
tweak value without a redundant kind discriminator.

`cancelled` means that the requested finite operation did not reach its normal
completion boundary. It does not promise rollback. A provider may retain
documents and checkpoints from batches which had already settled before the
cancellation signal was observed, and a later operation resumes from that
durable state.

### Preserve uncertainty at the boundary which owns the decision

Capability availability and operation results are separate. A supported
operation may fail, while an inapplicable operation must not be called or
reported as a network attempt. A workflow which legitimately has no step for
its topology may complete that branch without claiming that a provider ran an
operation.

Keep uncertainty where it changes a safety decision. In particular, an Object
Storage read distinguishes `available`, `not-found`, and `unavailable` before a
caller decides whether creation is permitted. Only explicit `not-found` may
create Journal synchronisation parameters; an unavailable read cannot be
converted to a missing value or a new Security Seed.

The same rule applies to central milestone mutation and verification. A
milestone mutation may merge an available document or initialise one after an
explicit `not-found` result. An unavailable read rejects before upload. A
postcondition reader reports that unavailability as a read failure with its
diagnostic detail; it does not report that the milestone is missing.

This principle does not require one generic `RemoteObservation<T>` type or an
active-read catalogue. Existing provider-specific inspection and maintenance
methods may retain their current compatibility surface until their real
consumers are migrated. When a later bounded migration needs to distinguish an
observed zero or empty result from an unavailable inspection, that consumer
owns the smallest explicit result type required by the decision.

### Give active ownership and probes explicit boundaries

`ReplicatorService` is the sole owner of the active Replicator. Replacement and
disposal use one explicit quiescing transition under its transition lock:

```text
active -> quiescing -> closed -> replacement published
```

The transition removes the old publication from `current`, rejects later
admission, requests the provider's supported transfer cancellation, and drains
work which was already admitted. Only then does it close the old Replicator and
publish another active context. Acquisitions ordered after the
transition receive only the replacement. A cancellation failure does not
permit the physical close boundary to be skipped. If admitted work cannot
settle, no replacement is published. If physical close fails, the quiescing
publication remains fenced so a later transition can retry that close before
constructing a replacement.

The publication object itself is the private generation identity; no separate
generation number or public lease is required. Its reservation count is not the
service-wide bounded-activity count or finite-replication count: those counts
remain status and quiescence signals and can include trials, local work, and an
outer Rebuilder flow which itself initiates a lifecycle transition. A switch
which waited for either global count could therefore wait for the operation
which is awaiting that same switch.

The active context atomically carries the provider, Replicator, and private
configuration identity. A settings-bearing operation captures one effective
settings snapshot, then reprojects and compares its identity inside admission
immediately before provider dispatch. A mismatch settles without combining a
new setting with an earlier Replicator. An explicit stop request acts on the
exact active owner and therefore does not require a settings comparison.

New typed production work cannot synchronously inspect an unreserved active
context. It must acquire the context or run inside the admitted callback
boundary. The synchronous `inspectActiveReplicatorContext()` view is protected
and exists only for lifecycle diagnostics and focused tests.

The public `getActiveReplicator()` remains temporarily for named compatibility
consumers and retains its established missing-active diagnostic. It is not a
typed ownership path. A separate side-effect-free `hasActiveReplicator()`
predicate may distinguish a compatibility Replicator whose provider was not
composed from complete absence. It returns neither the Replicator nor its
context, and cannot be used to dispatch work.

The minimum consumer surface is a callback boundary,
`runWithActiveReplicatorContext(callback)`, rather than an exposed lease or
release token. Admission is ordered with lifecycle transitions, the callback
receives one exact context, and private release runs in `finally` without
entering the transition queue.

The callback must not initiate or await settings realisation, database reset or
replacement, active Replicator retirement, or another operation which queues
the same lifecycle transition. Such recovery or reconfiguration is staged
after the reserved dispatch settles. A process-wide re-entrancy flag would
both reject unrelated asynchronous work and miss re-entry after an `await`, so
the contract is documented and tested at the owning workflows rather than
claimed as a reliable runtime detector.

Failure presentation and recovery start only after the finite reservation has
settled. A later remote mutation re-enters through the callback boundary and
requires reference equality with the failed context. It cannot apply the
decision produced by one publication to its replacement.

An edited-settings trial is different: it owns an independent Replicator and
connection, never borrows the active publication, and disposes both resources.
An owned Security Seed resource also forces a fresh provider read for its
settings snapshot. Reusing a process-cached synchronisation parameter would
turn an observation made for an earlier flow into current trial evidence.

Application suspension is a reversible host pause, not an ownership
transition. `ReplicatorService` orders the provider's transfer-stop request but
retains the active publication, accepts later work, and does not drain or close
the Replicator. Provider-specific transport lifecycle, including P2P room and
relay handling, remains independently owned.

Plug-in unload is terminal and reuses the same quiescing retirement as disposal;
it does not add another public state or unload capability. The lifecycle handler
fences admission, requests transfer cancellation, drains admitted work, and
closes the Replicator before `ControlService` closes the local database. This
ordering matters even when disabling the plug-in leaves the JavaScript process
alive.

The generic stop role is an idempotent request to stop a provider transfer after
transport work begins. It does not promise cancellation of readiness checks,
Security Seed acquisition, or external storage calls which do not consume a
cancellation signal. P2P implements this role through its room-session owner:
the request aborts the current finite-operation scopes without closing the room
or disabling later transfers. Its RPC request, incoming `reqSync`, and
replication batch loop consume the same effective signal. An already-started
atomic database operation may settle before cancellation completes, but no new
batch is started afterwards.

A Journal connectivity preflight is not itself cancelled by this role. The
Replicator instead records a private Stop generation when that preflight begins
and checks it again before entering `sync()`, `sendLocalJournal()`, or
`receiveRemoteJournal()`. A Stop admitted while the preflight is pending can
therefore wait for the attempt to settle without allowing a new client transfer
to start afterwards.

The bounded Continuous startup call and an explicit stop request are admitted
against their exact publication. Continuous admission ends when the provider
has registered ownership and settled startup; it is never retained for the
lifetime of the long-lived task. Directional transfer and central-remote
administration stop the admitted publication's active transfer before their
exclusive operation begins. An unavailable or failed stop prevents that
operation rather than allowing transfer and mutation to overlap.

`getNewReplicator()` is not a general temporary-instance API. CouchDB and
Object Storage Setup and settings flows request narrow connection or
preferred-tweak probes. A resource-returning factory returns an owned resource
with idempotent asynchronous `dispose()`. Trial settings are passed to the
probe itself and cannot silently read active settings. P2P Setup instead uses
the stable service's connection-probe admission described in Part 2. Only its
idle continuation constructs and disposes a short-lived raw signalling trial.
Neither form can replace the active Replicator or the P2P service.

The CouchDB synchronisation-information resource resolves `false` only when it
observes incompatible synchronisation information. Connection, setup, and
verification failures reject so a settings caller can report operational
failure separately from incompatibility. Connection-probe result presentation
is likewise explicit: `showResult` retains the established CouchDB success or
failure Notice, while an ordinary silent probe emits neither result Notice.

Streaming Fetch receives an owned Security Seed resource bound to its settings
snapshot. The current compatibility implementation may construct an
unpublished Replicator internally, but the resource owns and disposes it and
cannot replace the active publication.

### Keep initialisation workflows explicit

- Fetch, Rebuild, overwrite, and first-device setup remain application
  workflows. Their direction, reset, lock, peer selection, local-database work,
  and convergence passes are not one Replicator capability.
- CouchDB and Object Storage use their established workflow-local directional
  adapters and central administration where required.
- A P2P first device prepares only its local state. An additional P2P device
  selects a peer and uses the real finite download path; P2P does not emulate a
  central reset, lock, milestone, or upload.
- CouchDB Streaming Fetch remains a separate initial-transfer service and uses
  only its owned Security Seed dependency.

The `EVENT_DATABASE_REBUILT` continuation remains separately authorised and
does not imply `syncOnStart` or P2P AutoStart. Complete Rebuilder and
maintenance-facade migration is a later bounded change rather than a condition
for the active Replicator core.

## Target capability matrix for current providers

`S` means supported, `NI` means not implemented, and `NA` means not applicable.
Configuration and reachability are request preconditions or outcomes, not
support states.

| Active provider role                   | CouchDB | Object Storage | P2P |
| -------------------------------------- | ------- | -------------- | --- |
| User-initiated OneShot Sync            | S       | S              | S   |
| Unattended OneShot Sync without UI     | S       | S              | S   |
| Ordinary long-lived Continuous session | S       | NA             | NA  |
| Request to stop active transfer        | S       | S              | S   |

Every provider definition records the Continuous row explicitly. CouchDB
supplies its runner, while Object Storage and P2P declare the role not
applicable; omission is not a fourth support state.

The current definition also declares the finite resources and the one optional
central facility which have real consumers:

| Provider-owned facility                       | CouchDB | Object Storage | P2P    |
| --------------------------------------------- | ------- | -------------- | ------ |
| Connection probe                              | S       | S              | NA     |
| Preferred-tweak probe                         | S       | S              | NA     |
| Security Seed resource                        | S       | S              | NA     |
| Synchronisation-information resource          | S       | NA             | NA     |
| Cohesive central-remote administration runner | S       | S              | absent |

`remoteResources` is exhaustive over its four stable machine keys, so adding a
resource requires an explicit decision from every composed provider. The
central-remote administration field is optional because there is no corresponding
P2P facility. Actions within that runner are the current central protocol, not
an exhaustive capability table imposed on every Replicator.

The public contract is named `CentralRemoteAdministration*` because every
current action, observation, failure, and postcondition belongs to that central
milestone protocol. Established CLI command names remain unchanged.

The P2P Setup signalling check is not the P2P entry in the provider-owned
connection-probe row. P2P has no central connection resource; its
`P2PConnectionProbeAdmission` is a focused view of the independently composed
P2P service. It compares requested relays with the binding held by the existing
room-session owner as specified in Part 2; it adds neither a process-global
lease nor a second owner.

The following concerns deliberately stay outside this capability matrix:

| Concern                                                          | Current owner                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Directional Fetch and Rebuild                                    | Application workflow over provider-specific adapters                   |
| Streaming Fetch                                                  | CouchDB initial-transfer workflow plus an owned Security Seed resource |
| On-demand remote Chunks and compromised-Chunk inspection         | CouchDB compatibility or maintenance consumers                         |
| Remote size, Garbage Collection, compaction, and device registry | Provider-specific inspection and maintenance flows                     |
| P2P room, relay, peer selection, admission, watch, and broadcast | Stable P2P service and room-session owner in Part 2                    |

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

Dummy zero counts, empty Security Seeds, false values which collapse an
operational failure into incompatibility or absence, and silent mutations lose
distinctions required for safety and recovery. A neutral value remains only
when every caller proves it to be the operation's identity.

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
- [Self-hosted LiveSync issue 1147](https://github.com/vrtmrz/obsidian-livesync/issues/1147)
