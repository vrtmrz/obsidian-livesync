---
date: 2026-11-12
commonlib-version: "0.4.3"
self-hosted-livesync-version: "1.0.49"
status: implemented
---

# File path index and watched CLI file names

## Status and purpose

This is an implementation design for [#1346](https://github.com/vrtmrz/obsidian-livesync/issues/1346), reviewed against Self-hosted LiveSync `78ebc2d298c39df0ce2be3a4e62059cd74be86a0`, Commonlib `0.4.3`, and the CLI's resolved `chokidar` `6.0.0`. This implementation is included in Self-hosted LiveSync `1.0.50`. The version fields identify the reviewed baseline, not a release containing this change.

The Commonlib portion is published in [0.5.0](https://github.com/vrtmrz/livesync-commonlib/releases/tag/0.5.0), and the consumer pins that exact registry version. Clean-install checks, unit tests, and plug-in and application builds have passed against that artefact.

The CLI should maintain its file-name inventory while running as a daemon. A shared in-memory `FilePathIndex` should group equivalent paths and accept incremental membership changes. Ordinary content edits should neither enumerate the whole Vault nor rebuild its identity map.

In the reviewed baseline, Commonlib caches the collision map by `totalStorageFileEventCount`, path-normalisation version, and effective case policy. A changed event count makes `targetFilter` obtain and sort all names again. `ServiceFileAccessBase.getFileNames()` obtains those names through `getFiles()`, which performs a recursive directory scan and metadata reads in the CLI. Obsidian supplies its in-memory Vault listing instead. The issue is the cost of maintaining the lookup, while collision rejection remains required.

A baseline experiment with 40 files and five directories, including the root, found one full enumeration and 45 adapter `stat` or `statResolved` calls after a content-only event. Repeated checks at the same event count reused the map. All four Legacy/NFC and case-policy combinations took this path. These are adapter-operation counts, not OS syscall counts or an end-to-end daemon benchmark. The issue's reported syscall reduction combines the reporter's local collision-check change with [#1347](https://github.com/vrtmrz/obsidian-livesync/pull/1347); it does not measure either change separately.

## Required behaviour and scope

1. Preserve original path spelling, the existing NFC-then-case comparison rules, and all colliding file candidates. Never choose the first alias or merge their contents.
2. Update membership for creates, deletes, and renames. A content-only change leaves membership and identity buckets unchanged. Repeated notifications are idempotent.
3. Keep name observation independent of whether synchronisation accepts, ignores, batches, or completes an event. A file rejected for a collision must remain visible to subsequent collision checks.
4. Preserve the supported listing boundary, physical-path validation, and host-specific ambiguity rules. Name indexing does not grant support for previously unsupported paths or filesystem aliases.
5. Preserve current metadata freshness for `getFiles()`, `stat()`, and individual file lookups. A name index contains no file contents or cached size/mtime claims.
6. Preserve fresh whole-Vault collision preflight before destructive reconstruction. Watcher readiness alone is insufficient evidence for that preflight.
7. Make initialisation, failed enumeration, stopped observation, and disposal explicit. An unavailable inventory is never an empty successful inventory.
8. Keep the index local to one host instance and Vault root. Recreate it after restart; add no on-disk database, migration, background periodic scan, or remote protocol feature.

The implementation covers the Commonlib contract, CLI daemon adoption, and Obsidian adaptation. Other hosts retain their current listing implementation through a compatibility fallback. It does not expand WebApp NFC support, implement folder-rename synchronisation, change database identity settings, or fix an independently growing unfinished-operation queue. Indexing a folder rename correctly is necessary even where synchronising that rename remains unsupported.

## Ownership and existing components

| Owner | Responsibility |
| --- | --- |
| Commonlib `FilePathIndex` | Original file-path membership and identity-key buckets; synchronous atomic replacement and deltas; deterministic candidate lookup. |
| Commonlib storage interfaces and base adapters | A narrow name-query contract, compatibility fallback, and target-filter integration. |
| CLI `CLIFileNameSource` | Inventory observation, initial population, current-directory reconciliation, physical-path safeguards, and source lifecycle. |
| CLI composition | One watcher owner, explicit injection into file access and event delivery, and shutdown ordering. |
| Obsidian name source | Seed and update from the existing Vault API; dispose its own event subscriptions. |
| Existing file access and resolver | Fresh metadata and content I/O, path resolution, and operation-specific read/write checks. |

Keep the shared class in Commonlib and export it through `/storage`. Reuse `FilePath`, `PathComparisonSettings`, and `getStoragePathComparisonKey`; effective case policy includes the host's existing case-insensitivity decision. Do not infer that policy from the operating-system name. Reuse the CLI's existing Node storage reader and strict NFC resolver. The resolver accepts NFC mode only and cannot replace Legacy traversal through several case-equivalent directories.

The index expresses LiveSync path identity and belongs in Commonlib under the [package-boundary ADR](../adr/2026_07_common_library_package_boundary.md). `Set` and `Map` are sufficient data structures; no new utility dependency is needed. Host instances own the index and watcher lifetime, consistent with Commonlib's [storage-path design](https://github.com/vrtmrz/livesync-commonlib/blob/0.4.3/docs/design_docs/storage_path_resolution.md). Fancy Kit's [runtime composition guide](https://github.com/vrtmrz/fancy-kit/blob/main/docs/runtime-composition.md) keeps acquisition and cleanup policy with that owner. The installed `octagonal-wheels` `0.1.56` memoisation and volatile-cache helpers do not provide incremental identity buckets or authoritative inventory membership; retain explicit `Set`/`Map` state rather than using an evictable cache for either responsibility.

## Shared index

The shared public operations are:

```ts
interface FilePathDelta {
    readonly removed: readonly FilePath[];
    readonly added: readonly FilePath[];
}

declare class FilePathIndex {
    replaceAll(paths: Iterable<FilePath>): void;
    apply(delta: FilePathDelta): void;
    getFileNames(): FilePath[];
    findPathIdentityCandidates(
        path: FilePath,
        policy: PathComparisonSettings
    ): readonly FilePath[];
}
```

These signatures describe the API introduced in Commonlib `0.5.0`; they are not available from the reviewed `0.4.3` baseline. The class performs no I/O, subscribes to no events, and owns no promises or settings service. An empty instance is a valid empty *data structure*; its host owner determines whether it is ready to answer storage queries.

Retain a `Set<FilePath>` of original paths. Lazily construct identity buckets for an explicit comparison policy. There are at most four supported policies: Legacy/NFC crossed with case-sensitive/case-insensitive handling. Cache only those four possibilities, and update every materialised policy map when membership changes. Reject unsupported policy values before modifying or querying state.

For each policy, map its storage comparison key to a set of original paths. `apply` validates its complete input against the shared path contract, removes old memberships, and adds new memberships synchronously. Host enumeration remains responsible for its supported-path rules; the index must not introduce a stricter parser or normalise original spelling. It publishes no intermediate rename state and changes nothing for duplicate adds or absent removes. Empty buckets are removed. A same-path remove/add is a no-op when the path already exists; when it is absent, the add establishes membership.

`replaceAll` builds a candidate state and publishes it only after validation succeeds. A failed replacement leaves the previous data structure intact, while the host can still mark that structure unavailable. Returning arrays must not expose internal mutable sets. Candidate results are sorted using the same string ordering as the current diagnostic, so logs retain every matching original path. The full inventory does not need to be sorted for each candidate query.

A file rename is one delta. A folder rename is expanded by its host into affected original file paths and applied as one delta. The first implementation may find those paths by a prefix scan of the in-memory set; it must use a path-segment boundary, so `notes/` does not match `notes-old/`. A trie is unnecessary unless measurements show that folder operations justify it.

Changing comparison settings creates or selects the appropriate policy map from the existing original paths. It never changes the paths, physical files, or Metadata document IDs. Pending settings continue to follow the existing activation rules.

## Storage-query boundary

Add a `FileNameLookup` capability at the existing file-system adapter boundary and forward it through `FileAccessBase` and `ServiceFileAccessBase`:

```ts
interface FileNameReadOptions {
    readonly fresh?: boolean;
}

interface FileNameLookup {
    getFileNames(options?: FileNameReadOptions): Promise<FilePath[]>;
    findPathIdentityCandidates(
        path: FilePath,
        policy: PathComparisonSettings
    ): Promise<readonly FilePath[]>;
}
```

The adapter capability is optional for existing hosts. The storage-access base supplies the required `StorageAccess` methods regardless of whether a host implements the capability. Existing callers of `getFileNames()` remain valid. A direct external implementation of `StorageAccess` must implement the new candidate query when adopting the new package; document this pre-1.0 interface change and exercise a packed consumer.

`fresh: true` bypasses the new name index and candidate cache and invokes the host's supported listing authority again. For the CLI this is a new physical enumeration; for Obsidian it is the current Vault API. A non-indexed host retains the freshness guarantees of its existing `getFiles()` implementation: for example, this option alone does not make the WebApp FSAPI cache a fresh disk enumeration. Callers cannot use the option to bypass path validation or broaden the listing scope. The CLI and Obsidian reconstruction guarantees remain host-specific.

`targetFilter` computes one explicit policy snapshot and asks for candidate paths. More than one candidate retains the current collision log and returns `false`. Zero or one candidate retains the current acceptance result. Preserve `skipCaseCollisionCheck` for its existing narrowly defined callers. The filter no longer owns a full-name map or depends on the cumulative file-event count to invalidate one.

For a host without the new capability, `getFileNames()` continues to call the existing `getFiles()` and extract its paths. Only the fallback candidate map is cached, keyed by `(totalStorageFileEventCount, pathNormalizationVersion, effective case policy)`. Do not cache a failed computation. Place that policy in `ServiceFileAccessBase`, which already has the file-processing dependency; keep the lower `FileAccessBase` forwarding layer independent of event counters. A fresh read also invalidates the fallback candidate map. This avoids forcing new watchers into WebApp or changing its listing contract. The fallback and indexed path must return the same candidate sets for the same supported listing and policy.

`getFiles()` continues to perform its established metadata enumeration. `getFileNames()` can use the name source without first creating a `NodeFile` and reading its metadata. Reconstruction preflight explicitly requests `getFileNames({ fresh: true })`; it must not accidentally inherit the daemon's cached view.

The explicit bulk action which resolves every conflicted file by its newest revision also requests `getFileNames({ fresh: true })` before choosing its workset. A listing failure aborts before any revision deletion. Diagnostic existence hints, file choosers, and inspection candidate lists use the normal supported view; their per-entry reads establish the state needed for subsequent actions. Neither view reserves the listed paths against later external changes.

## CLI observation and supported names

`CLIFileNameSource.ts` retains the public facade, lifecycle, captured read boundaries,
local-mutation tracking, and inventory publication queue. Its private sidecars keep
observation and storage rules separate:

- `CLIFileNameSource.watch.ts` owns the native watcher and startup sync-delivery buffer.
- `CLIFileNameSource.inventory.ts` reads supported names and validates comparison policies.
- `CLIFileNameSource.reconciliation.ts` stages directory deltas, checks generations, and commits them.
- `CLIFileNameSource.state.ts` defines their state contracts and pure value operations.

Sidecars receive narrow ports rather than the facade or Service Hub. Inventory
operations can prepare a private candidate before the source is ready, while the
source retains the decision to publish it. Sync callbacks run outside the inventory
queue because they can query names again.

Inventory reading and reconciliation use named module-level operations with explicit
state inputs and per-operation dependency types. Each type lists the required ports,
including those needed by helper calls; storage and reader ports expose only the
methods used by that operation. Factories bind these operations to the existing
interfaces without adding private mutable state. Direct unit tests provide the
minimal ports to exercise listing failures, policy validation, staged publication,
and generation changes without constructing a watcher or the public source.

The source selects the comparison policy before entering reconciliation. Internal
operations consume `state.policy`, so the read and its validation use one policy.
Publication checks reject superseded transitions, acknowledgement checks preserve
newer notifications, and the source checks the complete target branch set before
returning candidates. These generation checks protect different boundaries.
Strict NFC initial enumeration belongs to the inventory reader; reconciliation updates
existing coverage and retains failures for its owner to handle. Legacy enumeration
retains its existing diagnosed skips and partial-listing behaviour.

Directory reads distinguish raw Legacy entries from NFC resolver-validated
`StorageEntry` values. Scanner and membership updates retain each validated
`StoragePath` through index insertion. Raw directory names remain available for
later policy validation, including invalid Legacy names excluded from membership.
Legacy parsing stays lazy during full traversal and diagnoses only newly excluded
file names during delta staging. This preserves diagnostic order and original
physical spelling without adding another inventory cache.

Create one `CLIFileNameSource` in CLI composition and inject its read view into file access. It owns the existing chokidar instance; the event-manager watch adapter borrows event delivery from it. Constructors bind dependencies but perform no I/O. File access, the name source, and the existing resolver use the same configured Node storage boundary and root.

Observation has two consumers: inventory maintenance and synchronisation event delivery. Update or invalidate the inventory before applying synchronisation filters or forwarding an event to `StorageEventManager`. Content-change events can leave membership unchanged, but an unknown changed path requires reconciliation rather than assuming that its create notification was seen.

The current watcher's exclusion patterns are not a specification for the inventory: the watcher applies custom ignore rules and excludes paths which the current `getFiles()` listing can still inspect. Keep *enumeration exclusions* separate from *synchronisation exclusions*. The observation source must cover every directory needed by the supported name listing. Apply the shared `isIgnoredFilePath` policy, including custom ignore rules,
`--include-db-like-dirs`, and configured database protection, only to synchronisation
delivery after inventory invalidation. Pass `CLIPathFilterOptions` from
`CLIServiceModules` through `FileAccessCLI` to the source. Ignored names remain
collision candidates. This can increase watched paths; measure watcher resources on a Vault with a large excluded subtree before acceptance.

Keep the existing treatment of hidden directories, hidden leaf files, invalid Legacy paths, symbolic links, and NFC aliases. Use explicit compatibility fixtures to establish that membership agrees with the old enumerator. The source uses `followSymlinks: false`, matching the storage adapter's rejection of descendant symlink paths. The CLI still canonicalises the selected Vault root before composition. An isolated native watcher's ability to observe through a descendant symlink does not establish supported file access. Filesystem notifications are hints to inspect permitted storage paths, not permission to access a path.

The shared index contains files only. The CLI source additionally retains directory-entry information needed to preserve NFC ambiguity checks, including file/directory and parent-directory aliases. This is host validation state, not another identity implementation. Reuse the existing comparison and resolver rules. An already detected ambiguity or incomplete NFC enumeration must not become a successful query by dropping offending entries.

## Readiness and startup

Use one owner-local state with explicit `uninitialised`, `initialising`, `ready`, `failed`, and `closed` variants. Concurrent preparation calls share the same initialisation promise. Failure rejects it; disposal prevents a late enumeration from publishing into a retired source. Store the watcher as soon as it is constructed, so closing during initialisation also closes it and settles its pending `ready` wait. No query waits for synchronisation event delivery to become active.

Register CLI preparation with `appLifecycle.onLoaded`, after all `onSettingLoaded` handlers have finished and before `control.onReady` restores storage events and starts the offline scan. Do not initialise under a constructor-registered `onSettingLoaded` handler: later handlers can still select the Fetch path-normalisation policy. Constructors only connect dependencies. An early name query must either join preparation after configuration is final or reject as unavailable; it must not start under provisional settings. A rejected preparation propagates through loading and the existing unload path.

The preparation and activation sequence is:

1. Start inventory observation with listeners registered, retain the watcher immediately, and wait for its `ready` event. Keep synchronisation delivery gated. Assign an increasing owner-local sequence number to observed invalidations and retain eligible synchronisation notifications in arrival order. This sequence orders work; it is not an identity-map cache key.
2. Enumerate the complete supported initial names and directory-validation state while continuing to collect observations. Build a candidate index privately.
3. Capture the current observation number `B` once. Reconcile the finite set of directories invalidated at or before `B`, then publish the candidate state. Observations after `B` remain pending and do not extend preparation indefinitely. If a directory changes again while being read, retain its later invalidation rather than acknowledging it with the earlier result.
4. Mark name queries ready before storage-event snapshot replay. That replay may call `isTargetFile`; it must not wait for live event activation. Startup scanning continues to obtain current metadata through `getFiles()`.
5. At the existing `onFirstInitialise` / `beginWatch` boundary, attach the synchronisation callbacks and capture a finite delivery boundary. Place buffered notifications through that boundary into the existing delivery path in arrival order, with newer notifications queued behind them. Activation waits for this hand-off, not for every resulting file operation to finish.

The owner serialises inventory publication only. It must not await synchronisation callbacks, `isTargetFile`, or queue completion while holding that serialisation boundary: those operations can query the source again. Synchronisation dispatch runs separately after the inventory has been updated or invalidated. Once activated, it hands each notification directly to the existing callbacks without awaiting downstream processing; no second steady-state synchronisation queue is introduced. Keep observation-time exclusions for host-owned operations and delivery-time admission rules in their existing semantic phases, so buffering does not reinterpret an event using a later processing state.

Do not emit every initial file as a new synchronisation event. Retain the current `ignoreInitial` and content-stability behaviour; the initial full metadata scan handles initial contents. Preserve notifications observed between that scan and activation rather than losing them in a second watcher startup. The temporary activation buffer costs space proportional to observed events; it drains into the existing event manager after activation and is not retained as the name inventory.

## Changes, reconciliation, and local operations

| Observation | Name-source action |
| --- | --- |
| Known file content changes | Leave file membership and identity buckets unchanged. Preserve normal content-event delivery. |
| File added or removed | Reconcile its parent directory and apply the resulting name delta. |
| Directory added, removed, or renamed | Reconcile the affected subtree and replace its file memberships as one delta. |
| Host-owned mutation is attempted | Invalidate the affected directories before I/O. On completion, a dependent name query reconciles them before returning. Later watcher notifications are idempotent. |
| Comparison policy changes | Select or construct the in-memory identity buckets and revalidate the retained directory-entry state under the new policy. Missing validation coverage requires fresh enumeration. |
| NFC enumeration fails or observation becomes unreliable | Retain diagnostic information and invalidate the affected source state; never publish partial NFC coverage as complete. Legacy enumeration retains its established diagnosed skips and partial-listing behaviour. |

Coalesce inventory invalidations by directory; keep sequence numbers only to establish finite read and publication boundaries. Serialise publications by the source owner. A delayed `unlink` must not blindly remove a path which has already been recreated: inspect current directory membership before applying the delta. Likewise, a stale scan must not overwrite a newer local-operation update. Observations arriving during a read schedule a later reconciliation; they are not acknowledged by an older result. Compare the resulting original-name sets and apply only actual additions and removals, so reconciling an unchanged directory does not churn identity buckets.

Put local-mutation invalidation at the CLI's shared storage boundary, covering `write`, `writeBinary`, `append`, `mkdir`, `remove`, and `rename`. Both direct `FileAccessBase.adapter*` / `ensureDirectory` calls and `NodeVaultAdapter` operations must use that same observed storage instance. Hooking only Vault methods misses direct adapter writes, including non-Markdown creation. Use a CLI-owned subclass of the existing `UnicodeResolvingNodeStorageAdapter` for this hook, retaining its resolver methods and `instanceof` compatibility with Vault metadata reads. Delegate actual filesystem operations to that existing implementation; keep host callbacks outside the pure index.

Mark both affected parents, and any affected subtree, dirty before attempting a mutation. Advance their mutation generation at completion, including rejection, so a reconciliation which overlaps the operation cannot certify its old result. Retain dirtiness when physical I/O partially succeeds or when a later metadata lookup fails. Reconciliation must not run inside the storage operation's lock if it needs that lock itself. A subsequent name query waits for an overlapping local operation to settle and then reconciles its captured dirty scope.

Preserve the storage method's own success or failure result. A new index-reconciliation failure must not turn a successful filesystem write into a reported write failure or cause that write to be retried. Record the invalid inventory state and diagnostic; subsequent name queries reject until the affected scope is successfully revalidated. Existing failures from physical I/O or required metadata retrieval keep their existing meaning.

A normal `getFileNames()` captures the current invalidation boundary once, reconciles the finite scopes through that boundary, and returns a copy of the resulting inventory. If concurrent changes prevent safe publication for that captured boundary, the call fails explicitly and retains pending invalidations; it does not wait for the entire Vault to become quiet. It is a watched view, not a fresh physical snapshot. Current-path queries reconcile their relevant branches; discovering an unrelated new subtree schedules its population separately rather than recursively scanning it within every candidate query.

Chokidar currently delays `add` and `change` through `awaitWriteFinish` and combines atomic-save notifications. Preserve synchronisation timing and do not rely on a delayed public event as proof of immediate filesystem membership. `getWatched()` is useful source evidence but is neither a complete storage contract nor an efficient per-file lookup: it copies and sorts the whole watched tree on each call.

## Current-path checks and whole-Vault checks

The index is a maintained view, not an atomic filesystem snapshot. CLI candidate lookup must reconcile the current physical directory chain for the requested path before returning a collision-free result. Read directory names and entry kinds through the existing strict storage reader; do not obtain metadata for every file. In Legacy case-insensitive mode, follow every equivalent parent branch and collect every equivalent file, even if an exact spelling exists. NFC mode retains rejection of ambiguous parent components through the existing resolver.

Follow only parent directories admitted by the supported enumerator. A candidate query must not add descendants of an excluded hidden directory to the inventory. Hidden leaf files retain their existing listing behaviour.

This check also handles missing files, pending creates, delayed deletes, and a collision introduced before its watcher notification. It costs the entries in the relevant directories, not every file in unrelated subtrees. A large flat directory still costs a large directory listing; do not describe the bound as path depth alone. Existing locks and physical write validation remain necessary because a directory read cannot reserve the filesystem against an external writer.

A query fails on a relevant read error; it does not infer absence from a failed read. Known whole-inventory NFC ambiguity or failed coverage remains visible and cannot be bypassed by querying another path. Watch observation cannot guarantee that an unrelated, not-yet-observed directory change is immediately discovered. Whole-Vault validation belongs to explicit fresh enumeration and reconstruction preflight, not a claim attached to every in-memory lookup. This observation limit is a deliberate part of using a watched inventory and must be tested and documented separately from target-path safety.

Directory-validation records carry their original entry names and kinds, validation policy, and mutation generation. Retain a failed directory's previous membership and diagnostic, but do not serve it as validated. A successful read and validation of the same scope clears that failure. A fresh whole enumeration uses the same private-candidate, captured-invalidation, and atomic-publication rules as preparation before replacing all coverage records; it must not overwrite a concurrent local mutation. In NFC mode, every known ambiguity or coverage failure blocks candidate queries until repaired, including a failure outside the requested branch. A repair notification may trigger the scoped revalidation even while queries are blocked.

Until a fresh candidate commits, retain the earliest pending observation sequence for every scope its reconciliation can acknowledge. If the candidate is rejected, restore those observations for the still-published inventory, including readers which captured an earlier boundary. Check local-mutation revision and captured directory generations again after final-policy reconciliation: its asynchronous reads must satisfy the same publication conditions as the initial scan. This temporary record belongs to the fresh operation and adds no persistent state or automatic whole-Vault retry.

Policy changes revalidate retained entry sets, including directory names, under the new policy before publishing that policy as ready. File buckets alone cannot establish physical validity. Reconcile pending observations through a captured boundary first; require fresh enumeration if retained coverage is insufficient. Validation errors belong to their policy and generation: switching settings must neither discard relevant failures nor keep an old-policy failure after the new policy has been validated. Existing path exclusions and diagnosed Legacy enumeration skips remain explicit compatibility cases, rather than being silently reclassified by the common index.

An initial-enumeration failure leaves the source `failed`, closes its newly opened watcher, and aborts loading. A watcher error invalidates the whole source and follows the existing fatal-error policy. Scoped reconciliation errors while observing retain blocked coverage and can recover by a successful read of the same scope; they do not create an automatic whole-Vault retry loop. If observation is deliberately restarted, retire and close the old source, then prepare a new instance from scratch.

Rebuild/Fetch preflight uses a fresh supported listing and the existing local Metadata checks before any reset. Keep its current all-or-nothing NFC enumeration and parent-ambiguity behaviour. An NFC nested-directory read failure therefore fails the fresh preflight before reset. Legacy listing retains its existing diagnostic and partial-listing behaviour; this change does not add all-or-nothing Legacy enumeration. A preflight failure must leave both databases and all files unchanged. Full scanners retain current content/provenance checks; the name index is not proof that a file body has been processed.

## Non-watching commands, suspension, and shutdown

When `watchFiles` is false, the CLI adapter does not provide the indexed `FileNameLookup` capability. Whole-name requests use the existing fresh CLI enumeration, and candidate queries use the base fallback. Queries never start a watcher in this mode. This applies to the current `mirror`, `fetch`, and `rebuild` commands. Do not retain a name snapshot across independent CLI invocations.

Suspending synchronisation must keep its current effect on admission and reflection. Inventory observation performs no database write, and must not restart synchronisation, release a Scram state, or bypass recovery flags. If observation itself is stopped, invalidate its ready state and require fresh enumeration before using it again.

At `onBeforeUnload`, freeze source-to-manager synchronisation delivery, then use the existing manager stop/flush/snapshot sequence. Already dispatched notifications belong to that finite shutdown boundary; later observations do not extend it. There is no steady-state source queue left to feed after manager admission closes. Keep inventory access available while captured operations settle. If shutdown interrupts loading before activation, close and discard the unaccepted startup buffer; the next invocation reconstructs from storage and the existing retained snapshots. At `onUnload`, close the shared watcher and dispose the name source exactly once. Outstanding preparation/reconciliation must reject or settle without publishing after disposal. Preserve the current CLI fatal-watcher-error policy; do not introduce an unbounded in-process retry loop or silently keep serving a stale inventory.

## Obsidian adoption

Create a host-owned name source using `Vault.getFiles()` and Vault create/delete/rename events. Register inventory listeners before seeding, obtain and apply the initial snapshot synchronously within the same JavaScript turn, and update the index before sync-event filtering can query it. Subscribe directly to raw Vault folder events as well as file events: the existing synchronisation forwarder filters out folders. A folder rename expands the old prefix using the retained original paths; folder creation obtains any existing descendants from the Vault, and folder deletion removes retained descendants. Apply each membership change as one delta; duplicated child notifications remain harmless.

Content modification events do not rebuild the name index. Existing Vault file objects continue to supply current metadata. Preserve Obsidian's separate alias guard and its fixed case-insensitive NFC policy; it is not replaced by the configured database-identity policy. Fresh enumeration means the latest Vault listing and does not promise to reveal physical aliases hidden by Obsidian.

Dispose the source's listeners on unload. The source does not own Obsidian's Vault or install another disk watcher.

## Costs and acceptance evidence

Let `N` be the number of supported files, `K` the paths affected by one name change, and `C` the matching candidates. String/key work also depends on path length.

| Operation | Intended cost after initialisation |
| --- | --- |
| Shared index candidate lookup | Expected map lookup plus copying/sorting `C` candidates. |
| Content-only edit | No full-name enumeration and no identity-map rebuild. CLI still performs relevant current-directory checks. |
| Membership delta | Expected work proportional to `K` for each materialised policy, with at most four policies. |
| First shared-index query for a comparison policy | One in-memory pass over `N`. CLI directory validation is separate and may require fresh enumeration if coverage is missing. |
| Complete name list | Reconcile pending captured scopes, then copy `N` paths; an array-returning API cannot be constant-time. |
| Folder operation | At most an in-memory prefix scan plus affected-subtree enumeration; no claim of constant-time directory rename. |
| Fresh whole-Vault validation | Full supported enumeration, intentionally retained. |
| Retained state | Linear in file names and host directory coverage; a temporary startup buffer is proportional to observed events. No persistent index. |

Compare correctness and costs against the same baseline and storage conditions. Warm the source and policy once, then perform content-only edits in a fixture with unrelated subtrees. Count full enumerations, identity-map builds, directory reads, adapter metadata calls, and applied deltas separately. Require zero new full enumerations and zero full identity-map builds for those warmed content edits. Do not claim zero filesystem calls or a particular CPU reduction.

Measure a large flat directory separately from a deep Vault. Repeat the issue's create/delete trace with this change alone and with #1347, and distinguish syscall measurements from adapter counts. The reported CPU usage and sustained writes remain separate hypotheses until reproduced.

## Verification matrix

Add the smallest regression test before production changes and confirm failure against the unmodified implementation for the expected full-scan cause. Fixture, watcher, and permission failures are setup failures.

| Boundary | Required scenarios and assertions |
| --- | --- |
| Pure index | All four policies; NFC/NFD aliases; original spelling; duplicate add/delete; atomic rename delta; policy switches; deterministic complete collision lists; failed replacement leaves old data intact; two independent instances. |
| CLI startup | Initial files are indexed without becoming new sync events; changes during enumeration; snapshot replay before sync activation; final settings precede preparation; continuous events do not prevent readiness; startup failure; concurrent preparation; close before watcher readiness; no deadlock. |
| Watch updates | Create/delete/recreate, temporary-file atomic save, delayed add, duplicate/out-of-order notification, unknown changed path, new populated directory, folder move, and ignored-but-enumerated aliases. |
| Physical checks | An alias exists before its watcher event; exact spelling plus another alias; equivalent parent branches in Legacy mode; ambiguous parent in NFC mode; read failure versus absence; symlink rejection. |
| Whole listing | Same supported membership as the current Legacy/NFC enumerator, including hidden and invalid-name fixtures; known global NFC failure; failed nested NFC read; fresh NFC preflight refuses before reset; existing Legacy diagnosed skips and partial listings; bulk newest-revision resolution uses a fresh workset and aborts before deleting revisions when listing fails; failure clears only after scoped repair; rejected fresh candidates retain observed changes and earlier read boundaries; final-policy reconciliation rejects overlapping local I/O or changed generations; policy switches revalidate parent entries. |
| Metadata and lifecycle | Existing `getFiles()` freshness/concurrent-list tests; direct adapter and Vault writes visible before delayed watcher delivery; partial I/O / metadata / reconciliation failure retains invalidation without replaying a successful write; restart discards the index; stopped/failed watcher cannot supply successful stale queries; non-watching commands exit. |
| Obsidian | Existing Vault listing scope; create/delete/file and folder rename; content edits do not rebuild; fixed-policy alias guard remains; listener cleanup; no disk listing introduced. |
| Fallback and packaging | Non-indexed host retains existing candidate sets and reuse; `skipCaseCollisionCheck`; packed `/storage` export; direct StorageAccess implementor migration; no Node/chokidar import in the common index. |

Run the Commonlib owner tests and packed consumer checks, then LiveSync's required `npm run check`, unit tests, and production build against that exact package. Run focused CLI real-watch/E2E and Obsidian lifecycle/rename/preflight coverage for the boundaries changed. Broad validation is sequential and uses the configured device limits. Design-only work does not establish that these implementation gates have passed.

## Implementation sequence and affected areas

1. Add the Commonlib regression test, shared `FilePathIndex`, package exports, and pure-index tests in the Commonlib repository.
2. Add the name-query interfaces and base fallback; move the existing collision predicate to the narrow query. Change reconstruction preflight to request fresh enumeration. Verify existing hosts and packed consumers before adopting indexed behaviour.
3. Add the CLI name source and split inventory observation from synchronisation activation. Inject the shared owner through `CLIServiceModules`, `FileAccessCLI`, the file-system adapter, and the storage-event adapter. Integrate successful local mutations without changing file-event completion semantics.
4. Add Obsidian's Vault-backed source and preserve its alias guard and lifecycle. Keep non-indexed hosts on the tested fallback.
5. Validate the packed Commonlib artefact and exact downstream dependency, then measure the original daemon scenario. Update the proposal's status and implementation references only when the implementation exists.

Primary LiveSync areas are `src/apps/cli/serviceModules/CLIServiceModules.ts`, `FileAccessCLI.ts`, `ServiceFileAccessImpl.ts`, `src/apps/cli/adapters/NodeFileSystemAdapter.ts`, `NodeVaultAdapter.ts`, the observed CLI storage subclass in `src/apps/cli/storage/ObservedNodeStorageAdapter.ts`, `src/apps/cli/managers/CLIStorageEventManagerAdapter.ts`, `StorageEventManagerCLI.ts`, CLI startup composition, and the corresponding Obsidian adapter/composition files. Commonlib owns `platform/FilePathIndex.ts` (new), storage/file-access interfaces and base classes, `serviceFeatures/targetFilter.ts`, and `serviceModules/Rebuilder.ts`. Exact method placement should follow the existing narrow dependency direction; no local Commonlib source mirror is introduced.

## Alternatives and limits

- Invalidating only on create/delete/rename is a useful reduction, but still performs a full Vault scan for every structural event and requires a complete observation source.
- Rebuilding the map from a watched array removes repeated disk traversal but retains full-array/map work on content edits. It is insufficient for the intended hot path.
- Current-directory lookup alone is a smaller correction and remains useful for freshness checks. It does not provide the shared inventory used by other name-list consumers.
- Using the existing `fileCache` as the complete inventory is incorrect: it contains files discovered by selected lookups and can retain stale entries.
- A persistent index adds recovery and migration state which this derived data does not need. Reconstruct it from the host listing on restart.
- Treating the synchronisation queue as the file inventory excludes rejected/ignored entries and couples name correctness to sync completion. Keep those responsibilities separate.

The principal new risk is a stale or incomplete name view admitting an ambiguous path. Readiness gates, complete candidate sets, current-path checks, fresh reconstruction preflight, and explicit source failures address distinct parts of that risk. They are design requirements, not verified safeguards yet. A missed unrelated watcher notification can delay discovery outside the queried path; no claim of an atomic whole-filesystem snapshot is made. Do not assign a numerical post-fix risk or declare the issue fixed until the relevant behaviour and original scenario have been validated.

## References

- [Unicode path identity design](unicode_path_identity.md) and [ADR](../adr/2026_10_unicode_path_identity.md).
- [Write and reflection paths](file_write_and_reflection_paths.md).
- [Service feature and legacy Module boundaries](service_feature_and_legacy_module_boundaries.md).
- [CLI database continuity](cli_database_continuity.md).
- [Commonlib storage path resolution](https://github.com/vrtmrz/livesync-commonlib/blob/0.4.3/docs/design_docs/storage_path_resolution.md).
- [Commonlib storage events and reflection](https://github.com/vrtmrz/livesync-commonlib/blob/0.4.3/docs/storage-events-and-reflection.md).
