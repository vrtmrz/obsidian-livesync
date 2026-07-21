# Architectural Decision Record: Package the Common Library Behind Explicit Host Boundaries

## Status

Proposed — the implementation proof is complete, `@vrtmrz/livesync-commonlib@0.1.0-rc.2` has been published and verified as the exact downstream dependency, and the Community directory scanner preview confirms the intended package boundary.

## Context

Self-hosted LiveSync currently consumes `livesync-commonlib` as the `src/lib` Git submodule. TypeScript, Vite, Vitest, the CLI, Webapp, and WebPeer resolve `@lib/*` directly to the submodule's TypeScript source. The common-library repository has no package manifest, standalone build, export map, or self-contained test command. Its tests and dependency versions are consequently supplied by the Self-hosted LiveSync repository.

Source archives do not populate a Git submodule. Self-hosted LiveSync therefore also commits generated declarations under `_types` and resolves `@lib/*` to those declarations as a fallback. This makes one logical dependency appear in the plug-in repository twice: once as a submodule checkout and once as generated declarations. Release preparation must regenerate and commit the fallback, and repository scanners can report generated lint directives as if they were maintained plug-in source.

The Obsidian community scanner currently inspects repository source beyond the plug-in entry point. Reports include `src/apps/cli`, `src/apps/webapp`, `src/apps/webpeer`, and generated `_types`. Moving the common library from `src/lib` to another source directory or a workspace package inside the Self-hosted LiveSync repository would therefore preserve the scan surface. It could remove the submodule fallback, but it would not create the same dependency boundary as consuming a published npm package.

The common library is already a substantial shared domain layer. At the time of this decision it contains 270 non-test TypeScript or Svelte source files. At Self-hosted LiveSync revision `e114f66fb2b7c6f3fec2d53701f6638d2557e606`, source outside `src/lib` uses 180 distinct raw `@lib/*` specifiers across plug-in, application, and test source. Normalising optional TypeScript source suffixes leaves 140 migration paths. The plug-in contributes most of those imports, but the CLI, Webapp, and WebPeer also depend on the library. Treating every existing deep path as a permanent public API would make future refactoring impractical.

The intended external use is not new:

- [commonlib issue #1](https://github.com/vrtmrz/livesync-commonlib/issues/1) has requested an npm package and an established API since 2022;
- [Self-hosted LiveSync issue #87](https://github.com/vrtmrz/obsidian-livesync/issues/87) asks for a client with list, get, submit, and delete operations;
- [commonlib issue #10](https://github.com/vrtmrz/livesync-commonlib/issues/10) asks for an API which lets another application add Markdown files to the CouchDB data model; and
- [commonlib issue #13](https://github.com/vrtmrz/livesync-commonlib/issues/13) records the integration cost of consuming a Git submodule and compiling its source.

Existing external consumers use custom TypeScript aliases, loaders, and host stubs to reach `DirectFileManipulator` and other deep modules. The present source shape therefore imposes real integration work without supplying a stable contract.

The library is close to being self-contained, but it crosses its boundary in a small number of important places:

- four files depend on Self-hosted LiveSync's event hub or event identifiers;
- `KeyValueDBService` imports the host's concrete database-opening function;
- `ObsidianServiceContext` imports the plug-in class and Obsidian types from the parent repository; and
- `coreEnvFunctions` imports an Obsidian function type even though the module is intended to be host-neutral.

The library also mixes domain logic with host presentation:

- Svelte dialogue mounting depends on Svelte, LiveSync service context, application-lifecycle events, translation, and cancellation policy in one implementation;
- Obsidian context and setup helpers remain below the common-library directory;
- browser dialogue shims and LiveSync Svelte components are shipped alongside headless replication code; and
- the translation implementation statically imports the complete generated catalogue. The generated message modules and JSON catalogues account for approximately 1.5 MB of source and generated data, even when a headless consumer does not require them.

The root `src/index.ts` currently exports only `DirectFileManipulator` and its options. `DirectFileManipulator` is useful evidence for a future SDK, but it is not yet a sufficient stable façade: initialisation starts from its constructor, enumeration remains unfinished, watch ownership and failure semantics are not documented, and conflict and concurrency semantics are not defined as a public guarantee.

The present process model also assumes one main LiveSync instance. Event dispatch, translation state, environment configuration, offline-scan state, worker pools, synchronisation-parameter handlers, diagnostic counters, and some compatibility caches are module-scoped. Some of these are safe process-wide facilities, while others can allow two client instances to influence each other. Publishing a package makes concurrent clients in one process a supported possibility, so this state must be classified rather than carried across accidentally.

## Decision

Maintain `livesync-commonlib` as the authoritative independent repository and publish its compiled output as the scoped, pre-1.0 npm package `@vrtmrz/livesync-commonlib`.

Self-hosted LiveSync, its CLI, Webapp, WebPeer, and external tools will consume the compiled package and declarations through package export maps. They must not compile the common library's source through a path alias. The package lock records the exact resolved artefact used to build a plug-in release.

The common-library repository may become a small workspace if independently useful artefacts emerge, but it does not move into the Fancy Kit repository or the Self-hosted LiveSync plug-in repository. This preserves its domain ownership, existing history, issues, and independent release cadence while making the plug-in repository a package consumer.

The first package release is an infrastructure and compatibility release, not a declaration that every internal service is stable. It exposes:

- a small documented root API;
- named, task-oriented public subpaths;
- explicitly marked compatibility subpaths required to migrate current Self-hosted LiveSync imports; and
- no unrestricted source-directory wildcard as a permanent contract.

Compatibility subpaths may be exported during the migration, but they remain pre-1.0 and are documented as internal. New external integrations should use the high-level client façade rather than reproduce Self-hosted LiveSync's internal Service Hub composition.

### Domain ownership

The common library continues to own behaviour which defines the Self-hosted LiveSync data and synchronisation model:

- document, metadata, chunk, setting, and protocol types;
- path and identifier encoding;
- chunk splitting, hashing, compression, encryption, and content reconstruction;
- PouchDB-facing data access and replication primitives;
- CouchDB, Object Storage, and P2P replication domain logic;
- conflict, chunk-delivery, storage-event, and replication managers;
- platform-neutral storage and service contracts;
- headless composition; and
- the future high-level client façade.

The Self-hosted LiveSync repository owns plug-in and product integration:

- `ObsidianServiceContext` and every reference to the plug-in class, `App`, `Plugin`, or Obsidian lifecycle;
- Setup Wizard components and LiveSync-specific presentation policy;
- Obsidian menus, notices, settings panes, and dialogue composition;
- plug-in event wiring which is not part of the replication protocol; and
- the concrete initialisation of injected environment, translation, storage, key-value database, and UI capabilities.

Browser-only implementations may remain in the common-library repository only when they implement a documented host-neutral contract used by more than one browser consumer. LiveSync-specific Webapp and WebPeer composition remains application code even if it later moves out of the plug-in repository.

Neutral utilities which do not express LiveSync data, storage, replication, or UI policy may move to `octagonal-wheels` after more than one consumer proves the abstraction. Reusable Obsidian adapters may move to `@vrtmrz/obsidian-plugin-kit`. Neither package becomes an owner of LiveSync domain behaviour.

### Dependency inversion

The package must contain no `@/` import and no direct Obsidian import. The current reverse dependencies are removed as follows:

- common protocol and service events live with their common-library contracts;
- host-only event reactions are registered by Self-hosted LiveSync at its composition root;
- `KeyValueDBService` receives an `openKeyValueDatabase` factory through constructor or service dependencies;
- `ObsidianServiceContext` moves to Self-hosted LiveSync;
- the language getter uses a local function type rather than importing the Obsidian declaration; and
- browser globals, fetch, crypto, timers, storage, and document access are obtained through explicit host capabilities where behaviour varies by runtime.

Temporary package-level configuration is acceptable where converting every call site in one change would be unsafe, but configuration must be instance-scoped wherever multiple clients can coexist. Importing the package must not patch `HTMLElement`, `SVGElement`, or another global prototype. Webapp compatibility patches belong in Webapp bootstrap code.

Every mutable module-level value is classified as one of:

- immutable or safely shared process infrastructure;
- an explicitly keyed cache with bounded ownership and disposal; or
- client state which moves behind an instance-owned service or dependency.

In particular, event subscriptions, translation selection, offline-scan maps and timers, synchronisation-parameter handlers, and database transformation policy must not leak between independent client instances. A high-level client owns an explicit asynchronous disposal path which removes subscriptions, cancels work it owns, and releases its instance state.

### Translation resources

Translation lookup is separated from the generated catalogue. Core services receive a narrow translator capability, or a service-context equivalent, instead of importing a process-global `$msg` implementation which statically owns every language.

The first migration keeps language resources in the common-library repository and exposes them temporarily through the focused compatibility subpath `@vrtmrz/livesync-commonlib/compat/common/i18n`. Importing the root or `context` entry does not load the catalogue. Self-hosted LiveSync imports the catalogue and installs the translator at its composition root. A dedicated language subpath remains the preferred stable replacement once its contract has been narrowed.

This is initially one versioned npm package rather than two independently versioned packages. Message identifiers and their generated catalogue change together, so an immediate package split would add version coordination before the dependency direction is proven. A later `@vrtmrz/livesync-language` package is permitted when independent use or release cadence justifies it. Its dependency must point towards message contracts or core, never from core towards the catalogue.

### Svelte dialogue hosting

The present Svelte dialogue implementation is split into three responsibilities:

1. an Obsidian `Modal` host which owns content, title, close, one-shot settlement, and disposal;
2. a Svelte adapter which mounts and unmounts a component in that host; and
3. Self-hosted LiveSync policy which supplies service context, reacts to plug-in unload, requires explicit cancellation in selected workflows, translates messages, and styles Setup Wizard content.

Fancy Kit is an appropriate owner for the first responsibility when the contract is useful beyond this migration. The Kit API should be framework-neutral: it accepts a mount callback, exposes typed `resolve`, `cancel`, `close`, and `setTitle` controls, and accepts a disposer returned by the callback. It returns a `Promise<TResult | null>` which settles once, and it owns safe-area, viewport, focus, and Obsidian Modal lifecycle guarantees.

Fancy Kit does not add Svelte to its core dependencies for this migration. Self-hosted LiveSync initially owns the small Svelte adapter which calls Svelte's `mount` and `unmount` through the framework-neutral host. The browser dialogue host also remains outside the Obsidian plug-in kit. If a second Obsidian plug-in needs the same Svelte adapter, it can be promoted to an optional Kit subpath with an optional Svelte peer dependency, or to a separate `@vrtmrz/obsidian-svelte-kit` package. That promotion must preserve the existing `sideEffects: false` and focused-import guarantees for consumers which do not use Svelte.

Self-hosted LiveSync's `openWithExplicitCancel` retry policy, application service context, and Setup Wizard components do not move to Fancy Kit.

Arbitrary component mounting is not added to the neutral `UiInteractions` contract. A component instance is a framework and host integration detail rather than a portable interaction request which a generic driver can serialise or answer. A LiveSync workflow which needs a hosted component defines and receives its own narrow, typed dialogue capability; Self-hosted LiveSync composes that capability from the Kit Modal host and its local Svelte adapter.

### Package artefacts

The common-library package publishes compiled ESM and generated declaration files. Consumers do not receive raw TypeScript as the runtime entry point. The package must provide:

- an explicit `exports` map;
- declaration maps where they remain useful for debugging;
- browser and Node entry points where implementations differ;
- accurate `sideEffects` metadata;
- explicit runtime, peer, and optional dependencies;
- no unresolved `@lib/*`, `@/*`, Vite query, or source `.ts` import in published JavaScript or declarations;
- an `npm pack` contents check; and
- clean-install consumer fixtures for Node, a browser bundle, and Self-hosted LiveSync.

Svelte source, worker query imports, AWS SDK adapters, PouchDB adapters, and Node-only crypto must not leak through the root entry point. Optional feature subpaths may carry their own heavier dependency surface.

### Platform host entries

Platform-specific host access is explicit rather than inferred. `@vrtmrz/livesync-commonlib/node` supplies Node-only capabilities and `createNodeStorage({ rootPath })`. `@vrtmrz/livesync-commonlib/browser` supplies `createFileSystemAccessStorage({ rootHandle })` for the browser File System Access API. Browser bundles cannot resolve the Node implementation through the browser entry.

Both storage factories receive an existing root from their host. Commonlib does not choose a process directory, present a browser directory picker, request browser permission, or persist a `FileSystemDirectoryHandle`. The CLI owns path selection and configuration. The Webapp owns user activation, permission, handle persistence, and re-authorisation. The adapters own only path containment and storage operations below the injected root.

Here, the browser capability means the browser File System Access API, not Node's `fs` API. The package proof deliberately moves the rooted `IStorageAdapter` implementation first. The Webapp retains its LiveSync-specific `IFileSystemAdapter` composition, file-object cache, Vault semantics, picker flow, and storage-event policy. Those responsibilities can move later only with their own documented contracts; they are not implied by the low-level browser entry point.

A later composition may place the constructed storage contract on a host-specific `ServiceContext` subtype, so services depend only on the injected capability while each platform owns context initialisation. This proof does not add storage or raw platform objects to the base `ServiceContext`: doing so would make an optional application capability mandatory for Obsidian, CLI, Webapp, WebPeer, and test contexts at the same time. A future change should inject the narrow `IStorageAdapter` contract rather than expose `FileSystemDirectoryHandle`, Node `fs`, or environment detection through the shared context.

The paired adapters run against the same contract suite for metadata, text and binary access, append, listing, removal, missing paths, parent creation, empty-root handling, and traversal rejection. Timestamp fidelity remains platform-specific because the File System Access API does not provide the same creation-time and timestamp-setting facilities as Node.

The Node entry also centralises direct Node built-in access needed by trusted headless application code. This is a package and scanner boundary, not an assertion that Node and browser APIs are interchangeable. Cross-platform behaviour belongs in a shared contract with separate implementations, as demonstrated by rooted storage.

### Standard input and output

Commonlib's `context` entry exposes a narrow `StandardIo` contract for command-line composition. It reads UTF-8 standard input, asks one line-oriented question, and writes text or binary chunks to standard output and standard error without adding delimiters. Commonlib's `node` entry supplies `createNodeStandardIo()`, which binds that contract to host-selected Node streams and defaults to the current process streams.

Self-hosted LiveSync constructs the Node implementation at the CLI composition root and places the exact instance on `NodeServiceContext`. `NodeServiceHub` must receive that Context rather than silently constructing one. Command handlers reach input, prompts, and protocol output through the Context, so unit tests can inject memory I/O without replacing process globals. Obsidian and browser Contexts do not acquire a fictitious terminal capability, and the base `ServiceContextContract` remains limited to capabilities required by every composition.

Standard I/O does not own command-line arguments, exit codes, signals, stream lifecycle, log levels, or log persistence. Diagnostic logging remains the responsibility of the existing API and Logger composition. CLI adapters receive a narrow diagnostic callback wired to the service logging API instead of calling `console` directly. A CLI host may render selected logs on standard error, but Logger is not added to `StandardIo` or made mandatory on the base Context.

Commonlib verifies memory injection, split UTF-8 decoding, object-mode rejection, text and binary output, and prompting against injected Node streams. The downstream CLI verifies Context identity and exact injected I/O in unit tests, then runs the built Node artefact through its Deno command E2E.

### Context and result compatibility

`ServiceContextContract` is the minimum host-neutral composition contract. It supplies an event channel and message translator selected by the host. Obsidian and CLI contexts extend the default implementation with their own capabilities; the Webapp currently uses the default implementation. Every Service Hub and every service in one composition must retain the exact Context object supplied by that host.

Compatibility is established through observable results, not only structural TypeScript compatibility. A shared probe verifies event delivery, translation results, and Context identity across the public Service Hub surface. Commonlib separately verifies that default contexts isolate their event channels and translators. Real Obsidian runs the same invariants against the loaded plug-in through `obsidian-cli eval`; the CLI runs its composition contract in unit tests and then exercises the built Node artefact through Deno E2E; and the Webapp composition runs the shared contract directly without depending on its currently stale Playwright workflow.

The same rule applies as more APIs move: define the shared result set first, run the same cases against each implementation, and document platform-specific behaviour outside that result set. Matching method names or return types alone does not establish behavioural compatibility. The contract runner remains test support during this proof rather than becoming a new public package API.

### Barrels and export surfaces

The migration does not prohibit every barrel. A small root entry point or task-oriented subpath entry point is an intentional package contract when it has one documented responsibility, uses explicit named exports, and does not load unrelated implementations or optional dependencies. The root client entry point, a focused RPC entry point, and type-only storage-adapter entry points are examples which may remain after review.

An existing barrel or forwarding façade is removed when the migration provides a clearer import and the barrel:

- aggregates unrelated domains or exposes implementation layout as API;
- hides a platform, UI framework, worker, database adapter, or another optional dependency;
- makes side effects or tree-shaking behaviour difficult to determine;
- merely re-exports another package without adding a LiveSync-owned contract; or
- exists only to preserve the present `@lib/*` source alias or Service Hub composition.

In particular, the broad `common/types` barrel is retained only as a temporary compatibility path while focused settings, model, protocol, and path contracts are extracted. The `InjectableServices` forwarding barrel is removed in favour of explicit compatibility imports. Forwarding exports for `octagonal-wheels` facilities are removed where consumers can import the owning package directly; mixed modules such as conversion and utility modules are split when this prevents neutral dependencies from being presented as LiveSync-owned API.

Every retained barrel must correspond to an explicit `exports` entry, list named exports rather than use an unrestricted wildcard, and have a packed-consumer or bundle test proving that unrelated optional code is not loaded. Removing a barrel is not sufficient reason to expose every underlying file as a public subpath.

## Migration Plan

### Phase 0: Record and enforce the boundary

- Add a package-boundary check which rejects `@/` and direct Obsidian imports in common-library production source.
- Record the current Self-hosted LiveSync `@lib/*` import inventory and classify each path as public, compatibility-only, host-owned, or obsolete.
- Inventory mutable module-level state and add a two-client isolation test before promising a public client API.
- Add standalone test and type-check configuration to the common-library repository while retaining downstream Self-hosted LiveSync CI.
- Add a packed-consumer fixture before changing Self-hosted LiveSync resolution.

### Phase 1: Remove host leaks

- Move `ObsidianServiceContext` and `setupObsidian` presentation code to Self-hosted LiveSync.
- Inject the key-value database factory and host event reactions.
- Replace the Obsidian language type import with a local contract.
- Move global DOM compatibility mutation to the browser application bootstrap.
- Introduce translator injection and detach core imports from the full catalogue.
- Split the generic dialogue host, Svelte adapter, and LiveSync policy without changing visible behaviour.

### Phase 2: Build the package

- Add the package manifest, compiled ESM build, declarations, export map, and package documentation.
- Keep the root export deliberately small.
- Remove accidental and forwarding barrels where focused imports are clearer; retain only reviewed package entry points with explicit named exports.
- Add temporary compatibility subpaths required by the classified 140-path migration inventory.
- Test Node, browser, worker, PouchDB, Object Storage, P2P, and headless entry points independently.
- Verify that installing a core entry does not pull Svelte UI or language catalogue code into a representative bundle.

### Phase 3: Publish and validate a pre-release

- Publish an immutable pre-1.0 version to a pre-release npm dist-tag.
- Verify its package name, provenance, checksum, export map, and packed files.
- Run common-library tests against the packed artefact rather than the source checkout.
- Run downstream Self-hosted LiveSync type checks, unit tests, integration tests, CLI tests, Webapp tests, WebPeer tests, production builds, and focused real-Obsidian E2E against the exact package version.
- Validate at least one external consumer which currently uses a submodule or custom loader.

### Phase 4: Convert Self-hosted LiveSync

- Replace `@lib/*` source aliases with package imports.
- Remove the `src/lib` submodule, `_types`, `tsconfig.types.json`, `generate-types.mjs`, and release-workflow steps which regenerate fallback declarations.
- Move common-library i18n tooling out of Self-hosted LiveSync release preparation.
- Keep application-owned source under `src/apps` until a separate decision moves an application.
- Run the community scanner's branch or commit preview before releasing the converted plug-in.

### Phase 5: Stabilise the SDK

- Design a high-level asynchronous client around explicit `create`, `list`, `get`, `put`, `delete`, `watch`, and `close` lifecycles.
- Specify path normalisation, encryption negotiation, conflict handling, conditional writes, deletion, history, and resource disposal before declaring the façade stable.
- Adapt `DirectFileManipulator` behind that façade or deprecate it; do not treat its current constructor and deep dependencies as the final API.
- Narrow or remove compatibility-only export paths as Self-hosted LiveSync imports migrate to documented package modules.

## Implementation Proof

The package proof builds Commonlib as one compiled ESM package with a small root, `context`, `settings`, `remote-configurations`, `browser`, `node`, and `rpc` entries, plus the explicit compatibility exports required by the reviewed downstream revision from which it was built. It publishes neither raw TypeScript nor Svelte source. The immutable `@vrtmrz/livesync-commonlib@0.1.0-rc.2` registry artefact can be installed into a clean consumer, imported in Node, type-checked from declarations, and bundled independently for browser context, browser storage, browser services, and workers. Its registry version and checksum are recorded by release validation.

The published export map contains 126 explicitly named entries, including 118 `compat/*` entries and no unrestricted wildcard. Every compatibility entry was referenced by the reviewed Self-hosted LiveSync source used to prepare the artefact. A final consumer audit then moved imports already covered by the focused `context`, `settings`, and `remote-configurations` entries. The current branch consequently uses 115 compatibility paths; `compat/common/models/setting.const.defaults`, `compat/common/models/setting.const.preferred`, and `compat/hub/hub` remain only as an immutable surplus in `rc.2`. They are candidates for removal from the next reviewed compatibility inventory rather than grounds for changing the published artefact. Remaining compatibility imports still expose migration-only service composition, broader model types, replication implementations, or another contract which the focused entries do not yet replace.

The proof found and fixed three boundary defects which source-alias consumption had hidden: compiled JSON imports required explicit output extensions, precompiled Svelte output could not safely be treated as source by the downstream Svelte pipeline, and Vite's default client conditions selected Commonlib's browser worker while building the Node CLI. Packed-consumer regressions cover the first two. The CLI now uses Vite's server conditions and treats every Node built-in reported by Commonlib's Node entry as external; the built CLI is exercised through Deno E2E. Importing root or context also no longer patches DOM prototypes, translator injection prevents the context entry from loading the complete language catalogue, and standard input and protocol output are supplied by the package-owned host contract rather than direct stream access in command handlers.

Self-hosted LiveSync, its CLI, Webapp, WebPeer, plug-in source, and tests compile against that exact registry artefact without `@lib/*`. Focused downstream storage tests pass against the package-owned Node and File System Access API implementations. Commonlib also owns the Trystero implementation and version; the host retains no direct Trystero dependency, preventing two transport generations from entering one application graph. The old `src/lib` Git submodule, generated `_types` fallback, type-generation scripts, and source aliases are removed by the proof branch.

The Commonlib contract suite passes 21 tests covering Context results, both platform storage implementations, and standard I/O; its complete suite passes 1,123 tests across 62 files. Self-hosted LiveSync's three host-composition contract tests and complete 342-test unit suite across 38 files pass against the registry artefact. The plug-in, CLI, Webapp, and WebPeer production builds also pass. The CLI contract command completes its nine-step Deno workflow against the built Node artefact.

The package-owned Trystero transport also completes the canonical Compose P2P synchronisation workflow with a local relay and two isolated CLI peers. In real Obsidian, the plug-in starts with one consistent `ObsidianServiceContext`, the representative server-selection and Setup URI Svelte dialogues mount and close through their normal controls, their mobile variants satisfy viewport, safe-area, and touch-target assertions, and the settings pane exposes only the effective deletion controls. These runtime checks complement the package tests without making Webapp maintenance the primary release gate.

The Community directory scanner preview completes with no source-code errors. The former findings attributed to generated `_types`, raw `src/lib` source, Node built-ins, forbidden rule suppressions, unsupported Obsidian APIs, and undescribed directive comments are absent. This confirms that the registry dependency is recognised as a package boundary. The preview identified behaviour-neutral redundant CLI candidate types and Webapp File System Access API assertions; these are corrected in the host source rather than carried as known warnings.

The remaining source warnings belong to application code. Browser dialogue visibility now uses DOM state instead of inline static styling, so the earlier styling warning is absent. Direct diagnostic output was resolved at its existing ownership boundaries: Webapp components use an injected log function backed by `BrowserAPIService`, WebPeer retains output in its Svelte log store, Obsidian modules use the established Logger path, and duplicate console emission was removed from `ModuleLog`. The later Webapp and WebPeer recomposition around maintained Context and serviceFeature APIs should preserve these explicit output paths.

The final Community lint inventory for this boundary has no errors and 126 warnings: 67 sentence-case findings, 58 deprecated-API findings, and one declarative setting-definition suggestion. The sentence-case strings and deprecated interfaces are retained deliberately to avoid an unrelated localisation and host-lifecycle change. Declarative definitions would migrate the complete Obsidian setting tab into the 1.13 settings-search model; that is a separate visible UI project after LiveSync 1.0, not a hidden package-boundary release gate. Revisit each category through focused UI and compatibility work rather than suppressing the rules or treating the warning count as zero.

WebPeer's production build still reports that Vite externalises the guarded Node `crypto` fallback reached through a compatibility path. Browser execution selects `globalThis.crypto`, and the focused root, `context`, and `browser` bundle checks do not include the Node fallback, so this is not a leak in the reviewed public browser entries. Removing the compatibility-build warning requires a focused crypto-capability contract or a platform-specific implementation split and remains part of compatibility-surface narrowing.

The dependency preview also reports `uuid`, but the installed and locked graph resolves PouchDB's UUID dependency to the patched `uuid@11.1.1` through the repository override, and `npm audit` does not report the UUID advisory. The scanner appears to infer the older declared PouchDB range rather than the resolved override, so this warning is treated as a scanner false positive unless a packed-artefact inspection shows otherwise.

The 1.0 dependency review found two newly disclosed denial-of-service advisories with compatible fixes. All locked `brace-expansion` generations now use their patched releases, including the production generation reached by Commonlib path matching and the CLI's user-configured ignore patterns. The development-only ESLint and Istanbul `js-yaml` generations likewise use patched releases. A clean install and both complete and production-only `npm audit` checks no longer report either package.

The remaining audit report is the existing `werift` and `werift-ice` dependency on `ip`, for which npm offers no patched version. The advisory concerns `ip.isPublic()` misclassifying unusual loopback representations. The locked werift implementation uses `ip` for address encoding, decoding, format detection, and loopback filtering, but does not call `isPublic()` or `isPrivate()`. LiveSync reaches werift only through the Node CLI's injected `RTCPeerConnection`; the Obsidian plug-in and browser applications use their platform WebRTC implementation, and the plug-in artefact does not contain werift. The package-level finding is therefore accepted for the 1.0 integration preview as a non-reachable advisory in the reviewed call path, not as a general waiver. Revisit it when werift or `ip` publishes a replacement, or before any change which delegates address trust, routing, or URL access decisions to that dependency.

The local real-Obsidian suite verifies the actual loaded `ObsidianServiceContext`, all 18 services, Vault reflection, CouchDB and Object Storage transfer, remote-activity accounting, CLI-to-Obsidian encrypted synchronisation, startup scanning, two-Vault create, update, delete, ordinary rename, case-only rename, target mismatch, Hidden File Sync, Customisation Sync, and setting Markdown export. These checks establish observable results and host composition rather than relying on declaration compatibility alone.

The current browser Harness has a pre-existing settings-migration initialisation timeout which reproduces on the untouched baseline. The Webapp Playwright workflow also currently reuses an unrelated process on its configured port and reaches a `Not Found` page. Neither failure is evidence for or against the package boundary. The Webapp production build and direct composition contract pass, while Webapp browser E2E remains supplementary until its runner is repaired. Current acceptance therefore relies primarily on Commonlib owner and packed-consumer tests, LiveSync unit and integration tests, Deno CLI E2E, application production builds, and the focused local real-Obsidian suite. The unrelated Harness and Playwright defects should be tracked independently.

## Scanner and Repository Consequences

Consuming the npm package removes the common-library source and generated `_types` from the plug-in repository's Community directory scan, because package dependencies are treated as dependencies rather than maintained plug-in source. The branch preview confirms this expected boundary.

The change does not hide or resolve warnings in Self-hosted LiveSync-owned source. The scanner will continue to inspect the plug-in, CLI, Webapp, and WebPeer while those applications remain in the repository. Moving those applications to a LiveSync-family application repository may be considered after the package boundary is stable, but it is not part of this decision because the CLI and Webapp still import shared plug-in composition code.

Package extraction also does not resolve release-asset attestation verification, unsupported release assets, declarative settings migration, or other scanner findings which are independent of source ownership.

## Alternatives Rejected

### Move the common library into the Self-hosted LiveSync monorepo

This would permit atomic source changes and remove the Git submodule, but the community scanner already examines non-plug-in application source. A source workspace would remain in scope, and every library directive and platform dependency would be attributed to the plug-in repository. It would also make independent consumers depend on the plug-in repository's release cadence.

### Move the common library into Fancy Kit

Fancy Kit owns reusable framework-neutral interactions, Obsidian adapters, test infrastructure, and neutral utilities. Replication protocols, chunk and metadata formats, PouchDB composition, conflict rules, and LiveSync storage policy are a different domain. Moving them would obscure ownership and make general plug-in tooling carry Self-hosted LiveSync release concerns.

### Publish the current source tree without changing boundaries

This would expose accidental deep imports, global mutations, Svelte and browser code, Node-only modules, and parent-repository imports. Consumers would still need source aliases and bundler-specific behaviour, while maintainers would be unable to distinguish public API from implementation.

### Split every concern into a separate npm package immediately

Core, language, UI, browser, Node, P2P, Object Storage, and SDK packages could make dependency graphs precise, but the present source has not yet proven those release boundaries. Starting with one compiled package and explicit optional subpaths allows measurement without creating a coordinated release matrix. Additional packages remain possible after their contracts and consumers are demonstrated.

## Verification

The package-boundary conversion is ready for acceptance only when:

- common-library production source has no parent-repository or Obsidian dependency;
- the package builds and tests from a standalone clean checkout;
- `npm pack` contains only intended compiled artefacts and documentation;
- packed Node and browser consumers resolve only exported paths;
- a headless client does not bundle Svelte or the full language catalogue;
- retained entry-point barrels do not load unrelated optional implementations, and no removed barrel is replaced by unrestricted deep exports;
- Self-hosted LiveSync verifies its local Svelte adapter and workflow policy through injected tests and a focused composition smoke test;
- Self-hosted LiveSync no longer has `src/lib`, `_types`, or `@lib/*` source aliases;
- the Commonlib owner and packed-consumer suites, Self-hosted LiveSync unit and integration tests, Deno CLI E2E, plug-in and application production builds, and focused real-Obsidian E2E pass against the reviewed package artefact;
- common-library downstream CI records and tests the exact Self-hosted LiveSync ref;
- a Community directory scanner preview confirms the expected change in source findings; and
- compatibility exports are explicitly enumerated from a reviewed downstream inventory rather than exposed through a wildcard.

The following are later SDK-stabilisation gates, not blockers for accepting the package boundary:

- two clients with different database, encryption, language, and lifecycle settings can coexist without sharing mutable client state;
- an external consumer can replace its submodule or custom loader with the documented high-level package API; and
- if the framework-neutral Modal host is promoted to Fancy Kit, Kit-owned lifecycle, viewport, safe-area, and touch-target guarantees replace duplicated device tests in LiveSync.

## Consequences

- The common library gains an independently consumable and testable artefact while retaining its domain ownership and history.
- Self-hosted LiveSync release archives no longer need generated fallback declarations for an absent submodule.
- Community directory scanning distinguishes plug-in source from the reviewed dependency.
- Changes which span the package and plug-in require coordinated package and downstream validation rather than one atomic source commit.
- Temporary compatibility exports increase the first package surface, but their pre-1.0 status and explicit classification prevent them from becoming silent permanent contracts.
- Translation, Svelte, and platform dependencies become optional composition concerns rather than root-package side effects.
- Fancy Kit may gain a generally useful typed Obsidian Modal host without acquiring LiveSync policy or a mandatory Svelte dependency.

## Open Questions Before Acceptance

- Define the focused stable language entry point which will replace the temporary compatibility subpath.
- Define the minimum conflict and conditional-write guarantees required by the first public high-level client.
- Continue narrowing the broad model, service-composition, and replication compatibility paths as focused result contracts become available.
- Confirm whether another Fancy Kit consumer needs the framework-neutral Modal host before it is added to the Kit, or whether LiveSync should pilot the contract first.
