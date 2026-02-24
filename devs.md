# Self-hosted LiveSync Development Guide
## Project Overview

Self-hosted LiveSync is an Obsidian plugin for synchronising vaults across devices using CouchDB, MinIO/S3, or peer-to-peer WebRTC. The codebase uses a modular architecture with TypeScript, Svelte, and PouchDB.

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
    - `extras/` - Development/testing tools (e.g., `ModuleDev`, `ModuleIntegratedTest`)
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

### File Structure Conventions

- **Platform-specific code**: Use `.platform.ts` suffix (replaced with `.obsidian.ts` in production builds via esbuild)
- **Development code**: Use `.dev.ts` suffix (replaced with `.prod.ts` in production)
- **Path aliases**: `@/*` maps to `src/*`, `@lib/*` maps to `src/lib/src/*`

## Build & Development Workflow

### Commands

```bash
npm run check        # TypeScript and svelte type checking
npm run dev          # Development build with auto-rebuild (uses .env for test vault paths)
npm run build        # Production build
npm run buildDev     # Development build (one-time)
npm run bakei18n     # Pre-build step: compile i18n resources (YAML → JSON → TS)
npm test             # Run vitest tests (requires Docker services)
```

### Environment Setup

- Create `.env` file with `PATHS_TEST_INSTALL` pointing to test vault plug-in directories (`:` separated on Unix, `;` on Windows)
- Development builds auto-copy to these paths on build

### Testing Infrastructure

- **Deno Tests**: Unit tests for platform-independent code (e.g., `HashManager.test.ts`)
- **Vitest** (`vitest.config.ts`): E2E test by Browser-based-harness using Playwright
- **Docker Services**: Tests require CouchDB, MinIO (S3), and P2P services:
    ```bash
    npm run test:docker-all:start  # Start all test services
    npm run test:full              # Run tests with coverage
    npm run test:docker-all:stop   # Stop services
    ```
    If some services are not needed, start only required ones (e.g., `test:docker-couchdb:start`)
    Note that if services are already running, starting script will fail. Please stop them first.
- **Test Structure**:
    - `test/suite/` - Integration tests for sync operations
    - `test/unit/` - Unit tests (via vitest, as harness is browser-based)
    - `test/harness/` - Mock implementations (e.g., `obsidian-mock.ts`)

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

### Module Implementation

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

- Beta versions are denoted by appending `-patched-N` to the base version number.
    - `The base version` mostly corresponds to the stable release version.
        - e.g., v0.25.41-patched-1 is equivalent to v0.25.42-beta1.
    - This notation is due to SemVer incompatibility of Obsidian's plugin system.
    - Hence, this release is `0.25.41-patched-1`.
- Each beta version may include larger changes, but bug fixes will often not be included.
    - I think that in most cases, bug fixes will cause the stable releases.
    - They will not be released per branch or backported; they will simply be released.
    - Bug fixes for previous versions will be applied to the latest beta version.
      This means, if xx.yy.02-patched-1 exists and there is a defect in xx.yy.01, a fix is applied to xx.yy.02-patched-1 and yields xx.yy.02-patched-2.
      If the fix is required immediately, it is released as xx.yy.02 (with xx.yy.01-patched-1).
    - This procedure remains unchanged from the current one.
- At the very least, I am using the latest beta.
    - However, I will not be using a beta continuously for a week after it has been released. It is probably closer to an RC in nature.

In short, the situation remains unchanged for me, but it means you all become a little safer. Thank you for your understanding!

## Contribution Guidelines

- Follow existing code style and conventions
- Please bump dependencies with care, check artifacts after updates, with diff-tools and only expected changes in the build output (to avoid unexpected vulnerabilities).
- When adding new features, please consider it has an OSS implementation, and avoid using proprietary services or APIs that may limit usage.
    - For example, any functionality to connect to a new type of server is expected to either have an OSS implementation available for that server, or to be managed under some responsibilities and/or limitations without disrupting existing functionality, and scope for surveillance reduced by some means (e.g., by client-side encryption, auditing the server ourselves).
