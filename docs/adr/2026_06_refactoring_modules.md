# Architectural Decision Record: Modularity Refactoring via serviceFeature

## Status

Decided / Work in Progress

## Release

Not yet (at 26th June 2026) / Not yet tested

## Context

Previously, many modules in the codebase relied on monolithic base classes, such as 'LiveSyncCommands', 'AbstractObsidianModule', and the foundational 'AbstractModule'. These base classes implicitly granted access to a large global context, which created tight coupling, made unit testing difficult, and hampered maintenance.

While we initially considered migrating these to 'ServiceModule's, doing so would have bloated the 'ServiceModules' registry in 'ServiceHub' with features, dialogue managers, and user interface (UI) bindings that do not need to be globally accessible.

## Decision

We have decided to refactor these modules into **'serviceFeature'**s and **'ObsidianServiceFeature'**s:

1. **'serviceFeature'**: A feature (defined via `createServiceFeature`) that receives injected dependencies (such as `services` and `serviceModules`) but does not register itself onto the `ServiceHub`. State and logic are encapsulated within the function closure, providing excellent testability and loose coupling without polluting the global registry.
2. **'createObsidianServiceFeature'**: To support Obsidian-specific plug-in features that require direct access to the Obsidian application context (`app`, `plugin`, or `liveSyncPlugin`), we introduced the `createObsidianServiceFeature` helper and the `NecessaryObsidianFeature` utility type. This enables type-safe injection of the Obsidian context without casting to `any`.
3. **Core Types Relocation**: All service feature utility types (`LiveSyncCore`, `NecessaryObsidianFeature`, `ObsidianServiceFeatureFunction`, and `createObsidianServiceFeature`) were moved to [src/types.ts](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/types.ts) to prevent circular dependencies.

### State and Operation Boundaries

In early refactoring, some features placed most logic directly inside the feature closure. This kept state local, but it made detailed unit testing awkward because important decisions were only reachable through registered handlers.

The preferred pattern is now:

- Keep runtime state inside the serviceFeature instance closure.
- Define the mutable state shape explicitly with a small `create...State()` factory.
- Extract business operations into dependency-explicit functions that accept `host`, `state`, and any small collaborators such as a log function.
- Keep the `use...Feature()` entrypoint thin: create state, create collaborators, bind handlers, and return only the local API needed by neighbouring features.
- Type the `host` with the exact services and service modules used by the feature, avoiding `as any` casts.

This preserves the non-global nature of serviceFeatures while making queue merging, filtering, snapshot restoration, and error branches directly testable. These operation functions are not necessarily pure; database, storage, UI, and lifecycle effects remain explicit through injected services.

### Closure Boundary Review

The feature closure should contain state ownership and wiring, not hidden business logic. When a local function does more than bind an event, register a command, or adapt an Obsidian callback, prefer extracting it into an operation that receives `host`, `state`, and `log` explicitly.

The current review classifies the refactored features as follows:

- **Thin entrypoints**: `replicator`, `conflictResolution`, `tweakMismatch`, `globalHistory`, `obsidianDocumentHistory`, `obsidianSettingDialogue`, and `interactiveConflictResolver`.
- **Recently thinned**: `obsidianEvents` now delegates Obsidian event registration and lifecycle binding to `eventBindings.ts`, while keeping only log and state creation in `index.ts`. `migration` now delegates doctor checks, incomplete document checks, compromised chunk checks, and first-initialise sequencing to `migrationOperations.ts`.
- **Still worth follow-up extraction**: `logFeature`, `devFeature`, `obsidianSettingAsMarkdown`, and `setupManager` still contain sizeable lifecycle-local functions. They are acceptable as transitional refactors, but new work in these areas should move decision-making into operation files before adding behaviour.

Direct global logging should also be avoided in serviceFeatures. Feature-local log functions should be created from `host.services.API` and passed into operations, matching the rest of the dependency-explicit pattern.

### File Naming

Files whose primary export is a class keep the class-oriented `CamelCase.ts` name. Files that contain only functions, or contain multiple cooperating exports rather than one primary class, use `snakeCase.ts`. For example, the replication result processor is implemented as functional operations and is therefore stored as `replicateResultProcessor.ts`, while its exported types may still use `ReplicateResultProcessor...` names.

## Implementation Details

### Phase 1: Core Commands ('LiveSyncCommands' Inheritors)

These contain significant state and business logic. They have been refactored into functional serviceFeature modules under `src/serviceFeatures/`:

- **[hiddenFileSync/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/hiddenFileSync/)**: Split monolithic file tracking and state variables into focused functional files.
- **[configSync/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/configSync/)**: Decoupled periodic synchronisation, customisation scanning, and commands.
- **[databaseMaintenance/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/databaseMaintenance/)**: Refactored garbage collection, compaction, and diagnostics into dependency-explicit operations.

### Phase 2: Obsidian UI & Events ('AbstractObsidianModule' Inheritors)

These modules handle Obsidian-specific event bindings, UI registrations (views, dialogue modals, and ribbon commands), and user preferences. They have been refactored into 'ObsidianServiceFeature' functions:

- **[obsidianEvents/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/obsidianEvents/)**: Decoupled reload scheduling, save command overrides, window visibility handlers, and Obsidian event lifecycle bindings.
- **Stateless UI/Command Registrars**:
    - `ModuleInteractiveConflictResolver` -> [interactiveConflictResolver/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/interactiveConflictResolver/)
    - `ModuleObsidianDocumentHistory` -> [obsidianDocumentHistory/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/obsidianDocumentHistory/)
    - `ModuleGlobalHistory` -> [globalHistory/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/globalHistory/)
    - `ModuleLog` -> [logFeature/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/logFeature/)
    - `ModuleObsidianSettingTab` -> [obsidianSettingDialogue/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/obsidianSettingDialogue/)
    - `ModuleDev` -> [devFeature/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/devFeature/)
- **Obsidian-Specific Tools**:
    - `ModuleObsidianMenu` -> [obsidianMenu/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/obsidianMenu/)
    - `ModuleObsidianSettingsAsMarkdown` -> [obsidianSettingAsMarkdown/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/obsidianSettingAsMarkdown/)
    - `SetupManager` -> [setupManager/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/setupManager/)
    - `ModuleMigration` -> [migration/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/migration/) with migration decisions extracted into dependency-explicit operations.

### Phase 3: Core Modules Evaluation

Foundational modules (replicators and conflict resolver engines) will be evaluated in subsequent stages to decide if they should be true services on 'ServiceHub' or standalone features.

The replication result processor is classified as a standalone serviceFeature rather than a ServiceHub service. It owns local runtime state for queued and in-progress replication results, but it is only used by the replicator feature. Its processing logic should therefore be implemented as dependency-explicit operations over a typed host and local state, with the feature entrypoint wiring it into replication and database lifecycle handlers.

## Consequences

- **Encapsulated State**: Key state variables now live safely in feature closures rather than as global class properties.
- **Improved Testability**: We introduced robust unit test suites (`*.unit.spec.ts`) for all newly refactored features. Features can be easily tested by injecting mocked services and modules.
- **Eliminated Global Pollution**: The 'ServiceHub' remains lightweight, only carrying services that must be globally shared.
- **Type Safety**: Obsidian-specific contexts (`app`, `plugin`, and `liveSyncPlugin`) are strictly typed through the `NecessaryObsidianFeature` shape, minimising unsafe type assertions.
