---
date: 2026-09-03
commonlib-version: "0.1.21"
self-hosted-livesync-version: "1.0.24"
commonlib-source-commit: e770f617ff0fc88f4823226b0ab3aefdff50cc1e
status: accepted
---

# Replicator architecture

This is the implemented architecture for Self-hosted LiveSync 1.0.24 with `@vrtmrz/livesync-commonlib` 0.1.21. It is an implementation overview for developers maintaining the composition or adding a built-in provider. The corresponding Commonlib source was inspected at commit `e770f617ff0fc88f4823226b0ab3aefdff50cc1e`.

## Status, scope, and source-of-truth boundary

The plug-in repository is the source of truth for host composition, host scheduling, Obsidian/CLI/WebApp/WebPeer integration, provider declarations, and host-owned resource adapters. Commonlib is the source of truth for the provider contract, the active-publication state machine, typed replication runners, P2P service ownership, and Journal transport primitives. This repository consumes Commonlib as the published `0.1.21` package; it does not maintain a source mirror or a generated fallback.

The implementation has three built-in providers:

- CouchDB, composed by this repository;
- Object Storage, composed by this repository; and
- P2P, composed by Commonlib's `useP2PReplicatorFeature` in each application runtime which supports it.

The catalogue is closed at host composition. `src/common/replicatorProviders.ts` exhaustively composes the central providers, while the Commonlib P2P feature composes its P2P provider. This is not a runtime third-party registry: a provider cannot be added by registering a name, loading a plug-in, or supplying a setting at runtime. Adding a provider means changing the relevant Commonlib and host composition, then shipping and testing that composition.

The three capability ADRs record the decisions which led to this shape. They are useful decision history, but this document describes the current implementation and its ownership boundaries rather than repeating the ADR sequence.

## Terminology

The [Project glossary](../glossary.md#developer-and-design-terms) is canonical
for project-specific vocabulary in this document. In particular, see
[Replicator](../glossary.md#replicator),
[Replicator provider definition](../glossary.md#replicator-provider-definition),
[Active publication](../glossary.md#active-publication),
[Admission and reservation](../glossary.md#admission-and-reservation),
[Configuration identity](../glossary.md#configuration-identity),
[Capability](../glossary.md#capability),
[Central remote](../glossary.md#central-remote),
[Publication retirement](../glossary.md#publication-retirement), and
[Fence, generation, and epoch](../glossary.md#fence-generation-and-epoch).
The glossary also fixes the ownership meanings of
[Adjunct P2P transport](../glossary.md#adjunct-p2p-transport),
[Remote resource and probe](../glossary.md#remote-resource-and-probe),
[Non-owning adapter](../glossary.md#non-owning-adapter),
[P2P service, room session, and demand](../glossary.md#p2p-service-room-session-and-demand),
[Interaction authority](../glossary.md#interaction-authority),
[Journal remote epoch](../glossary.md#journal-remote-epoch),
[Replication outcome](../glossary.md#replication-outcome), and
[Suspension](../glossary.md#suspension).
The user-facing glossary also distinguishes
[OneShot Sync from Continuous replication](../glossary.md#user-facing-and-operational-terms).
Names shown in code font are source identifiers, not additional prose terms.

## Ownership and topology

The portable topology below names ownership rather than merely call order. An arrow means that the object or layer composes, invokes, or owns the next item.

```text
Application composition
  Obsidian main / CLI / WebApp --> LiveSyncBaseCore --+
  WebPeerRuntime ------------------------------------+--> Service Hub
                                                          |
                 +----------------------------------------+---------------------+
                 |                                                              |
                 v                                                              v
       ReplicatorService (Commonlib)                              ReplicationService (Commonlib)
                 |                                                              |
                 +--> closed provider catalogue                                 +--> typed replication runners
                 |      CouchDB / Object Storage / P2P                           |      readiness + outcomes
                 |                                                              |
                 +--> active publication <------ exact-publication admission ---+
                        provider + instance + identity

  useP2PReplicatorFeature (Commonlib)
        |
        +--> registers the P2P provider, whose factory creates non-owning active adapters
        |
        +--> stable P2P service views and lifecycle
               |
               +--> P2PRoomSessionOwner
                      |
                      +--> P2PAutomationCoordinator
                      +--> current P2PRoomSession
                             |
                             +--> P2PHost / TrysteroReplicator
                                    |
                                    +--> Trystero room, relays, and physical peers
```

`LiveSyncBaseCore` receives a Service Hub, registers the central provider definitions, composes `serviceFeature` functions, and retains only focused views. `WebPeerRuntime` composes directly over its browser Service Hub because it is a P2P-only host. The P2P feature is composed by each supporting application runtime, so the CLI and web applications can use the same transport ownership without making the active adapter a second owner.

| Owner | Responsibility | Explicitly does not own |
| --- | --- | --- |
| Host composition | Selects the closed provider catalogue, supplies host adapters, and registers features before lifecycle work begins. | Active-instance retirement or operation admission. |
| Commonlib `ReplicatorService` | Provider registration, active publication, exact-publication reservations, serial lifecycle transitions, transfer stop during suspension or retirement, and physical close. | Replication readiness, trigger policy, or P2P room ownership. |
| Commonlib `ReplicationService` and its typed coordinator | User and unattended OneShot dispatch, Continuous startup, readiness, interaction authority, finite-activity accounting, outcomes, and failure hand-off. | Active publication replacement or scheduling policy. |
| Host replication scheduling `serviceFeature` | Decides when resume, Periodic, and Continuous requests may run, and fences stale scheduled work. | Provider construction, transfer mechanics, or active Replicator close. |
| Provider definition and runner | Declares what one remote kind supports and adapts its transfer results to typed outcomes. | Selecting when a request should run. |
| Stable P2P service and room-session owner | P2P demand, binding reconciliation, session retirement, finite room operations, automation state, and focused views. | The active P2P adapter's publication lifetime or Trystero's physical peers. |

## Request flow

1. Composition registers the central provider definitions before lifecycle-driven provider initialisation. P2P composition registers its own Commonlib provider and returns stable P2P views and lifecycle controls.
2. `ReplicatorService` serialises setting realisation, active-provider initialisation, database lifecycle transitions, suspension, and unload. `ReplicationService` owns per-request readiness. Resume work is separately owned by the host scheduling feature and the P2P service lifecycle.
3. `ReplicatorService` resolves the current `remoteType`, checks `isConfigured`, and computes the provider's opaque configuration identity. If the provider and identity are unchanged, the active publication is retained. If either changes, the replacement fence runs before a new publication is created.
4. A typed operation such as `runUserInitiated`, `runUnattended`, or `startContinuous` acquires the current publication after earlier queued lifecycle transitions have settled. It checks interaction authority, capability support, and readiness in the order required by the request type, then takes an immutable settings snapshot.
5. The operation admits a reservation against the exact publication and identity. The provider-specific runner owns the transfer; finite operations are counted as bounded remote activity, while continuous replication is not.
6. Provider resources are created through the declared resource factories when a feature needs a connection, preferred-tweak, Security Seed, or synchronisation-information probe. Resource ownership is explicit, and owned resources are disposed in the caller's `finally` path.
7. The runner returns a `ReplicationOutcome` rather than using `undefined` as a success signal. Documents delivered through `parseSynchroniseResult` are queued by the host result processor for local application; central compatibility recovery and Security Seed preflight remain host features around the typed operation.
8. Automatic `database-event`, `editor-save`, `file-open`, `merge`, `resume`, `periodic`, and `daemon` requests select unattended authority explicitly. Unattended work cannot prompt, select a peer interactively, or silently fall back to a legacy capability.

The active publication may change while a request is being prepared. The reservation keeps the admitted old instance alive until the operation settles; a new request admitted after the queued transition observes the new publication. A callback which holds a reservation must not await a lifecycle transition which itself waits for that reservation.

## Provider contract and current capability matrix

The Commonlib contract is deliberately small. A provider definition supplies the following shape (with the exact generic types omitted here for readability):

```typescript
{
    kind,
    diagnosticName,
    readiness,
    isConfigured(setting),
    configurationIdentity(setting),
    create(setting),
    remoteResources,
    centralRemoteAdministration?,
    userInitiatedOneShot,
    unattendedOneShot,
    continuous,
    stopActiveTransfer
}
```

`defineReplicatorProviderDefinitions` makes the definition map exhaustive for the selected `RemoteType` tuple and rejects duplicate, missing, extra, or mismatched runtime definitions. Capability declarations are explicit. `supported` adapts a provider runner to `ReplicationOutcome`; `not-implemented` and `not-applicable` produce typed blocked outcomes. The contract distinguishes user authority from `NO_INTERACTION`, so a provider cannot accidentally prompt from an unattended trigger.

The factory receives the fully merged effective settings. It returns a `ReplicatorInstance` with only four required lifecycle methods:

| Method | Contract |
| --- | --- |
| `initializeDatabaseForReplication()` | Prepare local state before publication. `false` rejects and disposes the candidate. |
| `openReplication(setting, keepAlive, showResult, ignoreCleanLock)` | Retained compatibility entry point for finite or Continuous work. A typed provider runner must convert its `void` or Boolean settlement to an explicit outcome; `void` is not finite success. |
| `terminateSync()` | Request cancellation of active transfer work and settle synchronously or asynchronously. It does not transfer ownership or replace physical close. |
| `closeReplication()` | Release resources owned by this instance. It runs only after admitted work drains; a non-owning adapter, such as P2P, must leave service-owned resources alone. |

Provider-specific methods remain on provider-specific interfaces or host-owned adapters. They are not added to the generic contract merely because an old compatibility class exposed them.

### Current capability matrix

| Capability | CouchDB | Object Storage | P2P |
| --- | --- | --- | --- |
| Readiness | Central remote preparation required | Central remote preparation required | Central preparation not applicable; peer readiness is provider-owned |
| Active Replicator factory | `LiveSyncCouchDBReplicator` | `LiveSyncJournalReplicator` | `P2PActiveReplicatorAdapter` over the stable P2P service |
| User-initiated OneShot | Supported | Supported | Supported, with explicit peer selection |
| Unattended OneShot | Supported | Supported | Supported for configured targets; no peer-selection prompt |
| Continuous replication | Supported | Not applicable | Not applicable |
| Stop active transfer | Supported | Supported | Supported; cancels finite operations while retaining the room when appropriate |
| Connection resource | Supported | Supported | Not applicable |
| Preferred-tweak resource | Supported | Supported | Not applicable |
| Security Seed resource | Supported | Supported | Not applicable |
| Synchronisation-information resource | Supported | Not applicable | Not applicable |
| Central remote administration | CouchDB administration supported | Object Storage administration supported | Not applicable |

The matrix is the current host composition, not a promise that every provider must support every row. A new provider must declare every resource kind and every operation capability, using `not-applicable` where the concept does not exist. Central remote administration is a cohesive capability: it covers the applicable verification milestone and mark-resolved, lock, and unlock mutations rather than exposing individual legacy helpers as generic operations.

## Active Replicator lifecycle and exact replacement fence

Commonlib's `ReplicatorService` serialises lifecycle transitions on one queue. It owns the active publication, reservations against that publication, transfer stop, and final close. The effective configuration identity is deliberately opaque; comparing it is valid, but inspecting or persisting it is not.

```text
absent
  |
  | configured lifecycle initialisation
  v
candidate (private and not admitted)
  |                         \
  | initialised and current  \ failed or stale --> closed; no active publication
  v
active publication
  |  \ same provider and identity --> retained
  |  \ suspension ----------------> transfer stopped; publication retained
  |
  | provider, identity, database, or terminal lifecycle change
  v
quiescing (removed from current; new admission fenced)
  |
  | stop --> drain exact reservations --> close --> complete retirement
  v
absent --> optional replacement candidate
```

For a provider or effective-configuration change, the exact fence is:

1. Enqueue the transition on the serial lifecycle queue.
2. Read the current setting, resolve the closed provider definition, check `isConfigured`, and compute the effective identity.
3. If the current publication has a different provider or identity, call `beginRetirement`. This stops new reservations and removes the publication from the current slot.
4. Request the provider's `stopActiveTransfer` capability. The legacy `terminateSync` path is retained only for an untyped compatibility publication.
5. Await settlement of reservations admitted from the retiring publication. New operations cannot enter it.
6. Call the old instance's `closeReplication`.
7. Mark the retirement complete. No publication is installed between removal of the old publication and this completion.
8. Create a candidate through the provider definition, reset provider statistics, and yield the required microtask boundary.
9. Initialise the candidate for the current database and run `onBeforeReplicatorPublication` handlers.
10. Re-read the current setting, provider, and opaque identity. If any is stale, dispose the candidate and publish nothing; the queued lifecycle work will resolve the newer state.
11. Publish the provider, candidate instance, and identity atomically as the new active publication.

The same provider and identity retain the current publication. Database initialisation is a lifecycle boundary even when the setting identity is unchanged: the old publication is retired before the physical local database is replaced, then a candidate is created for the new database. A failed or stale candidate leaves the service without an active publication; it is not silently substituted with a previous instance.

If transfer stop fails, retirement still proceeds to draining and physical close. If physical close rejects, retirement remains fenced and no replacement can be published; a later serial transition may retry the same retirement. The service never restores admission to a publication once retirement has begun.

## Generation and epoch fences

These values protect different state machines. They must not be collapsed into one general-purpose generation.

| Fence | Owner and representation | Changes when | Protects | Does not protect |
| --- | --- | --- | --- | --- |
| Active publication identity | Commonlib `ActiveReplicatorPublication` object, containing provider, instance, and opaque configuration identity; not a numeric counter | Provider/configuration replacement, or a database lifecycle replacement | Admission and completion against the exact active instance | Delayed scheduling, P2P automation baselines, or Journal remote-wipe decisions |
| Host scheduling lifecycle generation | `ReplicationSchedulingContext.lifecycleGeneration` | Scheduling resumes after the lifecycle was disabled | Resume operations and timer callbacks from a previous host scheduling lifecycle | Provider replacement, P2P room callbacks, or Journal transfers |
| P2P service lifecycle generation | Private `P2PServiceState.lifecycleGeneration` | Explicit disconnect or host lifecycle closure | Delayed P2P AutoStart and service-level automatic demand | A room's operation set, automation baseline, or remote Journal epoch |
| P2P session object / epoch fence | The current `P2PRoomSession` object, its `acceptingOperations` flag, session abort signal, and the owner's lifecycle queue; there is no exported numeric P2P session epoch | Room binding replacement, retirement, or owner close | Room callbacks, finite operations, peer handlers, and stale candidate sessions | Cross-session automation deduplication and host scheduling |
| P2P automation generation | `P2PAutomationCoordinator.generation` | `beginLifecycle` or effective identity reconciliation (namespace or database object) | Completed peer baseline publication and stale automation completions | Room ownership, explicit disconnect veto, and physical peer connection ownership |
| Journal stop generation | `LiveSyncJournalReplicator.journalTransferStopGeneration` | `terminateSync` requests a stop | Admitted Journal transfers after setup and before `client.sync`; repeated stops share settlement | Provider publication identity and remote checkpoint/cache identity |
| Journal remote epoch | `CheckPointInfo.journalEpoch`, derived as `protocolVersion:pbkdf2salt` | Successfully read sync parameters yield a different value; a subsequent history probe decides whether checkpoint caches must be reset | Journal checkpoint and deduplication-cache reconciliation across remote histories | Local cancellation, provider retirement, or transfer admission |

In particular, a numeric value in one row cannot be used as evidence that an operation in another row is current. Failure to read Journal sync parameters does not produce a new remote epoch, and a P2P transport replacement does not by itself clear the automation coordinator's completed-peer baseline.

## Suspension, terminal retirement, and database replacement

| Event | `ReplicatorService` publication | P2P service and adapter | Result |
| --- | --- | --- | --- |
| Application suspension | Requests `stopActiveTransfer` and retains the active publication | `closeForLifecycle` closes the current room/session and invalidates delayed automation; the active adapter is non-owning and does not close the service through `closeReplication` | Suspension is reversible. Resumption schedules the appropriate P2P AutoStart and host replication work. |
| Provider setting or effective identity change | Runs the complete replacement fence | Reconciles or replaces the P2P room when its effective binding changes | The old publication/session cannot receive new work. |
| Database replacement or rebuild | Retires and closes the active publication before physical database teardown; database-ready events permit reinitialisation | Closes the P2P room before database destruction and creates a binding for the new database object | No provider or room may retain the old database. |
| Unload or terminal lifecycle close | Stops, drains, closes, and completes retirement; no active publication remains | `closeForLifecycle` clears owner demand, closes the current room, and invalidates automation | Terminal retirement is not resumed. |

Suspension and retirement therefore have different guarantees. `ReplicatorService` suspension stops transfer but intentionally retains the provider instance and publication. Terminal retirement removes admission, drains it, closes it, and does not publish a replacement unless a later lifecycle event explicitly initialises one. P2P transport is additionally closed on suspension because its service lifecycle owns a room session, but the active P2P adapter is only a compatibility handle and does not own that session.

## Owned resources and probes

| Resource or probe | Owner | Lifetime and disposal rule |
| --- | --- | --- |
| Active Replicator publication | Commonlib `ReplicatorService` | Publication retirement fences admission, drains reservations, calls `closeReplication`, and completes the retirement. |
| Central connection probe | Host resource factory in `src/common/replicatorResources/connection.ts` | A caller-owned CouchDB or Object Storage snapshot backed by a concrete Replicator/connection; dispose it in `finally`. It does not replace the active publication. |
| Preferred-tweak probe | Host `preferredTweak` resource factory | Read through the declared resource, then dispose the owned resource. |
| Security Seed probe | Host `securitySeed` resource factory and the replication preflight | Use `createRemoteResource` and `withOwnedRemoteResource`; reject an empty seed and always dispose the resource. It does not assume that an active Replicator exists. |
| Synchronisation-information probe | Host `synchronisationInformation` resource factory | Check or read through the resource and dispose it; an unavailable remote is not treated as a confirmed absence. |
| Central administration operation | Provider administration runner | Uses its declared verification and mutation ownership. A fresh connection may be owned by the operation; an active Journal client borrowed from the active provider is not disposed by the borrower. |
| Journal client and transfer set | `LiveSyncJournalReplicator` | The Journal Replicator owns the client and active transfer promises. `terminateSync` requests stop and awaits the shared settlement; `closeReplication` disposes the client without lazily creating one. |
| P2P room/session, finite operation set, and relay actions | `P2PRoomSessionOwner` and current `P2PRoomSession` | The owner serialises binding and demand changes. Session retirement rejects admission, aborts and awaits operations, disables broadcast, and disposes the session Replicator. |
| Physical Trystero peer connections | Trystero runtime | Commonlib must not close raw `room.getPeers()` connections merely because a logical room session retires; shared Trystero ownership may outlive an idle room callback. |
| Physical local database | Commonlib DatabaseService | Database lifecycle owns teardown and readiness. Replicator and P2P owners close before the database is destroyed. |

Probe callers must use the resource capability rather than reaching through `LiveSyncBaseCore.replicator`. This keeps a short-lived observation from acquiring ownership of the active transfer or publication.

## P2P special ownership and the non-owning adapter

P2P is composed as a `serviceFeature` and has more state than a central provider. It can remain enabled as an adjunct while CouchDB or Object Storage is the selected main remote; `ReplicatorService` publishes the P2P active adapter only when `remoteType` is P2P. The active-publication owner and the room-session owner are therefore deliberately independent.

The stable service owns persistent demand (`explicit`, `automatic`, or `rebuild-continuation`), finite-operation demand, the lifecycle queue, the effective binding, and the current room session. The room owner compares the local database object separately and includes the effective device name in its binding signature, so the binding is not interchangeable with the P2P provider's active-publication configuration identity. The automation coordinator owns automation-baseline deduplication. The current `P2PRoomSession` owns one room, peer handlers, advertisements, RPC, session cancellation, and finite operations. Trystero owns shared relay clients and physical peer connections.

`P2PActiveReplicatorAdapter` implements the minimal `ReplicatorInstance` view required by the provider contract. Its `initializeDatabaseForReplication`, `openReplication`, and `terminateSync` methods delegate to the P2P service. Its `closeReplication` is intentionally a no-op: closing the active adapter must not close the room, relay actions, finite-operation registry, or stable P2P service. The service lifecycle (`closeForLifecycle`, owner close, or binding reconciliation) is the only owner which retires the room.

The P2P connection probe follows the same boundary. An active compatible room may be observed; an incompatible active binding blocks the probe. An idle probe can run a caller-owned trial through the owner queue and must await clean-up. It must not publish itself as the active room or close resources owned by another session.

Automatic configured-target replication acquires finite room demand, waits for peer advertisements within a bounded window, evaluates admission without prompting, shares the baseline through `P2PAutomationCoordinator`, and returns an explicit completed, partial, blocked, cancelled, or failed outcome. Explicit disconnect veto remains distinct from host lifecycle closure. AutoStart cannot clear an explicit disconnect veto; rebuild continuation is a separately authorised path.

## Adding a built-in provider

Provider work crosses the Commonlib package boundary and this repository's host composition. The following sequence is the smallest complete path; omit a step only when the provider genuinely has no corresponding concept.

### First decide whether this is a provider

A new provider is appropriate when a remote kind needs a distinct active Replicator lifecycle, effective configuration identity, readiness policy, or replication roles. A new S3-compatible service or another backend which retains the Object Storage Journal protocol is usually an `IJournalStorage` adapter instead; see [Journal Replicator 2nd Edition](../design_docs_of_journalsync_2nd.md). A new read-only observation over an existing provider is usually a remote resource or a focused view. Neither case needs another active provider.

1. **Define the canonical remote kind in Commonlib.** Add the `RemoteType` value and its setting type in `src/common/models/setting.const.ts` and `src/common/models/setting.type.ts`, update exports such as `src/common/types.ts`, and add defaults or persistence fields only where the provider needs them. Add focused setting and migration tests.
2. **Implement the Replicator in Commonlib.** Place the provider-specific Replicator and transport code under `src/replication/<provider>/`. Implement the minimal `ReplicatorInstance` contract, cancellation, and close semantics. Keep provider-specific operations on focused facets. Add unit tests for success, cancellation, failure, stop, and replacement-sensitive clean-up.
3. **Define effective configuration identity.** Include every setting which changes the live binding, and exclude profile labels or policy-only settings. Normalise two spellings only when the runtime genuinely treats them as equivalent. Put shared identity logic in Commonlib when the provider is shared there; put the host projection in `src/common/replicatorConfigurationIdentity.ts` when this repository owns it. Test that equivalent effective settings retain an instance and binding changes replace it. Never expose identity values in logs, UI, or persistence.
4. **Add configuration and setup seams in Commonlib.** If the provider has a connection string, profile, migration, or document representation, update the applicable files, including `src/common/ConnectionString.ts`, `src/remoteConfigurations.ts`, `src/common/configForDoc.ts`, `src/API/processSetting.ts`, and their focused tests. These files are conditional: do not add a setting representation which the provider does not need.
5. **Declare the provider contract surface at its composition owner.** Add a central provider to the tuple and definition map in this repository's `src/common/replicatorProviders.ts`; add a P2P-like provider to the closed tuple owned by its Commonlib `serviceFeature`. In the definition, declare readiness, all four remote-resource capability entries, user and unattended OneShot runners, Continuous where applicable, `stopActiveTransfer`, and central administration where applicable. Extend `RemoteResource` kinds only for a genuinely cross-provider resource; do not encode provider-specific helpers as generic capabilities.
6. **Implement stateful transport ownership, if required.** For a P2P-like provider, add a stable service owner, focused views, lifecycle ownership, binding identity, session retirement, and automation fences in Commonlib, then compose it through a `serviceFeature`. Keep any active adapter non-owning if the service owns a replaceable transport. Add lifecycle, stale-callback, probe, and database-replacement tests before host integration.
7. **Compose the provider in each supporting application.** Central definitions are registered by `LiveSyncBaseCore`. A dedicated stateful feature must be composed from the applicable hosts: `src/main.ts`, `src/apps/cli/main.ts`, `src/apps/webapp/WebAppRuntime.ts`, and `src/apps/webpeer/src/WebPeerRuntime.ts`. Each selected catalogue must remain exhaustive and closed; add no runtime provider registry.
8. **Add host-owned resources and administration.** Add or extend `src/common/replicatorResources/` for connection, preferred-tweak, Security Seed, and synchronisation-information probes. Add provider-specific central verification and mutations in `src/common/centralRemoteAdministration.ts` when applicable. Test ownership, snapshots, the distinction between unavailable and absent states, postconditions, and disposal.
9. **Integrate setup and user-facing configuration.** Update the relevant setup dialogue files under `src/modules/features/SetupWizard/dialogs/`, including `dialogs/setupDialogTypes.ts`, SetupManager or setup features, remote configuration handling, and message resources under `src/common/messagesYAML` plus generated baked messages where required. Follow the terminology and settings mappings in the repository documentation, and add setup, serialisation, and migration tests.
10. **Integrate host operations and triggers.** Adapt only the capability call sites which the provider supports. Check `src/serviceFeatures/replicationScheduling.ts`, `src/serviceFeatures/replication/`, CLI commands under `src/apps/cli/commands`, and application-specific lifecycle composition. Ensure unattended paths use `NO_INTERACTION`, periodic and resume fallback obey capability outcomes, and no caller reaches for `getNewReplicator` or the `LiveSyncBaseCore.replicator` compatibility getter.
11. **Validate the package boundary.** In Commonlib, run its focused unit tests, build or pack the exact candidate artefact, and test the downstream LiveSync consumer against that artefact. In this repository, run provider map, configuration-identity, resource, central-administration, scheduling, and replication-feature unit tests. Add a real remote integration test, CLI E2E coverage, or real Obsidian E2E coverage for every boundary the provider claims to support.

A provider is complete only when its source ownership, replacement fence, capability matrix, setup path, and tests agree. Updating a setting type or adding a class without adding the closed composition definition does not make it a built-in provider.

## Compatibility seams and non-goals

- `ReplicatorService.getNewReplicator`, `getActiveReplicator`, and the `LiveSyncBaseCore.replicator` getter remain compatibility seams for existing callers. Beyond `ReplicatorInstance`, `LiveSyncBaseCore.replicator` exposes provider-specific members only as an optional compatibility view. None is a new provider extension point.
- `ReplicationService.performReplication` remains a direct legacy path through the active instance. New call sites use `replicateUserInitiated`, `replicateUnattended`, `replicateUnattendedByEvent`, `startContinuous`, or `stopActiveTransfer`, as appropriate.
- `LiveSyncAbstractReplicator` and other legacy classes may retain methods needed by existing modules. New features use typed provider capabilities, resource factories, and focused service views; they do not infer capabilities from a large legacy class.
- The generic contract does not unify directional Journal operations, Streaming replication, Chunk retrieval, remote-size inspection, garbage collection, repair workflows, or provider-specific administration. Those remain explicit provider or host features.
- The provider catalogue is not a public runtime registry, dynamic plug-in API, or settings-driven discovery mechanism. Unknown `RemoteType` values are composition/configuration failures, not third-party providers which the runtime should load.
- Commonlib remains an external authoritative package. This repository must not recreate `src/lib`, `_types`, or another source mirror to bypass the package boundary.
- P2P logical room retirement does not authorise closing shared raw `RTCPeerConnection` objects. Physical transport ownership remains with Trystero.
- No numeric P2P session epoch is exported. Session object identity, admission flags, abort signals, and the owner queue provide the fence; the P2P automation generation and the host scheduling generation protect different concerns.
- Suspension is not a database replacement or a successful replication result. It stops or closes the appropriate active work and relies on the next lifecycle event to resume, reconcile, or retire it.

## Source map

### This repository

| Concern | Source and tests |
| --- | --- |
| Host composition and compatibility boundary | [`LiveSyncBaseCore.ts`](../../src/LiveSyncBaseCore.ts), [`main.ts`](../../src/main.ts), [`src/apps/cli/main.ts`](../../src/apps/cli/main.ts), [`WebAppRuntime.ts`](../../src/apps/webapp/WebAppRuntime.ts), [`WebPeerRuntime.ts`](../../src/apps/webpeer/src/WebPeerRuntime.ts) |
| Closed central provider map | [`replicatorProviders.ts`](../../src/common/replicatorProviders.ts), [`replicatorProviders.unit.spec.ts`](../../src/common/replicatorProviders.unit.spec.ts) |
| Provider identities and resources | [`replicatorConfigurationIdentity.ts`](../../src/common/replicatorConfigurationIdentity.ts), [`replicatorResources/`](../../src/common/replicatorResources/index.ts), [`replicatorResources.unit.spec.ts`](../../src/common/replicatorResources.unit.spec.ts) |
| Central administration and preflight | [`centralRemoteAdministration.ts`](../../src/common/centralRemoteAdministration.ts), [`centralRemoteAdministration.unit.spec.ts`](../../src/common/centralRemoteAdministration.unit.spec.ts), [`replication/preflight.ts`](../../src/serviceFeatures/replication/preflight.ts) |
| Host scheduling and replication feature | [`replicationScheduling.ts`](../../src/serviceFeatures/replicationScheduling.ts), [`replicationScheduling.unit.spec.ts`](../../src/serviceFeatures/replicationScheduling.unit.spec.ts), [`replication/index.ts`](../../src/serviceFeatures/replication/index.ts) |
| Service graph and bounded local activity | [`ObsidianServices.ts`](../../src/modules/services/ObsidianServices.ts), [`ObsidianServiceHub.ts`](../../src/modules/services/ObsidianServiceHub.ts) |
| Architecture guidance | [`devs.md`](../../devs.md), [Service feature and legacy Module boundaries](service_feature_and_legacy_module_boundaries.md), [Project glossary](../glossary.md), [Documentation style and vocabulary conventions](../terms.md), [`docs/settings.md`](../settings.md), [`docs/troubleshooting.md`](../troubleshooting.md) |

### Commonlib 0.1.21

The exact package tree described here is [pinned at commit `e770f617ff0fc88f4823226b0ab3aefdff50cc1e`](https://github.com/vrtmrz/livesync-commonlib/tree/e770f617ff0fc88f4823226b0ab3aefdff50cc1e). The source and design-document links below target that commit.

| Concern | Commonlib source or design document at the pinned commit |
| --- | --- |
| Provider contract, outcomes, identities, and resource capabilities | [`src/replication/ReplicatorInstance.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/ReplicatorInstance.ts), [`src/replication/ReplicatorProvider.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/ReplicatorProvider.ts), [`src/replication/RemoteResource.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/RemoteResource.ts), [`src/replication/CentralRemoteAdministration.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/CentralRemoteAdministration.ts), [`src/replication/CentralCompatibility.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/CentralCompatibility.ts) |
| Active publication and typed operations | [`src/services/base/ReplicatorService.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/services/base/ReplicatorService.ts), [`activeReplicatorState.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/services/base/ReplicatorService.activeReplicatorState.ts), [`typedReplication.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/services/base/ReplicationService.typedReplication.ts), [`readiness.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/services/base/ReplicationService.readiness.ts) |
| P2P service, room ownership, and automation | [`P2PService.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/p2p/P2PService.ts), [`P2PRoomSessionOwner.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/trystero/P2PRoomSessionOwner.ts), [`P2PRoomSession.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/trystero/P2PRoomSession.ts), [`useP2PReplicatorFeature.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/trystero/useP2PReplicatorFeature.ts), [`P2PAutomationCoordinator.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/trystero/P2PAutomationCoordinator.ts) |
| P2P lifecycle design | [`docs/p2p-transport-lifecycle.md`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/docs/p2p-transport-lifecycle.md) |
| Database and service-feature lifecycle | [`docs/database-lifecycle.md`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/docs/database-lifecycle.md), [`docs/service-feature-composition.md`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/docs/service-feature-composition.md), [`docs/settings-lifecycle.md`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/docs/settings-lifecycle.md) |
| Journal transfer and remote epoch | [`LiveSyncJournalReplicator.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/journal/LiveSyncJournalReplicator.ts), [`JournalSyncCore.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/journal/JournalSyncCore.ts), [`JournalSyncTypes.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/journal/JournalSyncTypes.ts) |
| Journal storage adapter boundary | [`JournalStorageAdapter.ts`](https://github.com/vrtmrz/livesync-commonlib/blob/e770f617ff0fc88f4823226b0ab3aefdff50cc1e/src/replication/journal/objectstore/JournalStorageAdapter.ts) |

### Decision records

- [Core provider contract and capabilities ADR](../adr/2026_08_replicator_capabilities_01_core_contract.md)
- [P2P service lifecycle ADR](../adr/2026_08_replicator_capabilities_02_p2p_service_lifecycle.md)
- [Replicator migration plan ADR](../adr/2026_08_replicator_capabilities_03_migration_plan.md)
- [P2P Room and Transport Lifecycle ADR](../adr/2026_07_p2p_transport_lifecycle.md)
- [Bounded Remote Activity ADR](../adr/2026_07_bounded_remote_activity.md)
