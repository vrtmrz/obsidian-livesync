# Self-hosted LiveSync Development Guide

## Project Overview

Self-hosted LiveSync is an Obsidian plugin for synchronising vaults across devices using CouchDB, MinIO/S3, or peer-to-peer WebRTC. The codebase uses a modular architecture with TypeScript, Svelte, and PouchDB.

## Build & Development Workflow

### Environment Setup

#### First-time Setup

```bash
git clone https://github.com/vrtmrz/obsidian-livesync
cd obsidian-livesync
npm ci
npm run build
```

#### Branch switching

When switching branches, reinstall dependencies when the lockfile changes.

```bash
git checkout 0.25.70-patch1 # tag or branch name
npm ci
npm run build
```

### Commands

```bash
npm run test:unit    # Run unit tests with vitest (or `npm run test:unit:coverage` for coverage)
npm run check        # TypeScript and svelte type checking
npm run dev          # Development build with auto-rebuild (uses .env for test vault paths)
npm run build        # Production build
npm run buildDev     # Development build (one-time)
npm run test:integration                 # Run CouchDB-backed integration tests
npm run test:setup-tools                 # Check provisioning and Setup URI package contracts
npm run test:e2e:cli:p2p                 # Run canonical P2P validation in Compose
npm run test:e2e:obsidian:local-suite    # Run the real Obsidian local suite
```

### Tips

Select the narrowest unit, integration, CLI E2E, or real Obsidian E2E command that owns the behaviour being changed. The obsolete mocked browser Harness has been retired.

### Unreleased change notes

Keep changes that may belong in a future release under `## Unreleased` at the top of `updates.md` when they do not justify an immediate release. Do not add a date to this virtual version. Move relevant entries under the real version and ordinal release date when preparing that release, then leave an empty `## Unreleased` section for subsequent work.

Use this section for durable release-note candidates, including compatibility-relevant internal maintenance, rather than tasks, local diagnostics, or implementation journals. Categorise user-visible behaviour separately from internal changes and testing.

### Auto-copy to test vaults

To facilitate development and testing, the build process can automatically copy the built plugin to specified test vault

- Create `.env` file with `PATHS_TEST_INSTALL` pointing to test vault plug-in directories (`:` separated on Unix, `;` on Windows)
- Development builds auto-copy to these paths on build whilst `npm run dev` is running (watch mode)

### Testing Infrastructure

- ~~**Deno Tests**: Unit tests for platform-independent code (e.g., `HashManager.test.ts`)~~
    - This is now obsolete, migrated to vitest.
- **Vitest**:
    - **Unit Tests** (`vitest.config.unit.ts`): Unit tests run in Node.js (excluding harnesses and integration tests). Unit tests should be `*.unit.spec.ts` and placed alongside the implementation file (e.g., `ChunkFetcher.unit.spec.ts`). Executed via `npm run test:unit`.
    - **Integration Tests** (`vitest.config.integration.ts`): Tests run in Node.js against a real CouchDB instance. Integration tests should be `*.integration.spec.ts` or `*.integration.test.ts` and placed alongside the implementation file (e.g., `StreamingFetch.integration.spec.ts`). Executed via `npm run test:integration`.
        - If you add a feature that interacts with the remote database (e.g., replication changes, custom changes feed parameters, or custom HTTP queries), you strongly expected to write an integration test to verify the behaviour against a real CouchDB server.
    - **Commonlib Tests**: Commonlib owns unit and package tests for shared RPC, storage, replication, and platform contracts. LiveSync CI verifies the exact packed dependency as a downstream consumer.
- **CLI E2E** (`src/apps/cli/testdeno/`): Host-independent consumer workflows. The canonical Compose P2P suite covers ordinary two-peer synchronisation, replacement of the current replicator followed by transfer with the same peer, and explicit relay disconnection followed by paused and resumed reconnection. Its lifecycle entry point is included only in the Docker test build and does not add a public CLI command. Run `npm run test:e2e:cli` for the ordinary suite or `npm run test:e2e:cli:p2p` for P2P validation.
- **Self-hosted setup tools** (`utils/couchdb/`, `utils/setup/`, and `utils/flyio/`): Deno contract tests consume the exact locked Commonlib registry package, verify current CouchDB, Object Storage, and random-room P2P Setup URI defaults and remote profiles, and keep CouchDB administration separate from package-owned LiveSync database-version negotiation. `unit-ci` also provisions a real temporary CouchDB database and verifies its version document against the installed Commonlib package. Run `npm run test:setup-tools` for the local contract gate.
- **Real Obsidian E2E** (`test/e2e-obsidian/`): Local-first scripts that launch real Obsidian with temporary vaults and the built Self-hosted LiveSync plug-in. Use these for boot-up sequence, vault reflection, RedFlag flows, Fast Setup (Simple Fetch), settings dialogues, restart-sensitive workflows, Object Storage regressions, and other behaviour that depends on Obsidian itself. Run focused scripts such as `npm run test:e2e:obsidian:two-vault-sync`, or use `npm run test:e2e:obsidian:local-suite:services` to run the broader local suite with CouchDB and MinIO fixtures managed by the wrapper.

- **Docker Services**: Service-backed tests use CouchDB and MinIO (S3). Canonical P2P validation owns its relay through the CLI Compose runner:

    ```bash
    npm run test:docker-all:start  # Start all test services
    npm run test:integration       # Run the relevant service-backed suite
    npm run test:docker-all:stop   # Stop services
    ```

    If some services are not needed, start only required ones (e.g., `test:docker-couchdb:start`).
    Note that if services are already running, starting script will fail. Please stop them first.

- **Test Structure**:
    - `test/e2e-obsidian/` - Real Obsidian E2E scripts for local verification
    - co-located `*.unit.spec.ts` files - Node-based unit tests
    - co-located `*.integration.spec.ts` files - service-backed integration tests
    - `src/apps/webapp/obsidianMock.ts` - Webapp-only Obsidian compatibility adapter; it is not an E2E Harness

### Import Path Normalisation

The codebase uses the `@/` alias for source owned by this repository. Commonlib imports use explicit `@vrtmrz/livesync-commonlib` package subpaths. To normalise LiveSync-owned imports and exports, use the following utility script:

```bash
npm run pretty:importpath
```

Under the hood, this runs Deno with the script [utilsdeno/normalise-imports.ts](utilsdeno/normalise-imports.ts). You can pass additional flags to this script if required (by running it via Deno directly from the `utilsdeno` directory):

- `--run`: Applies the changes (the script runs in dry-run mode by default).
- `--all-alias`: Normalises sibling/child relative imports starting with `./` to use aliases.

### Commonlib dependency

Shared synchronisation code is compiled and typed by the `@vrtmrz/livesync-commonlib` package. `npm ci` installs the exact artefact recorded by the lockfile; this repository does not compile Commonlib source or commit fallback declarations.

Changes spanning both repositories must first produce a packed Commonlib artefact which passes its standalone package checks. Install that exact artefact in LiveSync, then run the LiveSync type checks, unit tests, application builds, CLI E2E, and any focused real-Obsidian E2E required by the changed boundary. Replace the temporary artefact reference with the reviewed immutable package version before release.

## Architecture

### Module System

The plugin uses a dynamic module system to reduce coupling and improve maintainability:

- **Service Hub**: Central registry for services using dependency injection
    - Services are registered, and accessed via `this.services` (in most modules)
- **Module Loading**: All modules extend `AbstractModule` or `AbstractObsidianModule` (which extends `AbstractModule`). These modules are loaded in main.ts and some modules.
- **Module Categories** (by directory):
    - `core/` - Platform-independent core functionality
    - `coreObsidian/` - Obsidian-specific core (e.g., `ModuleFileAccessObsidian`)
    - `essential/` - Required modules (e.g., `ModuleMigration`, `ModuleKeyValueDB`)
    - `features/` - Optional features (e.g., `ModuleLog`, `ModuleObsidianSettings`)
    - `extras/` - Development/testing tools (e.g., `ModuleDev`, ~~`ModuleIntegratedTest`~~)
- **Services**: Core services (e.g., `database`, `replicator`, `storageAccess`) are registered in `ServiceHub` and accessed by modules. They provide an extension point for add new behaviour without modifying existing code.
    - For example, checks before the replication can be added to the `replication.onBeforeReplicate` handler, and the handlers can be return `false` to prevent replication-starting. `vault.isTargetFile` also can be used to prevent processing specific files.
- **ServiceModule**: A new type of module that directly depends on services.

#### Note on Module vs Service

After v0.25.44 refactoring, the Service will henceforth, as a rule, cease to use setHandler, that is to say, simple lazy binding. - They will be implemented directly in the service. - However, not everything will be middlewarised. Modules that maintain state or make decisions based on the results of multiple handlers are permitted.

Hence, the new feature should be implemented as follows:

- If it is a simple extension point (e.g., adding a check before replication), it should be implemented as a handler in the service (e.g., `replication.onBeforeReplicate`).
- If it requires maintaining state or making decisions based on multiple handlers, it should be implemented as a serviceModule dependent on the relevant services explicitly.
- If you have to implement a new feature without much modification, you can extent existing modules, but it is recommended to implement a new module or serviceModule for better maintainability.
- Refactoring existing modules to services is also always welcome!
- Please write tests for new features, you will notice that the simple handler approach is quite testable.

### Key Architectural Components

- **LiveSyncLocalDB** (`@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB`): Local PouchDB database wrapper
- **Replicators** (`@vrtmrz/livesync-commonlib/compat/replication/*`): CouchDB, Journal, and P2P synchronisation engines
- **Service Hub** (`src/modules/services/`): Central service registry using dependency injection
- **Common Library** (`@vrtmrz/livesync-commonlib`): Platform-independent synchronisation logic, shared with the CLI, Webapp, WebPeer, and external tools

Commonlib owns the P2P replicator and Trystero transport lifecycle. Host commands, event handlers, and views must retain the Commonlib service-feature result and resolve its current `replicator` at the point of use. They must not snapshot an instance which can be replaced when settings or the local database change, close Trystero-owned raw peers, or install another Trystero transport generation at the application root.

### Conflict Merge Policy

Markdown conflict auto-merge should behave like a conservative three-way merge. The guiding rule is to merge changes when they touch non-overlapping regions, and to keep a manual conflict when the edits overlap semantically.

When in doubt, prefer the safer outcome: preserve data, keep the conflict visible, and ask the user rather than silently discarding content or choosing one side.

The detailed contract is documented in [Conflict resolution and revision provenance](docs/specs_conflict_resolution.md). Determine the merge base by intersecting the exact `available` revision IDs from both leaf histories and selecting the nearest shared revision. Do not infer ancestry from revision generation numbers. When a remote resolution reaches a Vault which still contains the exact content of a deleted losing branch, treat that content as known synchronised history so the resolution can be reflected without recreating the conflict.

File operations made while a conflict is active must use the device-local file-reflection provenance injected into `ServiceFileHandlerBase`. Treat its exact revision as authoritative; use byte equality only to reconstruct a missing record when exactly one available revision matches. If branch identity remains unknown, preserve data and leave the conflict visible. Do not hide key-value database readiness behind an implicit wait: maintained hosts open it through the sequential settings lifecycle before file events or replication begin.

- If one side deletes a line and the other side leaves that same line unchanged, treat it as a safe deletion. The deleted line must not be reintroduced into the merged result.
- If one side inserts new content in a different region while the other side deletes an unchanged old region, preserve the insertion and the deletion.
- If one side deletes a line and the other side modifies that same line, keep the conflict for user resolution.
- If both sides insert different content at the same position, keep both insertions in a deterministic order unless the surrounding deletion context indicates that they are competing replacements.
- Avoid resolving conflicts by simply choosing the newest revision unless the user has explicitly selected that behaviour.

This policy is intentionally aligned with the conflict checkboxes and compatibility settings: automatic merge should remove avoidable prompts, but it must not silently choose between overlapping user intentions.

### File Structure Conventions

- **Platform-specific code**: Use `.platform.ts` suffix (replaced with `.obsidian.ts` in production builds via esbuild)
- **Development code**: Use `.dev.ts` suffix (replaced with `.prod.ts` in production)
- **Path aliases**: `@/*` maps to `src/*`; Commonlib uses package exports rather than a source alias

## Code Conventions

### Internationalisation (i18n)

- **Translation Workflow**:
    1. Edit the human-readable YAML files in this repository under `src/common/messagesYAML/`
    2. Run `npm run i18n:bake` to compile YAML → JSON → TypeScript constants
    3. Use `$t()`, `$msg()` functions for translations
       You can also use `$f` for formatted messages with Tagged Template Literals.
- **Usage**:
    ```typescript
    $msg("dialog.someKey"); // Typed key with autocomplete
    $t("Some message"); // Direct translation
    $f`Hello, ${userName}`; // Formatted message
    ```
- **Supported languages**: `def` (English), `de`, `es`, `fr`, `he`, `ja`, `ko`, `ru`, `zh`, `zh-tw`

Commonlib owns the typed English fallback for messages requested by its services. LiveSync owns the multilingual application catalogue and injects its translator into the Obsidian, CLI, and browser service compositions. Adding a Commonlib message therefore requires its canonical English definition in Commonlib; LiveSync may provide translations here, while an untranslated key falls back to Commonlib English. Importing a Commonlib language catalogue is not part of the boundary.

### File Path Handling

- Use tagged types from `types.ts`: `FilePath`, `FilePathWithPrefix`, `DocumentID`
- Prefix constants: `CHeader` (chunks), `ICHeader`/`ICHeaderEnd` (internal data)
- Path utilities are supplied by the focused Commonlib compatibility path `@vrtmrz/livesync-commonlib/compat/string_and_binary/path`

### Logging & Debugging

- Use `this._log(msg, LOG_LEVEL_INFO)` in modules (automatically prefixes with module name)
- Log levels: `LOG_LEVEL_DEBUG`, `LOG_LEVEL_VERBOSE`, `LOG_LEVEL_INFO`, `LOG_LEVEL_NOTICE`, `LOG_LEVEL_URGENT`
    - LOG_LEVEL_NOTICE and above are reported to the user via Obsidian notices
    - LOG_LEVEL_DEBUG is for debug only and not shown in default builds
- Dev mode creates `ls-debug/` folder in `.obsidian/` for debug outputs (e.g., missing translations)
    - This causes pretty significant performance overhead.

## Common Patterns

### Module Implementation (Now not recommended for new features, use services instead)

```typescript
export class ModuleExample extends AbstractObsidianModule {
    async _everyOnloadStart(): Promise<boolean> {
        /* ... */
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnInitialise(this._everyOnloadStart.bind(this));
    }
}
```

### Settings Management

- Settings are defined by Commonlib (`ObsidianLiveSyncSettings`)
- Configuration metadata is supplied by the Commonlib settings exports
- Use `this.services.setting.saveSettingData()` instead of using plugin methods directly

### Database Operations

- Local database operations through `LiveSyncLocalDB` (wraps PouchDB)
- Document types: `EntryDoc` (files), `EntryLeaf` (chunks), `PluginDataEntry` (plugin sync)

## Important Files

- [main.ts](src/main.ts) - Plugin entry point, module registration
- [esbuild.config.mjs](esbuild.config.mjs) - Build configuration with platform/dev file replacement
- [package.json](package.json) - Scripts reference and dependencies

## Pre-release Policy

- Use SemVer beta identifiers such as `1.0.0-beta.0` for immutable integration previews. Increment the beta number when a published preview needs a correction. Reserve `1.0.0-rc.0` for the first feature- and contract-frozen release candidate. Historical `-patchedN` releases remain unchanged in the release history.
- Publish a pre-release from an immutable reviewed tag, mark its GitHub Release as a pre-release, and do not replace the latest stable release.
- A plug-in review release may omit the CLI image when the CLI artefact is not part of the required validation. When a pre-release CLI image is published, it receives immutable version and SHA-qualified tags only; it must not advance `latest` or a stable major-minor tag.
- Keep the release pull request in draft until the exact published plug-in has passed BRAT validation. If validation fails, prepare the next pre-release version rather than moving the existing tag.

## Release Notes

- Keep the top section of `updates.md` as `## Unreleased` during normal development.
- When opening a feature or fix PR, update `## Unreleased` in the same PR if the change is user-facing.
- Add only user-facing changes that help users understand what they gain, what has changed, or what they may need to do after updating.
- Avoid listing purely internal refactors, maintenance chores, generated-file changes, and dependency updates unless they affect users; group and label them when they are included.
- When preparing a release, replace `## Unreleased` with the target version heading (for example, `## 0.25.81`) and add a fresh empty `## Unreleased` section above it for the next cycle.
- Review and polish the released section in the release PR before tagging, because the content is embedded into the plug-in and may be reused as the GitHub Release notes.

## Release Workflow

This workflow is for maintainers. Contributors should update `## Unreleased` for user-facing feature or fix PRs, but do not need to run the release workflows.
The `Finalise Release Tags` and `Release Obsidian Plugin` workflows use the `release` GitHub Environment. Configure Environment protection in the repository settings so tag creation and release publication require maintainer approval.

- Run the `Prepare Release PR` workflow with the target version and selected base branch. It creates the release branch, updates versions, confirms that Commonlib is locked to an immutable package version, moves the `## Unreleased` notes to the target version, commits the release preparation, pushes the branch, and opens a draft release PR. The base branch may already select the target development version; the workflow still runs the version lifecycle so that release-only metadata such as `versions.json` is recorded in the release commit.
- Do not tag the release branch when the PR is first created. Polish the release PR first, especially `updates.md`.
- Once the release PR head is fixed, run the `Finalise Release Tags` workflow with its full head commit SHA. It validates the release branch, ensures that the plug-in tag points to that commit, optionally creates the corresponding CLI tag, and dispatches the plug-in release workflow. A CLI tag starts its own container workflow. The finalisation workflow can be retried when existing tags already point to the reviewed commit, but stops if a selected tag points elsewhere.
- The plug-in publishing workflow is intentionally dispatch-only. Pushing a plug-in tag directly does not publish a GitHub Release; use `Finalise Release Tags`, or dispatch `Release Obsidian Plugin` explicitly for recovery or a pre-release. The CLI Docker workflow retains its documented branch, tag, and manual triggers.
- Approve the `Release Obsidian Plugin` workflow for the `release` environment, then inspect the generated draft GitHub Release. For a selected CLI publication, confirm the image tags appropriate to a stable or pre-release version.
- Publish a stable draft as the latest release, or publish a pre-release draft without replacing the latest stable release. In either case, keep the release PR in draft and leave its base branch unchanged until BRAT validation succeeds. Record that state in the PR.
- Validate the published release through BRAT. Confirm start-up, ordinary bidirectional synchronisation, and any regression scenario relevant to the release.
- After BRAT validation succeeds, mark the release PR ready and merge it into the selected base branch with a merge commit. This keeps the tagged release commit in that branch's history.
- If BRAT validation fails, keep the release PR in draft. Do not move published tags; prepare and publish a new patch release instead.
- For a pre-release, set `prerelease=true` in `Finalise Release Tags`. A hyphenated version is rejected unless that input is enabled.

### Release Cheat Sheet

1. Before starting, add user-facing notes under `## Unreleased` in `updates.md`.
2. Run `Prepare Release PR` from GitHub Actions.
    - `version`: the target version, for example `0.25.81`.
    - `base_branch`: normally `main`, or the reviewed integration branch for an integration preview.
    - `release_branch`: leave blank to use the default branch name, for example `0_25_81`.
    - `release_date`: use an ordinal date such as `14th July, 2026`, or leave blank to use the current UTC date.
    - `allow_empty_updates`: leave disabled unless the release intentionally has no user-facing notes.
3. Review the generated draft PR.
    - Polish `updates.md`.
    - Confirm `package.json`, `manifest.json`, `versions.json`, workspace package versions, and the locked Commonlib package version.
    - Confirm that `manifest.json` has the intended `minAppVersion`.
    - Wait for the necessary CI checks.
4. When the PR head is fixed, run `Finalise Release Tags`.
    - `version`: the same target version.
    - `release_branch`: leave blank unless the release branch used a custom name.
    - `expected_head_sha`: the full head commit SHA reviewed in the release PR.
    - `prerelease`: enable for a version such as `1.0.0-rc.0`.
    - `publish_cli`: disable when the reviewed release is plug-in-only.
5. Approve the `Release Obsidian Plugin` workflow for the `release` environment, then check the generated draft GitHub Release.
6. If CLI publication was selected, confirm that the CLI tag event published the expected image tags.
7. Publish the draft as a stable release or pre-release as selected, but keep the release PR in draft and leave its base branch unchanged.
8. Update the PR state message to describe the published release and state that merging remains on hold until BRAT validation is complete.
9. Validate the published release through BRAT, including start-up, ordinary bidirectional synchronisation, and any release-specific regression scenario.
10. After BRAT validation succeeds, mark the release PR ready and merge it into the selected base branch with a merge commit.
11. If validation fails, leave the PR in draft and prepare a new patch release without moving the published tags.

## Contribution Guidelines

- Follow existing code style and conventions
- Write integration tests (`*.integration.spec.ts` or `*.integration.test.ts`) when adding or modifying features that interact with the remote database, and ensure that they pass in the CI workflow.
- Please bump dependencies with care, check artifacts after updates, with diff-tools and only expected changes in the build output (to avoid unexpected vulnerabilities).
- When adding new features, please consider it has an OSS implementation, and avoid using proprietary services or APIs that may limit usage.
    - For example, any functionality to connect to a new type of server is expected to either have an OSS implementation available for that server, or to be managed under some responsibilities and/or limitations without disrupting existing functionality, and scope for surveillance reduced by some means (e.g., by client-side encryption, auditing the server ourselves).
