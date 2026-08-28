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

#### Community Review dependency installation

Community Review installs dependencies independently before applying type-aware source rules. A successful installation with the npm version bundled with the repository's current Node.js CI does not prove that the lockfile is accepted by the scanner's npm version.

After changing `package.json`, a workspace manifest, or `package-lock.json`, verify both installation paths:

```bash
npm ci --ignore-scripts
npx --yes npm@10.9.2 ci --ignore-scripts
```

The npm 10.9.2 command is the current project-side compatibility check for the Community Review installation path. Update this check when the scanner runtime changes.

If Community Review reports widespread TypeScript `error` types across unrelated external packages, confirm that dependency installation completed successfully before changing source imports, declarations, or lint rules. An installation failure can make every unresolved external type appear as downstream unsafe-type findings.

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
npm run test:browser-apps                # Build and run the WebApp and WebPeer app-owned Chromium tests
npm run test:e2e:browser-apps:interop    # Run WebApp → WebPeer → CLI in Compose
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

- **Vitest**:
    - **Unit Tests** (`vitest.config.unit.ts`): Unit tests run in Node.js (excluding harnesses and integration tests). Unit tests should be `*.unit.spec.ts` and placed alongside the implementation file (e.g., `ChunkFetcher.unit.spec.ts`). Executed via `npm run test:unit`.
    - **Integration Tests** (`vitest.config.integration.ts`): Tests run in Node.js against a real CouchDB instance. Integration tests should be `*.integration.spec.ts` or `*.integration.test.ts` and placed alongside the implementation file (e.g., `StreamingFetch.integration.spec.ts`). Executed via `npm run test:integration`.
        - If you add a feature that interacts with the remote database (e.g., replication changes, custom changes feed parameters, or custom HTTP queries), you are strongly expected to write an integration test to verify the behaviour against a real CouchDB server.
    - **Commonlib Tests**: Commonlib owns unit and package tests for shared RPC, storage, replication, and platform contracts. LiveSync CI verifies the exact packed dependency as a downstream consumer.

Regression tests remain in the suite owned by the implementation under test. Plug-in tests may be co-located with their source, while independent application tests remain under `test/apps/` or `test/browser-apps/` so that they stay outside the Community Review source boundary. Prefix a case or group with `compatibility:` when it protects a persisted input or state which current releases still accept, and with `retirement guard:` when it prevents a removed setting, control, or notification from returning. Remove or replace a compatibility case only when the corresponding input is no longer accepted or an equivalent maintained case preserves the contract. Remove a retirement guard only when another current contract makes the old behaviour unreachable. Do not preserve a disconnected historical test as an executable specification when no maintained runner invokes it; Git history is the reference for retired test infrastructure.

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
    - `test/apps/webapp/` and `test/apps/webpeer/` - app-owned unit tests outside the Community Review source boundary
    - `test/browser-apps/webapp/` and `test/browser-apps/webpeer/` - app-owned Deno and Chromium tests outside the Community Review source boundary
    - `test/browser-apps/` - Compose-owned WebApp → WebPeer → CLI P2P interoperability and shared browser-test support
    - co-located `*.unit.spec.ts` files - Node-based unit tests
    - co-located `*.integration.spec.ts` files - service-backed integration tests

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

### Service composition and legacy modules

The application is composed from Services, ServiceModules, serviceFeatures, and a legacy module layer:

- **Service Hub**: the long-lived registry of service contracts. A simple extension, such as a check before replication, belongs in an existing Service handler.
- **ServiceModule**: a host-created, long-lived stateful or resource-owning capability shared through the typed `ServiceModules` record. Current examples include storage access, file handling, and database rebuilding.
- **serviceFeature**: a typed composition function which accepts only its declared Services and ServiceModules. It registers lifecycle handlers, commands, UI bindings, or other host glue, and may return a focused view or controller. It is not a runtime registry entry.
- **AbstractModule** and **AbstractObsidianModule**: the legacy application module layer. Existing modules are loaded by the application and bound after the Service graph has been composed; this broad core access is not the preferred dependency boundary for new orchestration.

The normal composition order is the Service Hub, replicator-provider registration, ServiceModules, serviceFeatures, add-ons, and finally legacy module binding. A serviceFeature may therefore consume an already constructed ServiceModule. Preferring a serviceFeature for new composition is a dependency-boundary rule, not an initialisation-order rule.

Mutable state is permitted in a serviceFeature. State alone is not a reason to create a ServiceModule or retain an AbstractModule. Separate the component which owns state, transitions, and invariants from the surrounding function which registers lifecycle handlers and connects downstream effects. Give the stateful component narrow collaborators rather than `LiveSyncBaseCore`. Use a ServiceModule when the same operational capability or resource lifecycle must be shared explicitly by several consumers.

Commonlib's `targetFilter.ts` and `prepareDatabaseForUse.ts` demonstrate the intended split: focused factories or operations own their private state and behaviour, while the corresponding `use...` function composes dependencies and registers handlers. The P2P composition follows the same direction at a larger scale by separating durable policy and room-session ownership from host lifecycle and UI wiring. Existing modules do not apply this boundary consistently; improve the affected boundary when changing their behaviour rather than performing an unrelated mechanical conversion.

Use interaction-based, London School unit tests for the composition boundary. Verify collaborator calls, ordering, failure short-circuiting, and handler registration, then test the focused state owner for its transitions and invariants. If a test needs a broad core fixture, deep mock chains, or unrelated Services, treat that friction as a design-review signal before adding more test machinery.

Legacy modules remain grouped by directory:

- `core/` contains platform-independent core behaviour;
- `coreObsidian/` contains Obsidian-specific core behaviour;
- `essential/` contains required modules;
- `features/` contains optional features; and
- `extras/` contains development and testing tools.

### Key Architectural Components

- **LiveSyncLocalDB** (`@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB`): Local PouchDB database wrapper
- **Replicators** (`@vrtmrz/livesync-commonlib/compat/replication/*`): CouchDB, Journal, and P2P synchronisation engines
- **Service Hub** (`src/modules/services/`): Central service registry using dependency injection
- **Common Library** (`@vrtmrz/livesync-commonlib`): Platform-independent synchronisation logic, shared with the CLI, WebApp, WebPeer, and external tools

Commonlib owns one stable `LiveSyncP2PService`, its `P2PRoomSessionOwner`, and the replaceable Trystero room session. Host commands, event handlers, and views consume the focused transport, directory, admission, transfer, change-relay, configuration, and diagnostic views returned by the service feature. They must not retain the deprecated compatibility Replicator as an ordinary service locator, close Trystero-owned raw peers, or install another Trystero transport generation at the application root. The exact as-built ownership and shutdown boundaries are recorded in Commonlib's `docs/p2p-transport-lifecycle.md` design document.

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
- Obsidian may request declarative definitions immediately from
  `Plugin.addSettingTab()`. Register a settings tab which reads persisted values
  from the sequential `onSettingLoaded` lifecycle, seed its editing snapshot
  before registration, and keep definition construction independent of local
  database and replicator readiness. See
  [the declarative settings adapter ADR](docs/adr/2026_08_declarative_settings_adapter.md).
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
- Keep a hyphenated pre-release's release pull request in draft and unmerged after BRAT validation. Reconcile the published version's metadata into its base branch through a reviewed metadata-only commit, then close the release pull request only through a separate maintainer action.
- Stage a stable version for BRAT by publishing its exact `x.y.z` tag initially as a GitHub pre-release with `prerelease=true` and `publish_cli=false`. The stable manifest version would otherwise make the CLI workflow advance `latest` and the major-minor image tag before validation.
- After a staged stable version passes BRAT validation, remove the GitHub pre-release designation and make the exact release the latest stable release first. Confirm that promotion, then merge its exact release commit into the reviewed base branch and integrate it through the reviewed branch chain into the repository's default branch. This order prevents Community Directory review from inspecting a stable manifest version while the matching GitHub Release remains a pre-release. Publish stable CLI tags through a separate maintainer gate.
- If validation fails, leave every published tag unchanged and prepare the next pre-release or patch version.

## Release Notes

- Keep the top section of `updates.md` as `## Unreleased` during normal development.
- When opening a feature or fix PR, update `## Unreleased` in the same PR if the change is user-facing.
- Add only user-facing changes that help users understand what they gain, what has changed, or what they may need to do after updating.
- Avoid listing purely internal refactors, maintenance chores, generated-file changes, and dependency updates unless they affect users; group and label them when they are included.
- When preparing a release, replace `## Unreleased` with the target version heading (for example, `## 0.25.81`) and add a fresh empty `## Unreleased` section above it for the next cycle.
- Review and polish the released section in the release PR before tagging, because the content is embedded into the plug-in and may be reused as the GitHub Release notes.
- Keep approximately the five most recent published plug-in versions in the embedded `updates.md`. Move older published sections unchanged into the appropriate release-line archive under `docs/releases/`, and update the history references when rotating them.

## Release Workflow

This workflow is for maintainers. Contributors should update `## Unreleased` for user-facing feature or fix PRs, but do not need to run the release workflows.
The `Finalise Release Tags` and `Release Obsidian Plugin` workflows use the `release` GitHub Environment. Configure Environment protection in the repository settings so tag creation and release publication require maintainer approval.

- Run the `Prepare Release PR` workflow with the target version and selected base branch. It creates the release branch, updates versions, confirms that Commonlib is locked to an immutable package version, moves the `## Unreleased` notes to the target version, commits the release preparation, pushes the branch, and opens a draft release PR. The base branch may already select the target development version; the workflow still runs the version lifecycle so that release-only metadata such as `versions.json` is recorded in the release commit.
- Do not tag the release branch when the PR is first created. Polish the release PR first, especially `updates.md`.
- Once the release PR head is fixed, run the `Finalise Release Tags` workflow with its full head commit SHA. It validates the release branch, ensures that the plug-in tag points to that commit, optionally creates the corresponding CLI tag, and explicitly dispatches the selected plug-in and CLI release workflows. The finalisation workflow can be retried when existing tags already point to the reviewed commit, but stops if a selected tag points elsewhere.
- The plug-in publishing workflow is intentionally dispatch-only. Pushing a plug-in tag directly does not publish a GitHub Release; use `Finalise Release Tags`, or dispatch `Release Obsidian Plugin` explicitly for recovery or a pre-release. When CLI publication is selected, finalisation dispatches the CLI Docker workflow against the reviewed CLI tag instead of relying on a tag created by `GITHUB_TOKEN` to start another workflow.
- For a hyphenated pre-release, run finalisation with `prerelease=true`; CLI publication remains optional. For a stable version awaiting BRAT validation, use `prerelease=true` and `publish_cli=false`.
- Approve the `Release Obsidian Plugin` workflow for the `release` environment, then inspect the generated draft GitHub Release. When a hyphenated pre-release includes the CLI, confirm that it received only its immutable version and SHA-qualified image tags.
- Publish the draft as a GitHub pre-release without replacing the latest stable release. Keep its release pull request in draft and leave its base branch unchanged throughout BRAT validation. Record that state in the pull request.
- Validate the published release through BRAT. Confirm start-up, ordinary bidirectional synchronisation, and any regression scenario relevant to the release.
- After a hyphenated pre-release passes, keep its release pull request unmerged. Add a reviewed metadata-only commit to the selected base branch which records the published version in `versions.json` and moves its exact tagged release notes out of `## Unreleased`, then close the release pull request only through a separate maintainer action.
- After a stable version passes, remove the GitHub pre-release designation and make that exact release the latest stable release. Confirm that the release is no longer a pre-release, then mark its release pull request ready, merge the exact release commit into the selected base branch with a merge commit, and integrate that exact commit through the reviewed branch chain into the repository's default branch. Confirm that the default branch contains the matching stable metadata. Create the stable CLI tag and publish its `latest` and major-minor image tags, if selected, through a separate maintainer gate.
- If BRAT validation fails, keep the release PR in draft and do not move published tags. Before preparing the next version, add a reviewed metadata-only commit to the selected base branch which records the published version in `versions.json` and moves its exact tagged release notes out of `## Unreleased`. Keep only changes made after that tag under `## Unreleased`. Compare the historical section with `git show <tag>:updates.md`; do not merge the failed release PR or describe it as validated. The next release PR can then rotate only the correction notes while preserving the immutable release history.
- Prepare and publish the next patch or pre-release version from that reconciled base. Leave the failed release PR draft until it is deliberately closed as superseded under a separate maintainer action.
- A hyphenated version is rejected unless `prerelease=true`. A stable version staged with `prerelease=true` is rejected unless `publish_cli=false`.

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
    - `prerelease`: enable for a version such as `1.0.0-rc.0`, and also when staging a stable version for BRAT.
    - `publish_cli`: optional for a hyphenated pre-release, but disable it when staging a stable version.
5. Approve the `Release Obsidian Plugin` workflow for the `release` environment, then check the generated draft GitHub Release.
6. If a hyphenated pre-release includes the CLI, confirm that the explicitly dispatched CLI workflow published only immutable version and SHA-qualified image tags.
7. Publish the draft as a GitHub pre-release without replacing the latest stable release, but keep the release PR in draft and leave its base branch unchanged.
8. Update the PR state message to describe the published pre-release and state that merging remains on hold.
9. Validate the published release through BRAT, including start-up, ordinary bidirectional synchronisation, and any release-specific regression scenario.
10. After a hyphenated pre-release passes, keep its release PR unmerged, reconcile its `versions.json` entry and exact release-note section into the selected base branch as metadata only, then close the PR through a separate maintainer action.
11. After a stable version passes, remove the pre-release designation and make the exact release the latest stable release. Confirm that promotion, then mark the release PR ready, merge the exact release commit into the selected base branch, and integrate it through the reviewed branch chain into the repository's default branch. Confirm that the default branch contains the matching stable metadata, then publish stable CLI tags through a separate maintainer gate if selected.
12. If validation fails, leave the PR in draft and do not move the published tags. Reconcile the published version's `updates.md` section and `versions.json` entry into the base branch as metadata only, then prepare the next patch or pre-release version from the remaining `## Unreleased` entries.

## Contribution Guidelines

- Follow existing code style and conventions
- Write integration tests (`*.integration.spec.ts` or `*.integration.test.ts`) when adding or modifying features that interact with the remote database, and ensure that they pass in the CI workflow.
- Please bump dependencies with care, check artifacts after updates, with diff-tools and only expected changes in the build output (to avoid unexpected vulnerabilities).
- When adding new features, please consider it has an OSS implementation, and avoid using proprietary services or APIs that may limit usage.
    - For example, any functionality to connect to a new type of server is expected to either have an OSS implementation available for that server, or to be managed under some responsibilities and/or limitations without disrupting existing functionality, and scope for surveillance reduced by some means (e.g., by client-side encryption, auditing the server ourselves).
