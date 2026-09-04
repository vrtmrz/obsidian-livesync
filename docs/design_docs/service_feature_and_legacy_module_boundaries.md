---
date: 2026-09-04
commonlib-version: "0.1.21"
self-hosted-livesync-version: "1.0.24"
status: accepted
---

# Service feature and legacy Module boundaries

## Purpose

This document guides new Self-hosted LiveSync composition and bounded refactoring of existing application Modules. It supplements Commonlib's [service feature composition guide](https://github.com/vrtmrz/livesync-commonlib/blob/main/docs/service-feature-composition.md) with the risks and migration boundaries specific to `AbstractModule` and `AbstractObsidianModule`.

Existing Modules remain supported application structures. This guidance does not require mechanical conversion of working code. It defines why a new feature should normally use an existing Service handler or a serviceFeature, and when retaining a Module is still appropriate.

## Default decision

For new behaviour:

1. add a handler to an existing Service when that Service already owns the result, priority, and lifecycle;
2. use a serviceFeature when the work composes several Services, ServiceModules, lifecycle events, commands, or host effects;
3. keep feature-local state in a private context, with functions which receive that context;
4. use a ServiceModule only when several consumers need the same long-lived operational capability or resource lifetime; and
5. use a focused class when stable identity, polymorphism, serialised ownership, replacement, `abort()`, `close()`, or `dispose()` is part of the contract.

Do not select `AbstractModule` or `AbstractObsidianModule` merely to obtain convenient access to `LiveSyncBaseCore`, settings, Services, or Obsidian APIs.

## How the legacy Module layer works

`LiveSyncBaseCore` currently composes the application in this order:

1. retain the constructed Service Hub;
2. construct the `ServiceModules` record;
3. construct and register built-in and host-supplied Modules;
4. compose the built-in Commonlib serviceFeatures;
5. compose host-supplied serviceFeatures;
6. construct add-ons;
7. compose the late core serviceFeatures whose handlers must follow host features and add-ons; and
8. call `onBindFunction()` for each registered Module.

The Module constructor therefore runs before its handler bindings, while the complete Service Hub and ServiceModules already exist. `bindModuleFunctions()` then invokes every `onBindFunction()` and runs `__$checkInstanceBinding()`. That diagnostic compares underscore-prefixed prototype methods with method references found in the source text of `onBindFunction()`.

This is a compatibility lifecycle. A serviceFeature does not need to wait for Module binding. It can consume the already constructed Services and ServiceModules directly.

## Why new code should avoid `AbstractModule`

### Dependencies are broader than the type signature

An `AbstractModule` constructor receives `LiveSyncBaseCore`. Through that one object, a subclass can reach:

- the complete Service Hub;
- every ServiceModule;
- the active local database;
- settings and setting persistence;
- application commands, views, ribbon icons, and protocol handlers; and
- path, readiness, logging, and test helpers.

A reader cannot determine the real dependency set from the constructor or class declaration. A serviceFeature using `NecessaryServices` makes that set visible and compiler-checked.

### Initialisation is split across construction and binding

Module fields can dereference `this.services` during class field initialisation, while public behaviour is registered later in `onBindFunction()`. Correctness consequently depends on both the host construction order and a second binding phase.

This permits states which are difficult to express in a type:

- the class exists but its handlers are not registered;
- a field has captured a Service before the intended lifecycle point;
- a method passed as a callback has lost its receiver; or
- a test invokes `onBindFunction()` against a partial object which could not occur through ordinary composition.

### Callback safety is checked at runtime

Legacy Modules commonly register `this.method.bind(this)`. `__$checkInstanceBinding()` can report an underscore-prefixed method which is not referenced by `onBindFunction()`, but it does not type-check the registration or prove that a callback retains its receiver. A module-level function receiving an explicit context does not have a receiver to lose.

### Registry and ordering dependencies remain implicit

Modules are stored in one runtime list. Construction order, binding order, `getModule()`, and subclass identity can become hidden dependencies. A serviceFeature is called at the composition root and returns only an intentionally retained view, so its consumers do not need a general Module locator.

### Resource ownership is not part of the base contract

`AbstractModule` has no standard replacement, cancellation, or disposal contract. Individual Modules can register `onUnload` handlers, but accepting the core does not state which object owns a queue, remote handle, room, timer, or in-flight operation.

Use a focused owner when the resource lifetime is meaningful, then compose that owner through a serviceFeature. The owner should expose the smallest necessary `abort()`, `close()`, `dispose()`, or view contract.

### Tests inherit unrelated application structure

Current Module tests sometimes call a prototype method with manually assembled objects:

```typescript
ModuleReplicator.prototype.onBindFunction.call(module, {} as never, services as never);
```

Other tests construct a broad fake core so that the base class can expose one or two collaborators. These tests can verify behaviour, but the fixture cost obscures the actual interaction contract and makes unrelated Service changes more likely to affect them.

When a focused London School test requires a broad core fixture, repeated `as never`, deep mock chains, or manual prototype invocation, treat that friction as a design-review signal.

## Why `AbstractObsidianModule` is a more restrictive boundary

`AbstractObsidianModule` adds direct access to the plug-in and `app` on top of the complete core. This is useful for existing Obsidian-owned integration, but it combines platform policy, application composition, and domain behaviour in one inheritance boundary.

For new behaviour, keep Obsidian-specific presentation or registration in an Obsidian-owned serviceFeature. Pass host-neutral operations or focused views into that feature. This permits the CLI, WebApp, WebPeer, and unit tests to reuse the operation without constructing an Obsidian plug-in.

## Current examples

### A small serviceFeature: language initialisation

`src/serviceFeatures/onLayoutReady/enablei18n.ts` declares only `setting`, `API`, and `appLifecycle`:

```typescript
export const enableI18nFeature = createServiceFeature(async ({ services: { setting, API, appLifecycle } }) => {
    // Apply the language, persist a change, and register unload clean-up.
});
```

The local `ObsidianLanguageAppliedNotice` class is still appropriate. It owns one replaceable Obsidian `Notice` and has an explicit `clear()` lifetime operation. The class is not used as a service locator, and the serviceFeature owns its construction and host binding.

### Operation and composition: database preparation

Commonlib's `prepareDatabaseForUse()` is independently callable and receives explicit collaborators. `usePrepareDatabaseForUse()` constructs the error manager and registers the operation with `databaseEvents.initialiseDatabase`.

This split allows tests to verify:

- database opening before scanning;
- short-circuiting after a failed step;
- completion handlers before pending-event commitment;
- readiness only after every required step; and
- registration of the composed operation.

The operation does not need an application Module identity.

### Ordered start-up composition and registration-only features

Configured Vault admission and the checks which follow database preparation are composed by `src/serviceFeatures/startupLifecycle/`. The directory keeps onboarding admission, compromised-chunk inspection, incomplete-document repair, Config Doctor, and the obsolete bulk-send setting migration as separate operations. One feature composer owns their order and receives the compatibility-review wait operation explicitly; an individual operation does not call the composer.

The layout-ready admission handler uses priority 1. This preserves ordinary priority-0 host integration before admission, while keeping an unconfigured Vault outside the flag-file recovery handlers at priorities 5, 10, and 20, and the compatibility review at priority 30. Admission belongs to one plug-in process: an initially unconfigured process remains inert until setup restarts it, and declining the requested restart does not trigger an in-process reconfiguration. Changing an admitted process back to unconfigured retires its Config Doctor and incomplete-document repair request handlers. The handlers also recheck the current configured state and database readiness when invoked, so a pending restart cannot expose partially initialised or retired state. The first-initialise handler rechecks admission before retaining the established order after the file watcher has been started: database readiness, compromised chunks, incomplete documents, compatibility review, Config Doctor, and the bulk-send setting migration.

Command and ribbon registration are serviceFeatures for the same dependency-visibility reason, but they are not start-up migrations. The basic commands remain a host-neutral feature composed by `LiveSyncBaseCore`, while the replication ribbon remains an Obsidian-only feature composed by the Obsidian host. Both retain `onInitialise` registration so moving them out of the Module list does not make their effects run during construction.

### Private state and ordered handlers: target filters

Commonlib's `targetFilter.ts` keeps each cache or readiness gate in the factory which owns one predicate. `useTargetFilters()` constructs those predicates and registers them in their required order.

The state remains private to the composed feature. It does not become a `LiveSyncBaseCore` property or a ServiceModule merely because it persists across calls.

### Implemented composition: conflict resolution

Conflict checking and resolution are composed for every host by `useConflictResolutionFeature`. The feature owns its `QueueProcessor` privately and registers the conflict Service handlers directly. Its operations receive explicit collaborators for settings, active-file state, database and storage access, replication, logging, and host events. No consumer locates a conflict Module or retains the queue.

The scheduling queue remains one state owner. It publishes `conflictProcessQueueCount`, coalesces pending checks for the same path, and makes `ensureAllProcessed()` wait for conflict resolution to finish. Repeated resolver invocations for one path retain only the newest waiting request and close an active comparison for that path before waiting for the per-file resolver, while comparisons for other paths remain open. Resolution remains host-neutral and communicates dialogue cancellation through `services.context.events`, so CLI, WebApp, and Obsidian compositions use their own selected event channel.

Interactive resolution is a separate Obsidian-owned serviceFeature. It registers the manual conflict handler, commands, start-up scan, unresolved-message contribution, cancellation listener, and unload clean-up. Its postponed-conflict set, active dialogue, and dialogue queue are private, session-local state. Manual comparisons are shown one at a time: a request for the active file publishes `EVENT_CONFLICT_CANCELLED` to cancel and replace its dialogue, while a request for another file waits. A resolution received through replication closes an open dialogue for the resolved path through the same event, or discards its waiting request before a stale dialogue can open. On unload, the feature drops waiting requests and publishes the same event for the active path before the host event channel is retired, so the dialogue closes and its waiting operation completes. The feature receives a dialogue-opening adapter and connects to the common feature only through the conflict Service; it does not expose an Obsidian application or dialogue as a general capability.

Both operation layers acquire the active local database through an operation-time accessor. Composition occurs before the database is opened, and a reset may replace the active instance, so retaining the database object at composition time would violate both start-up and reset boundaries.

`ConflictResolveModal` remains a focused class. One instance owns one dialogue's result promise, event subscription, and close lifetime, which is stable identity and resource ownership rather than application composition. This preserves the distinction between a useful object lifetime and a legacy Module used as a service locator.

## Interaction-based testing

Test a serviceFeature at two levels.

First, test the operation or state owner with narrow collaborators:

```typescript
it("does not enqueue after an optional resolver completes the conflict", async () => {
    const enqueue = vi.fn();
    const resolveOptionally = vi.fn(async () => true);

    await queueConflictCheck(contextWith({ enqueue }), dependenciesWith({ resolveOptionally }), path);

    expect(resolveOptionally).toHaveBeenCalledWith(path);
    expect(enqueue).not.toHaveBeenCalled();
});
```

Second, test the composition:

```typescript
it("registers conflict checking with the conflict Service", () => {
    const setHandler = vi.fn();

    useConflictChecking(makeHost({ setHandler }));

    expect(setHandler).toHaveBeenCalledOnce();
    expect(setHandler).toHaveBeenCalledWith(expect.any(Function));
});
```

The test should make the interaction contract legible: which collaborator is called, in which order, what result is returned, and what must not run after a failure.

Do not expose a private constructor, publish a broad mock, or attach a context to `LiveSyncBaseCore` solely to make a test possible. If the narrow test cannot be written cleanly, reconsider the responsibility split.

## When retaining a Module is appropriate

Retain or extend an existing Module when the current change depends on its established:

- Module identity or `getModule()` lookup;
- binding order with neighbouring legacy Modules;
- Obsidian plug-in lifecycle integration;
- user interface object lifetime; or
- compatibility behaviour whose extraction would materially expand the change.

Even then, new domain operations can receive explicit dependencies instead of accepting the Module or complete core. Improve the affected ownership boundary without converting unrelated neighbours.

## Migration approach

When a Module is already in scope:

1. name the behaviour being changed and the state or resource which owns it;
2. identify the smallest operation which can accept explicit dependencies;
3. add a focused regression or interaction test around that operation;
4. keep host-specific registration in the Module initially, if that is the smallest safe step;
5. move registration to a serviceFeature only when the current integration can do so without changing ordering or lifetime; and
6. remove the legacy Module only when no identity, lookup, ordering, or compatibility consumer remains.

This is an incremental boundary change, not an inheritance-removal campaign.

## Review checklist

Before adding or changing application composition, confirm that:

- dependencies are visible in a function, context, or constructor type;
- mutable state has one named owner;
- shared state is not promoted to a ServiceModule without multiple consumers;
- external resources have explicit replacement and disposal semantics;
- host-specific UI remains outside host-neutral operations;
- a consumer receives a focused view rather than the complete core;
- handler ordering and failure short-circuiting are tested; and
- retaining a legacy Module is an explicit compatibility decision.
