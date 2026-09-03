---
date: 2026-09-03
commonlib-version: "0.1.21"
self-hosted-livesync-version: "1.0.24"
status: accepted
---

# Architectural Decision Record: Customisation Sync and Hidden File Sync ownership

## Status

Accepted and implemented. The completed structural stages
extract the Customisation Sync path and codec operations, characterise the
current shared routing behaviour, remove the production UI dependency cycle,
move host presentation and Hidden File Sync commands into serviceFeatures,
give one optional-file serviceFeature ownership of both runtime contexts and
all Service handler registration, and replace both runtimes' complete-core
dependencies with narrow host adapters. A pure local-path policy now selects
one writer for raw events, scheduled scans, and automatic database-to-local
reflection. The constructor-name add-on lookup and the `ConfigSync` and
`HiddenFileSync` add-on identities have been retired.

The Customisation Sync private context owns its catalogue, progress, manifest,
queue, and periodic state. The Hidden File Sync private context owns its
processed-state caches, reconciliation and conflict queues, activity counts,
and periodic state. Each receives live settings and database projections,
focused storage, path, and exact-revision capabilities, and explicit host
effects rather than `LiveSyncCore`.

The corresponding implemented topology is documented in
[Optional-file synchronisation architecture](../design_docs/optional_file_sync_architecture.md).

## Context

Customisation Sync and Hidden File Sync are supported, advanced, opt-in
features with different data and interaction contracts:

- Customisation Sync stores device-scoped snapshots in the `ix:` namespace.
  It supports grouped V1 documents and per-file V2 documents, presents a
  catalogue, and applies selected remote state only after an explicit action.
- Hidden File Sync stores one mirrored hidden file in each `i:` Metadata
  document. It scans and reconciles local and database state, applies eligible
  remote changes automatically, and maintains device-local processed-state
  records for offline and conflict handling.

In the baseline implementation, the `ConfigSync` and `HiddenFileSync` add-ons
each combined domain operations, mutable state, Service handler registration,
lifecycle work, settings policy, commands, and Obsidian presentation. Both
received the complete core through `LiveSyncCommands`, and both registered
handlers for optional file events, conflicts, settings, application lifecycle,
database initialisation, and replication.

Some of those Commonlib handlers short-circuit at the first successful or
non-empty result. The construction order of `ConfigSync` before
`HiddenFileSync` is therefore observable behaviour. The Obsidian storage-event
manager also asks the Vault Service whether a configuration-directory file is
an extra target, while the corresponding predicate is currently registered by
`HiddenFileSync`. Local file ownership is consequently distributed across the
storage-event manager, both add-ons, settings entries, target and ignore
patterns, and handler registration order.

In the baseline implementation, user-interface, maintenance, and
real-Obsidian E2E consumers located the concrete add-ons through `getAddOn()`.
Removing either add-on before migrating those consumers would therefore have
combined an ownership change, a lifecycle change, and a consumer migration in
one step.

The baseline Customisation Sync presentation also formed a runtime import
cycle: `ConfigSync` imported its Obsidian dialogue, the dialogue imported its
Svelte pane, and the pane imported `ConfigSync` and `HiddenFileSync` to locate
both add-ons. The child row component imported `ConfigSync` again. The settings
tab also imported `main.ts` as a runtime binding even though it used the
plug-in class only as a type. Bundling survived because those bindings were
read after module evaluation, but that timing was not an architectural
contract. Presentation therefore had to move off the concrete add-ons before
the domain runtimes could be extracted.

## Decision drivers

The redesign must:

1. preserve `ix:` and `i:` data, including V1 and V2 Customisation Sync data;
2. give each local path at most one synchronisation owner;
3. remove handler registration order as the source of path ownership;
4. preserve explicit Customisation Sync application and automatic Hidden File
   Sync reflection as separate behaviours;
5. make mutable state and resource disposal ownership explicit;
6. keep Obsidian presentation outside host-neutral operations;
7. migrate existing add-on consumers to focused views before retiring add-on
   identity; and
8. permit each migration stage to be verified independently.

## Decision

### Retain two domain runtimes

Customisation Sync and Hidden File Sync will remain separate domain runtimes.
They will not be implemented as modes of one generic file-sync engine.

The Customisation Sync runtime will own:

- V1 and V2 codecs and document-path compatibility;
- the device catalogue and snapshot repository;
- scanning, migration, logical deletion, comparison, and explicit apply
  operations; and
- the state required to serialise and report those operations.

The Hidden File Sync runtime will own:

- the device-local processed-state records;
- one-file storage and database transfer, including exact-revision repair;
- start-up, offline, periodic, and pre-replication reconciliation;
- conflict queues and automatic or interactive JSON resolution; and
- the state required to serialise and report those operations.

Neither runtime will accept `LiveSyncBaseCore` as its domain dependency.
Operations will receive narrow Services, ServiceModules, settings projections,
and host effects.

### Compose one owner for overlapping handlers

One joint serviceFeature constructs both private runtime contexts and owns
registration into the overlapping optional-file, conflict, target, settings,
database, replication, and application-lifecycle handlers. A single
optional-file callback selects its local owner before invoking either context,
and a single conflict callback dispatches the disjoint `ps:`, `ix:`, and `i:`
namespaces. Callback order and add-on construction order no longer select the
local file owner. Config-before-Hidden order remains explicit only for shared
lifecycle handlers whose side effects still require compatibility.

The composition feature will remain small. Codecs, path functions,
repositories, state transitions, and transfer operations are ordinary modules
or private contexts rather than separate serviceFeatures. No new
ServiceModule is justified while those capabilities have one composition
owner and no independent long-lived consumers.

Internally, operations will use a typed settlement which distinguishes at
least handled, skipped, and failed work. The composition boundary will adapt
that settlement to the existing Commonlib Boolean or first-result handler
contracts. Existing short-circuit and failure behaviour must be characterised
before an adapter changes it.

### Make local path ownership explicit

A pure routing policy classifies a local path as owned by Customisation
Sync, owned by Hidden File Sync, or ignored with a reason. Its inputs will
include:

- the Obsidian configuration directory;
- whether each feature is enabled and ready;
- the Customisation Sync category and extended mode;
- Hidden File Sync target and ignore patterns; and
- the ignore-file result where that asynchronous policy applies.

The maintained ownership intent is:

| Path and mode                                                | Local owner        |
| ------------------------------------------------------------ | ------------------ |
| Recognised Customisation Sync path in Selective mode         | Customisation Sync |
| Recognised Customisation Sync path in Flagged Selective mode | Customisation Sync |
| Recognised Customisation Sync path in Automatic mode         | Hidden File Sync   |
| Recognised Customisation Sync path in Ignore mode            | Neither feature    |
| Other eligible hidden path                                   | Hidden File Sync   |
| Excluded, ignored, disabled, or ordinary Vault path          | Neither feature    |

This table is now used for raw-event dispatch and is injected into both
contexts for scheduled or database-driven local work. Default and persisted
Selective entries therefore have the same Customisation Sync owner. Hidden
File Sync target patterns and ignore-file results are evaluated only after the
policy selects Hidden File Sync, so they cannot prevent a Selective
Customisation Sync event. Automatic mode has no local owner while Hidden File
Sync is disabled, and Ignore mode has no local owner in either context.

Commonlib's ordinary event queue rejects dot paths while Hidden File Sync is
disabled. The Obsidian raw-event boundary therefore dispatches an event which
the policy assigns to Customisation Sync directly after retaining the queue's
configuration, suspension, and modification-time gates. Events handled while
Hidden File Sync is enabled continue through the ordinary queue.

This is a local-write routing table, not a database-document acceptance table.
Existing `ix:` documents must remain recognisable after a local mode change,
and they must not fall through to ordinary Vault reflection. Existing `i:`
documents retain their own namespace and selection rules. The implementation
therefore keeps namespace-specific database handlers separate from the
local-path policy rather than exposing one general `isTargetPath()` predicate.
A narrower document decision controls whether a local Customisation Sync scan
may mutate an existing `ix:` document; it does not control whether that
document is recognised or consumed.

### Use private contexts and focused views

Each mutable object will have one named owner. Catalogue stores, manifest
caches, processed-state records, recent-event records, locks, semaphores,
queues, periodic processors, Notices, and event subscriptions must be created
and disposed by their feature context or a focused resource owner.

The joint composition may return several views backed by those contexts:

- a Customisation Sync catalogue and operation view for its dialogue;
- a Hidden File Sync initialisation view for settings workflows; and
- a Hidden File Sync repair view for the Hatch pane.

Several views over one context do not create several owners. Views expose
stable application data and operations rather than PouchDB entries, queue
objects, mutable settings records, or the complete core.

Obsidian commands, ribbon actions, dialogues, Notices, plug-in reloads, and
restart scheduling will remain in host-owned composition. The UI will receive
focused views instead of locating `ConfigSync` or `HiddenFileSync` and calling
one add-on from the other.

The Customisation Sync dialogue has its own host-owned presentation
serviceFeature. It owns command, ribbon, event subscription, dialogue reuse,
and dialogue disposal, and consumes the catalogue and Hidden File Sync
initialisation views. Neither domain runtime imports its Obsidian dialogue or
Svelte components. This presentation feature is separate from the joint
synchronisation owner because it registers host UI rather than overlapping
file, conflict, or replication handlers.

Hidden File Sync commands and their setting-change event subscription are
owned by a second host serviceFeature. It consumes only the command view and
releases its lifecycle and event registrations during application unload.

### Retire compatibility façades after consumer migration

The concrete `ConfigSync` and `HiddenFileSync` add-on identities were retained
only until their consumers and handler ownership had migrated. They have now
been replaced by private `CustomisationSyncContext` and
`HiddenFileSyncContext` instances constructed solely by the joint
serviceFeature. `LiveSyncBaseCore.getAddOn()` and its constructor-name lookup
have been removed.

Production code consumes focused views and does not use the broad context
surface. Maintained real-Obsidian E2E workflows use an explicitly internal
test view exposed by the composed feature. This is a transitional test seam,
not a production service locator, and it should be narrowed as those workflows
move to public operations or commands.

The retirement was gated on:

- production UI and maintenance consumers no longer use `getAddOn()` for these
  features;
- maintained E2E helpers use commands or an explicit test view;
- no handler depending on add-on construction order; and
- unload and replacement tests prove that every owned processor,
  subscription, queue, dialogue, and Notice is released.

## Persisted compatibility

This decision does not authorise a data migration.

- `ix:` remains the Customisation Sync Metadata namespace.
- `i:` remains the Hidden File Sync Metadata namespace.
- Metadata continues to reference Chunks rather than embedding raw file
  content as an ordinary Metadata field.
- V1 grouped Customisation Sync documents remain readable.
- V2 per-file Customisation Sync paths and the existing V1-to-V2 migration
  remain readable and idempotent.
- Device and Vault terms, logical deletions, revision identifiers, and current
  path derivation remain compatibility inputs.
- Hidden File Sync processed-state keys remain device-local state unless a
  separately tested migration is introduced.

Pure extraction must preserve exact case, depth, prefix, delimiter, and
fallback behaviour even where a later correction appears desirable.

## Lifecycle and failure boundaries

Feature composition will occur after required Services and ServiceModules
exist and before lifecycle-driven work begins. Command and Obsidian UI
registration will occur at the readiness point required by the host.

The owner will:

- start periodic work only while its feature is enabled, ready, and resumed;
- coalesce or serialise work within the feature instance rather than through
  process-global string keys where practical;
- stop admission before disposing queues or processors;
- unsubscribe every registered local event listener; and
- close owned dialogues and Notices during unload.

A failed operation must not be converted to handled success merely to stop a
later handler, unless a characterisation test proves that the existing
contract deliberately consumes that failure. Such compatibility adaptations
must be visible at the composition boundary.

## Migration and verification sequence

### Stage 1: characterise pure and routing contracts — implemented

- Cover current Customisation Sync category and V1/V2 document-path rules.
- Cover codec round trips, legacy JSON and YAML fallbacks, and migration
  sentinels before extracting the codec.
- Record the effective Selective, Automatic, Ignore, and Flagged Selective
  routing matrix, including feature-disabled and pattern-excluded cases.
- Record handler registration, short-circuiting, and teardown behaviour.

### Stage 2: extract pure operations and the presentation boundary — implemented

- Move Customisation Sync path and document-key functions behind the existing
  façade methods.
- Move the V1/V2 codec with its hash and YAML dependencies made explicit.
- Inject catalogue, initialisation, and repair views into production UI.
- Move Customisation Sync command, ribbon, event subscription, and dialogue
  lifetime into a host-owned presentation serviceFeature.
- Prohibit presentation imports of either concrete add-on or the application
  core, and prohibit the runtime from importing its dialogue.

### Stage 3: make routing ownership explicit — implemented

- Introduce the pure routing policy, initially adapting both runtime contexts
  to it at the joint composition boundary.
- Preserve the characterised legacy routing until each discrepancy has its own
  behavioural decision and regression test.

One optional-file handler now dispatches exactly one selected context, and one
namespace router handles optional conflicts. Both contexts receive the same
static ownership projections for raw events and scans. The final raw-event
decision additionally includes lifecycle readiness, Hidden File Sync patterns,
and the asynchronous ignore-file result. Handler failure does not fall through
to the non-owner.

### Stage 4: extract the Customisation Sync runtime — implemented

- Move catalogue, snapshot repository, scan, apply, compare, delete, and
  migration operations into a private context.
- Replace module-global mutable state with context-owned state.
- Replace the complete-core dependency with narrow dependencies.

The private context, path module, codec module, focused presentation view, and
resource teardown are implemented. Catalogue, enumeration, migration, scan,
and manifest state is owned per context instance. The context accepts only
narrow, live projections and explicit effects; an Obsidian adapter at the
composition edge owns dialogues, Notices, plug-in reload, restart, lifecycle,
Vault access, and compatibility scan telemetry.

### Stage 5: extract the Hidden File Sync runtime — implemented

- Move processed-state, transfer, reconciliation, conflict, and notification
  operations into explicit owners.
- Preserve exact-revision repair and current initialisation directions.
- Replace the complete-core dependency with narrow dependencies.

The private context, focused initialisation, repair, and command views,
host-owned command registration, and processor, cache, subscription, and
Notice teardown are implemented. The context owns transfer, reconciliation,
conflict, and processed-state behaviour through narrow live dependencies.
An Obsidian adapter owns JSON conflict dialogues, progress presentation,
grouped Notices, plug-in reload, restart scheduling, Vault enumeration, and
compatibility activity publication.

### Stage 6: move synchronisation composition — implemented

- Register the overlapping Service handlers once through the joint
  serviceFeature.
- Preserve the characterised lifecycle callback order and Commonlib
  aggregation semantics through focused tests.

### Stage 7: retire the façades — implemented

- Remove add-on identity and constructor-order dependencies.
- Migrate maintained E2E workflows to the explicit feature test boundary.
- Remove constructor-name service lookup from the core.

The implemented topology is documented separately from this migration record
in [Optional-file synchronisation architecture](../design_docs/optional_file_sync_architecture.md).

Each stage will run focused unit tests. Changes to Customisation Sync and
Hidden File Sync will run their respective real-Obsidian E2E workflows. The
composition switch will additionally require a mixed-ownership workflow which
proves that one local path is never written by both features.

## Non-goals

This migration does not:

- merge the two persisted namespaces or sync models;
- move implementation into Commonlib before another maintained host needs the
  capability;
- change feature maturity, default enablement, setup, or initialisation;
- replace current conflict policy with a generic conflict engine;
- rename existing setting keys, command identifiers, or user-interface labels;
  or
- correct unrelated suspicious behaviour while extracting code.

## Characterisation gates

Stage 3 resolved the routing-specific gates with focused regressions:

- an unrecognised eligible hidden path is owned by Hidden File Sync;
- default and persisted Selective entries are owned by Customisation Sync;
- raw Customisation Sync remains available while Hidden File Sync is disabled;
- Hidden File Sync patterns and ignore-file results gate only its selected
  paths;
- Automatic mode without an enabled and ready Hidden File Sync owner is
  ignored rather than falling back to Customisation Sync;
- a selected handler which skips or fails does not fall through to the other
  context; and
- Customisation Sync raw admission now invokes the readiness predicate and
  rejects unrecognised or non-owned paths.

The extraction preserves the existing V1 and V2 plug-in application paths,
exact-revision repair, initial cache conditions, and the selected Hidden File
Sync database-processing settlement. These remain compatibility gates for any
future behavioural change. Any defect correction requires its own failing
regression.

## Alternatives rejected

### Convert each extracted file into a serviceFeature

This would reproduce distributed registration and lifetime ownership under
more function names. Pure operations and one private context are the narrower
boundary.

### Merge both features into one generic hidden-file engine

This would obscure the explicit-apply snapshot contract, the automatic mirror
contract, and their incompatible persistence and conflict semantics.

### Remove both add-ons before characterisation and consumer migration

This would change identity, ordering, lifecycle, UI, maintenance, and E2E
boundaries simultaneously. Retaining identity through the earlier migration
stages gave each structural change a smaller failure surface.

### Move the runtimes to Commonlib first

There is no second maintained consumer for the complete feature behaviour at
present. Moving the monoliths across the package boundary would enlarge the
migration without first establishing narrow dependencies.

## Consequences

- Local path ownership can become explicit at one composition boundary.
- Persisted formats and supported user workflows remain stable during the
  migration.
- The composition root gains several focused views but does not gain another
  runtime service locator.
- The legacy add-on identity and constructor-name lookup are removed.
- The two contexts remain sizeable because each owns one cohesive persisted
  synchronisation model, but their dependency surfaces are explicit and do
  not include the complete core. Further extraction should follow a concrete
  behavioural boundary rather than create additional serviceFeatures for
  private operations.

## References

- [Feature maturity for 1.0](2026_07_feature_maturity_for_1_0.md)
- [Service feature and legacy Module boundaries](../design_docs/service_feature_and_legacy_module_boundaries.md)
- [Optional-file synchronisation architecture](../design_docs/optional_file_sync_architecture.md)
- [Hidden File Sync guide](../tips/hidden-file-sync.md)
- [Settings reference](../settings.md#6-customisation-sync-advanced)
- [Development guide](../../devs.md#service-composition-and-legacy-modules)
