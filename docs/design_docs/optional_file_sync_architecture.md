---
date: 2026-09-03
commonlib-version: "0.1.21"
self-hosted-livesync-version: "1.0.24"
status: accepted
---

# Optional-file synchronisation architecture

## Purpose and scope

This document describes the implemented ownership and composition of
Customisation Sync and Hidden File Sync. These features share host event
boundaries, but retain separate persisted data, state, and application
behaviour. The corresponding decision history and migration constraints are
recorded in the
[Customisation Sync and Hidden File Sync ownership ADR](../adr/2026_09_customisation_and_hidden_file_sync_ownership.md).

The implementation is private application architecture. It does not define a
third-party extension API, a runtime feature registry, or a generic hidden-file
engine.

## Topology

```text
Obsidian composition (`main.ts`)
  |
  +--> `useOptionalFileSync`
  |      |
  |      +--> one Service-handler registration owner
  |      +--> pure local-path and document routing policy
  |      |
  |      +--> `CustomisationSyncContext`
  |      |      +-- `CustomisationSyncPathOperations`
  |      |      +-- `SnapshotPersistence`
  |      |      +-- `SnapshotOperations`
  |      |      +-- `ApplicationOperations`
  |      |      +-- `ScanOperations`
  |      |      +-- recent-event deduplicator
  |      |      +-- immutable service-handler and testing views
  |      |      |
  |      |      +--> `CatalogueOperations`
  |      |             +-- `CatalogueState`
  |      |             +-- one catalogue queue and progress lifecycle
  |      |             +-- `CatalogueV1`
  |      |             +-- `CatalogueV2`
  |      |             +-- `CatalogueMigration`
  |      |      ^
  |      |      +-- narrow dependencies from
  |      |          `customisationSyncObsidianAdapter`
  |      |
  |      +--> `HiddenFileSyncContext`
  |             ^
  |             +-- narrow dependencies from
  |                 `hiddenFileSyncObsidianAdapter`
  |             |
  |             +--> `HiddenFileSyncProcessedState`
  |             |      +-- three autosaved reconciliation maps
  |             |      +-- key, mtime, reset, and settlement rules
  |             |
  |             +--> `HiddenFileSyncChangeProcessor`
  |             |      +-- storage and database change processing
  |             |      +-- per-path serialisation and activity state
  |             |
  |             +--> `HiddenFileSyncConflictResolution`
  |             |      +-- pending paths and two-stage conflict queue
  |             |      +-- automatic and interactive JSON resolution
  |             |
  |             +--> `HiddenFileSyncPathAdmission`
  |             |      +-- ownership, path, pattern, and ignore-file admission
  |             |      +-- per-context parsed-pattern cache
  |             |
  |             +--> `HiddenFileSyncChangeNotifier`
  |             |      +-- changed-folder batching and scheduled delivery
  |             |      +-- suppression and Notice-effect teardown
  |             |
  |             +--> `Reconciliation`
  |             |      +-- storage and database scans
  |             |      +-- offline reconciliation, rebuilds, and initialisation
  |             |
  |             +-- immutable service-handler, command, repair, and testing views
  |
  +--> `useCustomisationSyncUI`
  |      +-- catalogue and operation view
  |      +-- Hidden File Sync initialisation view
  |
  +--> `useHiddenFileSyncCommands`
         +-- Hidden File Sync command view

Hatch settings consumer
  +-- Hidden File Sync exact-revision repair view
```

`useOptionalFileSync` is the only owner of the overlapping synchronisation
registrations. The presentation serviceFeatures receive focused views from
that composition; they do not locate either concrete context through the
application core.

## Ownership

| Owner                                 | Owns                                                                                                                                                                                                          | Does not own                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useOptionalFileSync`                 | Construction of both contexts, handler registration and removal, local-owner selection, namespace dispatch, compatibility callback order, and context disposal order.                                         | Persisted feature state, synchronisation algorithms, commands, dialogues, or Notices.                                                                                                                            |
| `CustomisationSyncContext`            | Lifecycle and view composition, raw-event admission and scheduling, configuration transitions, periodic scan policy, and focused-owner lifetimes.                                                             | Scan reconciliation, snapshot writes or refresh sequencing, catalogue internals, application and comparison algorithms, Obsidian dialogues, ribbon actions, or handler registration.                             |
| `CustomisationSyncPathOperations`     | Binding live configuration-directory, mode, and device-name projections to the pure category, target-path, V1 key, V2 key, and device-prefix functions.                                                       | I/O, mutable state, local-owner selection, or persistence.                                                                                                                                                       |
| `SnapshotPersistence`                 | V1 grouped and V2 per-file local-to-database writes, unchanged-content checks, logical deletion, and explicit catalogue-refresh outcomes.                                                                     | Catalogue state or refresh execution, scans, lifecycle policy, application, dialogues, or plug-in reload.                                                                                                        |
| `SnapshotOperations`                  | Applying persistence outcomes to the catalogue with the inherited awaited V1 and fire-and-forget V2 refresh timing.                                                                                           | Snapshot encoding, catalogue state, scans, lifecycle policy, or host effects.                                                                                                                                    |
| `ApplicationOperations`               | Comparing, applying, duplicating, and deleting selected Customisation Sync snapshots through narrow storage, snapshot, and catalogue ports.                                                                   | Catalogue enumeration, raw-event admission, periodic scheduling, or view composition.                                                                                                                            |
| `ScanOperations`                      | Configuration-file enumeration and V1/V2 reconciliation with local and database state.                                                                                                                        | Periodic scheduling, raw-event admission, snapshot persistence details, or catalogue state.                                                                                                                      |
| `CatalogueOperations`                 | Catalogue enumeration and publication, one format-dispatching queue and its progress lifecycle, and composition of the state, V1, V2, and migration modules.                                                  | Local-file scanning, snapshot application, raw-event routing, dialogues, or handler registration.                                                                                                                |
| `CatalogueState`                      | Transient catalogue rows, manifest lookup and mtime cache, reactive catalogue and manifest stores, and catalogue update progress.                                                                             | Database or storage I/O, scan scheduling, routing, or persistence.                                                                                                                                               |
| `CatalogueV1`                         | Loading and publishing grouped V1 catalogue rows.                                                                                                                                                             | V2 decoding, migration, queue lifetime, or local-file scanning.                                                                                                                                                  |
| `CatalogueV2`                         | Building and updating per-file V2 rows and manifests.                                                                                                                                                         | V1 loading, migration, queue lifetime, or local-file scanning.                                                                                                                                                   |
| `CatalogueMigration`                  | Translating a grouped V1 binder into V2 per-file documents, deleting the migrated binder, and applying its required V1 refresh.                                                                               | General catalogue enumeration, queue ownership, or local-file scanning.                                                                                                                                          |
| Customisation Sync event deduplicator | The bounded, newest-first keys used to admit raw configuration events once.                                                                                                                                   | Scheduling, path ownership, catalogue state, or persisted data.                                                                                                                                                  |
| `HiddenFileSyncContext`               | Lifecycle and view composition, handler admission, configuration transitions, periodic scan state, exact-revision repair composition, and focused-owner lifetimes.                                            | Scan and rebuild algorithms, path admission state, change-event serialisation, processed-state representation, notification batching, conflict queue state, Obsidian dialogues, or service handler registration. |
| `HiddenFileSyncProcessedState`        | Three device-local autosaved maps, exact storage and database keys, retained known mtime, reset behaviour, and storage/database settlement effects.                                                           | File transfer, scan scheduling, conflict handling, or presentation.                                                                                                                                              |
| `HiddenFileSyncChangeProcessor`       | Storage and database change processing, same-path event serialisation, bounded concurrency, activity counts, and the inherited event-consumption and settlement order.                                        | Full scans, initialisation policy, notification presentation, or conflict interaction.                                                                                                                           |
| `Reconciliation`                      | Storage and database enumeration, full scans, offline reconciliation, rebuild direction and ordering, processed-state adoption, initialisation sequencing, and the scoped rebuild interceptor.                | Individual transfer implementation, conflict interaction, path-pattern state, periodic scheduling, or host lifecycle.                                                                                            |
| `HiddenFileSyncConflictResolution`    | Conflict admission and deduplication, pending paths, the parallel classification and serial interaction queues, automatic merge, newer-revision policy, interactive JSON resolution, and conflict settlement. | Obsidian dialogue instances, general Hidden File Sync scans, processed-state caches, or Service handler registration.                                                                                            |
| `HiddenFileSyncPathAdmission`         | The ownership-first eligibility sequence, hidden-path and pattern policy, asynchronous ignore-file check, and the per-context parsed-pattern cache.                                                           | Composition-level owner selection, scans, transfer, or persistence.                                                                                                                                              |
| `HiddenFileSyncChangeNotifier`        | Changed-folder deduplication, delayed delivery, live suppression and configuration-directory checks, scheduled-task cancellation, and the host Notice show/hide effects.                                      | The Obsidian Notice instance, file extraction, or scan policy.                                                                                                                                                   |
| Customisation Sync Obsidian adapter   | Obsidian conflict selection, Notice presentation, plug-in reload, restart requests, Vault enumeration, progress telemetry, and platform-derived fallback device names.                                        | Catalogue state, routing, or persisted document operations.                                                                                                                                                      |
| Hidden File Sync Obsidian adapter     | JSON conflict dialogue lifetime, progress presentation, grouped change Notices, plug-in reload actions, restart scheduling, Vault enumeration, and compatibility activity publication.                        | Transfer, reconciliation, processed-state, or conflict decisions.                                                                                                                                                |
| `useCustomisationSyncUI`              | Command, ribbon, dialogue, open-request subscription, and their unload teardown.                                                                                                                              | Synchronisation state or Hidden File Sync initialisation behaviour.                                                                                                                                              |
| `useHiddenFileSyncCommands`           | Hidden File Sync command registration, setting-change subscription, and their unload teardown.                                                                                                                | Synchronisation state or command implementation.                                                                                                                                                                 |

The two domain contexts coordinate one cohesive synchronisation workflow each.
Their private operations and focused owners are not additional serviceFeatures:
they do not independently register host integration or have separate
application lifetimes. The newly extracted catalogue, snapshot, application,
scan, and reconciliation modules omit the domain prefix because their feature
directories already supply that scope; public context and view names retain it
for compatibility. `CustomisationSyncPathOperations` is a stateless capability
which binds live inputs to pure path functions.
`SnapshotPersistence` is a host-neutral operation boundary: it returns
structured mutation and refresh outcomes without reaching into the catalogue
or presentation. `SnapshotOperations` consumes those outcomes and preserves
their refresh timing. `ApplicationOperations` and `ScanOperations` depend on
those narrow ports instead of calling back through the context.

`CatalogueOperations` owns one catalogue queue, its progress subscription, and
the shared state projected by the format-specific modules. The live V2 setting
selects V1 loading or V1-to-V2 migration when each queued item starts. Persisted
V1 and V2 documents can coexist during migration, so V2 documents remain
recognisable regardless of the currently selected write format. `CatalogueV1`
and `CatalogueV2` contain only their format-specific catalogue behaviour, while
`CatalogueMigration` remains the explicit bridge between them. The Hidden File
Sync path-admission owner holds the parsed-pattern cache, and its change
notifier holds the pending folder set and scheduled-task lifetime.
`HiddenFileSyncChangeProcessor` is a focused resource owner because its
semaphore, per-path serialisation, activity counters, and event settlement form
one independently testable lifecycle.
`HiddenFileSyncConflictResolution` is another focused resource owner because
conflict admission, pending-path identity, two serialisation stages, and
disposal form a separate lifecycle.
`Reconciliation` keeps storage and database enumeration together because
offline comparison, rebuilds, and each initialisation direction depend on both
sides and their ordered processed-state adoption.

The two state owners intentionally do not implement a common generic state
contract. Customisation Sync projects transient catalogue and presentation
state from `ix:` documents. Hidden File Sync persists operational markers used
for reconciliation, with distinct path identity, deletion, reset, and retained
mtime rules. Their common boundary is lifecycle ownership by a context, rather
than interchangeable state semantics.

## Routing and handler contracts

Local file ownership is selected before either context processes an event.
`optionalFileSyncRouting.ts` combines the configuration directory, feature
enablement, Customisation Sync mode, and current path category. Hidden File
Sync path admission then checks ownership again before reading its current
target patterns, ignore patterns, or ignore-file result. This keeps the same
guard available to raw events, scheduled scans, and database reflection
without duplicating the policy or its cache in the context.

The maintained local ownership is:

| Path mode                                                           | Owner              |
| ------------------------------------------------------------------- | ------------------ |
| Customisation path in Selective or Flagged Selective mode           | Customisation Sync |
| Customisation path in Automatic mode, with Hidden File Sync enabled | Hidden File Sync   |
| Customisation path in Ignore mode                                   | Neither context    |
| Other eligible hidden path                                          | Hidden File Sync   |
| Disabled, excluded, ignored, or ordinary Vault path                 | Neither context    |

Local ownership is distinct from persisted-document recognition. The
composition dispatches `ps:` and `ix:` conflict documents to Customisation
Sync and sends `i:` conflict documents through the Hidden File Sync semantic
handler view. Existing documents remain recognisable after a local mode
changes.

Each context exposes an immutable semantic handler view. The composition
registers these operations and adapts them to the existing Commonlib handler
contracts; registry aggregation names and binding concerns do not leak back
into either context:

- raw optional-file events are offered to exactly one selected owner;
- a selected handler which skips or fails does not fall through to the other
  context;
- Customisation Sync receives virtual Customisation documents;
- Hidden File Sync receives optional synchronisation results for `i:`
  documents;
- shared lifecycle handlers retain Customisation-before-Hidden order; and
- the Vault extra-target handler returns the final routed ownership decision.

## Domain dependency boundaries

Neither context imports `main.ts`, accepts `LiveSyncCore`, extends
`LiveSyncContext`, or reaches through `this.core`, `this.services`, or
`this.app`.

Each context receives live getter projections for settings and the local
database. This is important because both can be replaced during settings or
database lifecycle work. Stable ServiceModules, such as storage access and
database file access, are supplied as focused method projections. Host effects
are named individually in the dependency contract.

The Hidden File Sync exact-revision boundary uses only
`fetchEntryMeta`, `getConflictedRevs`, `fetchEntryFromMeta`, and
`storeWithBaseRevision`. A selected revision is checked against the current
winner and conflict leaves before it can be applied or extended. The repair
view therefore does not expose the complete database file-access module.

Obsidian-specific adapters can import the application core as a type and read
the required Services and ServiceModules at composition. The resulting
dependency objects are the only bridge from either domain context to Obsidian
presentation and host lifecycle APIs.

## Views and consumers

One context can back several focused views without creating several state
owners:

- `CustomisationSyncDialogView` supplies catalogue and explicit application
  operations to the Customisation Sync dialogue;
- `HiddenFileSyncInitialisationView` supplies the initialisation directions
  needed by that dialogue;
- `HiddenFileSyncCommandView` supplies availability and scan operations to
  host-owned commands; and
- `HiddenFileSyncRepairView` supplies local inspection and exact-revision
  operations to the Hatch pane.

Production consumers receive these views directly. `OptionalFileSyncFeature`
also exposes immutable, explicitly internal testing views for maintained
real-Obsidian contract tests. They provide named operations, including a scoped
rebuild interceptor, without exposing context instances, dependency objects,
queues, or writable stores. These test seams are not production service
locators and should not be used by application features. Path categorisation
and key derivation are tested directly through their focused capability rather
than being re-exported through a broad context testing view.

## Lifecycle and disposal

The composition is created after the Service Hub and required ServiceModules
exist, and before lifecycle-driven feature work begins. Each context creates
its own periodic processor and focused resource owners.
`CustomisationSyncContext` creates one path capability, one snapshot-persistence
boundary, one snapshot coordinator, one application owner, one scan owner, one
catalogue owner, and one recent-event deduplicator. The catalogue owner creates
its shared state, one queue and progress subscription, and the V1, V2, and
migration modules. `HiddenFileSyncContext` creates one
path-admission owner, one change notifier, and one processed-state owner before
composing database write and extraction operations around their narrow ports.
It then creates one change processor, one conflict-resolution owner, and one
reconciliation owner. The change processor owns its semaphore and activity
state; the reconciliation owner owns its scoped testing interceptor.
Full conflict scans admit discovered paths into the same queue without
suspending it, so ordinary database conflict notifications continue during a
slow scan. After enumeration, the operation waits for both classification and
interaction stages to drain.

On application unload, `useOptionalFileSync` first removes every Service
handler registration. It then disposes Customisation Sync followed by Hidden
File Sync, preserving the former compatibility order. Disposal disables
periodic admission, disposes the conflict-resolution owner, terminates queues,
clears transient caches and pending sets, cancels scheduled notification work,
resets compatibility telemetry, and hides owned Notices. The two presentation
serviceFeatures independently remove their commands, event subscriptions,
ribbon state, and dialogue instances.

## Persisted compatibility

This architecture does not migrate persisted data:

- Customisation Sync remains in the `ix:` namespace and continues to read V1
  grouped and V2 per-file data;
- Hidden File Sync remains in the `i:` namespace;
- file content remains in Chunks referenced by Metadata rather than being
  embedded as ordinary Metadata content;
- exact PouchDB revision identifiers remain part of repair and conflict
  operations; and
- Hidden File Sync processed-state keys remain device-local key-value data.

Any change to these contracts requires separate compatibility tests and, when
appropriate, a migration decision.

## Verification boundaries

Focused unit tests cover routing, path-option binding, Hidden File Sync
admission ordering and cache invalidation, semantic handler views, context
owner isolation, teardown, initial cache selection, exact-revision repair,
Customisation Sync scan reconciliation and context delegation, single-queue
catalogue disposal and publication, live V1/V2 dispatch, V1 and V2 snapshot
persistence outcomes, logical-deletion idempotence, refresh ordering,
application operations, Hidden File Sync change-event serialisation and
settlement, reconciliation direction and scan ordering, notification batching,
conflict queue admission, revision selection, automatic and interactive merge
effect ordering, conflict dialogue adaptation, grouped Notices, and
compatibility activity publication.
The boundary test prevents either domain context from regaining core or
Obsidian dependencies.

Changes to local routing or transfer require the maintained Customisation Sync
and Hidden File Sync real-Obsidian workflows. A composition change also
requires the mixed-ownership case which proves that one local path is not
written by both contexts.
