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
  |      |      ^
  |      |      +-- narrow dependencies from
  |      |          `customisationSyncObsidianAdapter`
  |      |
  |      +--> `HiddenFileSyncContext`
  |             ^
  |             +-- narrow dependencies from
  |                 `hiddenFileSyncObsidianAdapter`
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

| Owner | Owns | Does not own |
| --- | --- | --- |
| `useOptionalFileSync` | Construction of both contexts, handler registration and removal, local-owner selection, namespace dispatch, compatibility callback order, and context disposal order. | Persisted feature state, synchronisation algorithms, commands, dialogues, or Notices. |
| `CustomisationSyncContext` | The `ix:` codec and path rules, catalogue, manifest cache, scan queues, migration progress, snapshot storage and application, and periodic scan state. | Obsidian dialogues, plug-in lifecycle APIs, ribbon actions, or handler registration. |
| `HiddenFileSyncContext` | The `i:` transfer rules, device-local processed-state caches, reconciliation, exact-revision repair, conflict queues, notification batching, activity counts, and periodic scan state. | Obsidian conflict dialogues, grouped Notices, plug-in lifecycle APIs, or handler registration. |
| Customisation Sync Obsidian adapter | Obsidian conflict selection, Notice presentation, plug-in reload, restart requests, Vault enumeration, progress telemetry, and platform-derived fallback device names. | Catalogue state, routing, or persisted document operations. |
| Hidden File Sync Obsidian adapter | JSON conflict dialogue lifetime, progress presentation, grouped change Notices, plug-in reload actions, restart scheduling, Vault enumeration, and compatibility activity publication. | Transfer, reconciliation, processed-state, or conflict decisions. |
| `useCustomisationSyncUI` | Command, ribbon, dialogue, open-request subscription, and their unload teardown. | Synchronisation state or Hidden File Sync initialisation behaviour. |
| `useHiddenFileSyncCommands` | Hidden File Sync command registration, setting-change subscription, and their unload teardown. | Synchronisation state or command implementation. |

The two domain contexts remain sizeable because they each own one cohesive
persisted synchronisation model. Their private operations are not additional
serviceFeatures: they do not independently register host integration or have
separate application lifetimes. Extract a further ordinary module or focused
state owner when a concrete invariant, replacement lifecycle, or independently
testable operation justifies that boundary.

## Routing and handler contracts

Local file ownership is selected before either context processes an event.
`optionalFileSyncRouting.ts` combines the configuration directory, feature
enablement, Customisation Sync mode, and current path category. Hidden File
Sync target patterns and ignore-file results are evaluated only after the
static policy selects Hidden File Sync.

The maintained local ownership is:

| Path mode | Owner |
| --- | --- |
| Customisation path in Selective or Flagged Selective mode | Customisation Sync |
| Customisation path in Automatic mode, with Hidden File Sync enabled | Hidden File Sync |
| Customisation path in Ignore mode | Neither context |
| Other eligible hidden path | Hidden File Sync |
| Disabled, excluded, ignored, or ordinary Vault path | Neither context |

Local ownership is distinct from persisted-document recognition. The
composition dispatches `ps:` and `ix:` conflict documents to Customisation
Sync and `i:` conflict documents to Hidden File Sync. Existing documents remain
recognisable after a local mode changes.

The composition adapts the contexts to the existing Commonlib handler
contracts:

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
also exposes an explicitly internal `testing` view for maintained real-Obsidian
contract tests. That test seam is not a production service locator and should
not be used by application features.

## Lifecycle and disposal

The composition is created after the Service Hub and required ServiceModules
exist, and before lifecycle-driven feature work begins. Each context creates
its own queues, caches, semaphores, activity state, and periodic processor.

On application unload, `useOptionalFileSync` first removes every Service
handler registration. It then disposes Customisation Sync followed by Hidden
File Sync, preserving the former compatibility order. Disposal disables
periodic admission, terminates queues, clears transient caches and pending
sets, cancels scheduled notification work, resets compatibility telemetry, and
hides owned Notices. The two presentation serviceFeatures independently remove
their commands, event subscriptions, ribbon state, and dialogue instances.

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

Focused unit tests cover routing, handler aggregation, context state
isolation, teardown, initial cache selection, exact-revision repair, conflict
dialogue adaptation, grouped Notices, and compatibility activity publication.
The boundary test prevents either domain context from regaining core or
Obsidian dependencies.

Changes to local routing or transfer require the maintained Customisation Sync
and Hidden File Sync real-Obsidian workflows. A composition change also
requires the mixed-ownership case which proves that one local path is not
written by both contexts.
