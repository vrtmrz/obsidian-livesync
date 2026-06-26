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

## Implementation Details

### Phase 1: Core Commands ('LiveSyncCommands' Inheritors)

These contain significant state and business logic. They have been refactored into pure functional modules under `src/serviceFeatures/`:
- **[hiddenFileSync/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/hiddenFileSync/)**: Split monolithic file tracking and state variables into focused functional files.
- **[configSync/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/configSync/)**: Decoupled periodic synchronisation, customisation scanning, and commands.
- **[databaseMaintenance/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/databaseMaintenance/)**: Refactored garbage collection, compaction, and diagnostics into pure modules.

### Phase 2: Obsidian UI & Events ('AbstractObsidianModule' Inheritors)

These modules handle Obsidian-specific event bindings, UI registrations (views, dialogue modals, and ribbon commands), and user preferences. They have been refactored into 'ObsidianServiceFeature' functions:
- **[obsidianEvents/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/obsidianEvents/)**: Decoupled reload scheduling, save command overrides, and window visibility handlers.
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
  - `ModuleMigration` -> [migration/](file:///p:/plant25/obsidian/projects/obsidian-livesync/src/serviceFeatures/migration/)

### Phase 3: Core Modules Evaluation

Foundational modules (replicators and conflict resolver engines) will be evaluated in subsequent stages to decide if they should be true services on 'ServiceHub' or standalone features.

## Consequences

- **Encapsulated State**: Key state variables now live safely in feature closures rather than as global class properties.
- **Improved Testability**: We introduced robust unit test suites (`*.unit.spec.ts`) for all newly refactored features. Features can be easily tested by injecting mocked services and modules.
- **Eliminated Global Pollution**: The 'ServiceHub' remains lightweight, only carrying services that must be globally shared.
- **Type Safety**: Obsidian-specific contexts (`app`, `plugin`, and `liveSyncPlugin`) are strictly typed through the `NecessaryObsidianFeature` shape, minimising unsafe type assertions.
