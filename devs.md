# Self-hosted LiveSync Development Guide

## Project Overview

Self-hosted LiveSync is an Obsidian plugin for synchronising vaults across devices using CouchDB, MinIO/S3, or peer-to-peer WebRTC. The codebase uses a modular architecture with TypeScript, Svelte, and PouchDB.

## Build & Development Workflow

### Environment Setup

#### First-time Setup

This repository uses submodules by convention. Therefore, you must use the `--recursive` flag when cloning it.

```bash
git clone --recursive https://github.com/vrtmrz/obsidian-livesync
npm ci
npm run build
```

Note: if you already cloned without submodules, run: `git submodule update --init --recursive`

#### Branch switching

When switching branches, please make sure to update submodules as well, since they may be updated in the new branch.

```bash
git checkout --recurse-submodules 0.25.70-patch1 # tag or branch name
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
npm run bakei18n     # Pre-build step: compile i18n resources (YAML → JSON → TS)
npm run test:unit    # Run unit tests only (no Docker services required)
npm test             # Run Harness based vitest tests (requires Docker services), not recommended, unstable.
```

### Tips

Use CLI E2E tests or real Obsidian E2E scripts instead of `npm test` when the behaviour can be verified outside the browser harness.

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
    - **Browser Harness Tests** (`vitest.config.ts`): Transitional browser-based harness tests using Playwright/Chromium. Executed via `npm run test`. This layer is no longer the preferred destination for new broad E2E coverage because `test/harness` can drift from real Obsidian behaviour.
    - **P2P Tests** (`vitest.config.p2p.ts`): Browser-based Peer-to-Peer replication tests. Executed via `npm run test:p2p`.
    - **RPC Unit Tests** (`vitest.config.rpc-unit.ts`): RPC-specific unit tests with coverage thresholds.
- **Real Obsidian E2E** (`test/e2e-obsidian/`): Local-first scripts that launch real Obsidian with temporary vaults and the built Self-hosted LiveSync plug-in. Use these for boot-up sequence, vault reflection, RedFlag flows, Fast Setup (Simple Fetch), settings dialogues, restart-sensitive workflows, Object Storage regressions, and other behaviour that depends on Obsidian itself. Run focused scripts such as `npm run test:e2e:obsidian:two-vault-sync`, or use `npm run test:e2e:obsidian:local-suite:services` to run the broader local suite with CouchDB and MinIO fixtures managed by the wrapper.

- **Docker Services**: Tests require CouchDB, MinIO (S3), and P2P services:

    ```bash
    npm run test:docker-all:start  # Start all test services
    npm run test:full              # Run tests with coverage
    npm run test:docker-all:stop   # Stop services
    ```

    If some services are not needed, start only required ones (e.g., `test:docker-couchdb:start`).
    Note that if services are already running, starting script will fail. Please stop them first.

- **Test Structure**:
    - `test/e2e-obsidian/` - Real Obsidian E2E scripts for local verification
    - `test/suite/` - Transitional browser harness tests for sync operations
    - `test/unit/` - Unit tests (via vitest, as harness is browser-based)
    - `test/harness/` - Transitional mock implementations (e.g., `obsidian-mock.ts`). Avoid adding broad new E2E coverage here unless it is explicitly a compatibility bridge.

### Import Path Normalisation

The codebase uses `@/` and `@lib/` path aliases to keep import structures clean. To normalise imports and exports across files, use the following utility script:

```bash
npm run pretty:importpath
```

Under the hood, this runs Deno with the script [utilsdeno/normalise-imports.ts](file:///p:/plant25/obsidian/projects/obsidian-livesync/utilsdeno/normalise-imports.ts). You can pass additional flags to this script if required (by running it via Deno directly from the `utilsdeno` directory):

- `--run`: Applies the changes (the script runs in dry-run mode by default).
- `--all-alias`: Normalises sibling/child relative imports starting with `./` to use aliases.

### Type Generation

To generate fallback type definitions for the shared library and add appropriate Deno ignore comments (which suppresses Deno compilation warnings and linting warnings inside the `_types` directory), run:

```bash
npm run build:lib:types
```

This script executes:

1. TypeScript compilation (`tsconfig.types.json`) to output definitions to the `_types` directory.
2. The Deno script [utilsdeno/types-add-ignore.ts](file:///p:/plant25/obsidian/projects/obsidian-livesync/utilsdeno/types-add-ignore.ts) to prepend Deno ignore comments to the generated type files.

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

- **LiveSyncLocalDB** (`src/lib/src/pouchdb/`): Local PouchDB database wrapper
- **Replicators** (`src/lib/src/replication/`): CouchDB, Journal, and MinIO sync engines
- **Service Hub** (`src/modules/services/`): Central service registry using dependency injection
- **Common Library** (`src/lib/`): Platform-independent sync logic, shared with other tools

### Conflict Merge Policy

Markdown conflict auto-merge should behave like a conservative three-way merge. The guiding rule is to merge changes when they touch non-overlapping regions, and to keep a manual conflict when the edits overlap semantically.

When in doubt, prefer the safer outcome: preserve data, keep the conflict visible, and ask the user rather than silently discarding content or choosing one side.

- If one side deletes a line and the other side leaves that same line unchanged, treat it as a safe deletion. The deleted line must not be reintroduced into the merged result.
- If one side inserts new content in a different region while the other side deletes an unchanged old region, preserve the insertion and the deletion.
- If one side deletes a line and the other side modifies that same line, keep the conflict for user resolution.
- If both sides insert different content at the same position, keep both insertions in a deterministic order unless the surrounding deletion context indicates that they are competing replacements.
- Avoid resolving conflicts by simply choosing the newest revision unless the user has explicitly selected that behaviour.

This policy is intentionally aligned with the conflict checkboxes and compatibility settings: automatic merge should remove avoidable prompts, but it must not silently choose between overlapping user intentions.

### File Structure Conventions

- **Platform-specific code**: Use `.platform.ts` suffix (replaced with `.obsidian.ts` in production builds via esbuild)
- **Development code**: Use `.dev.ts` suffix (replaced with `.prod.ts` in production)
- **Path aliases**: `@/*` maps to `src/*`, `@lib/*` maps to `src/lib/src/*`

## Code Conventions

### Internationalisation (i18n)

- **Translation Workflow**:
    1. Edit YAML files in `src/lib/src/common/messagesYAML/` (human-editable)
    2. Run `npm run bakei18n` to compile: YAML → JSON → TypeScript constants
    3. Use `$t()`, `$msg()` functions for translations
       You can also use `$f` for formatted messages with Tagged Template Literals.
- **Usage**:
    ```typescript
    $msg("dialog.someKey"); // Typed key with autocomplete
    $t("Some message"); // Direct translation
    $f`Hello, ${userName}`; // Formatted message
    ```
- **Supported languages**: `def` (English), `de`, `es`, `ja`, `ko`, `ru`, `zh`, `zh-tw`

### File Path Handling

- Use tagged types from `types.ts`: `FilePath`, `FilePathWithPrefix`, `DocumentID`
- Prefix constants: `CHeader` (chunks), `ICHeader`/`ICHeaderEnd` (internal data)
- Path utilities in `src/lib/src/string_and_binary/path.ts`: `addPrefix()`, `stripAllPrefixes()`, `shouldBeIgnored()`

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

- Settings defined in `src/lib/src/common/types.ts` (`ObsidianLiveSyncSettings`)
- Configuration metadata in `src/lib/src/common/settingConstants.ts`
- Use `this.services.setting.saveSettingData()` instead of using plugin methods directly

### Database Operations

- Local database operations through `LiveSyncLocalDB` (wraps PouchDB)
- Document types: `EntryDoc` (files), `EntryLeaf` (chunks), `PluginDataEntry` (plugin sync)

## Important Files

- [main.ts](src/main.ts) - Plugin entry point, module registration
- [esbuild.config.mjs](esbuild.config.mjs) - Build configuration with platform/dev file replacement
- [package.json](package.json) - Scripts reference and dependencies

## Beta Policy

- Beta versions are denoted by appending `-patchedN` to the base version number.
    - `The base version` mostly corresponds to the stable release version.
        - e.g., v0.25.41-patched1 is equivalent to v0.25.42-beta1.
    - This notation is due to SemVer incompatibility of Obsidian's plugin system.
    - Hence, this release is `0.25.41-patched1`.
- Each beta version may include larger changes, but bug fixes will often not be included.
    - I think that in most cases, bug fixes will cause the stable releases.
    - They will not be released per branch or backported; they will simply be released.
    - Bug fixes for previous versions will be applied to the latest beta version.
      This means, if xx.yy.02-patched1 exists and there is a defect in xx.yy.01, a fix is applied to xx.yy.02-patched1 and yields xx.yy.02-patched2.
      If the fix is required immediately, it is released as xx.yy.02 (with xx.yy.01-patched1).
    - This procedure remains unchanged from the current one.
- At the very least, I am using the latest beta.
    - However, I will not be using a beta continuously for a week after it has been released. It is probably closer to an RC in nature.

In short, the situation remains unchanged for me, but it means you all become a little safer. Thank you for your understanding!

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

- Run the `Prepare Release PR` workflow with the target version. It creates the release branch, updates versions, moves the `## Unreleased` notes to the target version, commits the release preparation, pushes the branch, and opens a draft release PR.
- Do not tag the release branch when the PR is first created. Polish the release PR first, especially `updates.md`.
- Once the release PR head is fixed, run the `Finalise Release Tags` workflow with its full head commit SHA. It validates the release branch and pushes both the plug-in tag (for example, `0.25.81`) and the CLI tag (for example, `0.25.81-cli`) to that commit.
- The plug-in tag triggers the release workflow and creates a draft GitHub Release by default. The CLI tag triggers the Docker workflow and publishes the fixed version tag, the major-minor moving tag (for example, `0.25-cli`), `latest`, and the SHA-qualified tag.
- Merge the release PR with a merge commit after the draft or pre-release has been created. This keeps the tagged release commit in the `main` history.
- If a pre-release is needed, run the `Release Obsidian Plugin` workflow manually with the target tag, `draft=false`, and `prerelease=true`.

### Release Cheat Sheet

1. Before starting, add user-facing notes under `## Unreleased` in `updates.md`.
2. Run `Prepare Release PR` from GitHub Actions.
    - `version`: the target version, for example `0.25.81`.
    - `base_branch`: normally `main`.
    - `release_branch`: leave blank to use the default branch name, for example `0_25_81`.
    - `release_date`: use an ordinal date such as `14th July, 2026`, or leave blank to use the current UTC date.
    - `allow_empty_updates`: leave disabled unless the release intentionally has no user-facing notes.
3. Review the generated draft PR.
    - Polish `updates.md`.
    - Confirm `package.json`, `manifest.json`, `versions.json`, and workspace package versions.
    - Confirm that `manifest.json` has the intended `minAppVersion`.
    - Wait for the necessary CI checks.
4. When the PR head is fixed, run `Finalise Release Tags`.
    - `version`: the same target version.
    - `release_branch`: leave blank unless the release branch used a custom name.
    - `expected_head_sha`: the full head commit SHA reviewed in the release PR.
5. Check the generated draft GitHub Release for the plug-in tag.
6. Check the CLI Docker workflow started from the `*-cli` tag.
7. Publish the draft GitHub Release when ready, then merge the release PR into `main` with a merge commit.
8. If the release should be a pre-release instead of a draft release, run `Release Obsidian Plugin` manually with the target `tag`, `draft=false`, and `prerelease=true`.

## Contribution Guidelines

- Follow existing code style and conventions
- Write integration tests (`*.integration.spec.ts` or `*.integration.test.ts`) when adding or modifying features that interact with the remote database, and ensure that they pass in the CI workflow.
- Please bump dependencies with care, check artifacts after updates, with diff-tools and only expected changes in the build output (to avoid unexpected vulnerabilities).
- When adding new features, please consider it has an OSS implementation, and avoid using proprietary services or APIs that may limit usage.
    - For example, any functionality to connect to a new type of server is expected to either have an OSS implementation available for that server, or to be managed under some responsibilities and/or limitations without disrupting existing functionality, and scope for surveillance reduced by some means (e.g., by client-side encryption, auditing the server ourselves).
