# Architectural Decision Record: Setting Definition Repository

## Status

Proposed

## Release

Not scheduled. Intended as a design direction before refactoring the settings dialogue.

## Context

The current settings dialogue is implemented around `ObsidianLiveSyncSettingTab`.
It is effective and feature rich, but several responsibilities are combined in the
same layer:

- editing-state buffering and dirty-state tracking,
- local-only dialogue state such as `configPassphrase`, `preset`, `syncMode`, and
  `deviceAndVaultName`,
- persistence through `SettingService`,
- Obsidian `Setting` component rendering,
- pane layout and visibility rules,
- validation and value coercion,
- setup wizard transitions,
- rebuild/restart side effects,
- remote diagnostics and maintenance actions.

Some setting metadata already exists in `configurationNames` and related setting
constants. This is a useful seed, but it is not a complete source of truth. The
metadata does not currently describe storage domain, value kind, validation,
capability requirements, migration behaviour, cross-setting dependencies, or
whether a value should be rendered by a generic control or a custom pane.

The settings dialogue also contains a mix of simple controls and workflow panels.
Examples:

- Simple controls: `showStatusOnEditor`, `syncOnSave`, `customChunkSize`,
  `readChunksOnline`, `useTimeouts`.
- Derived or dialogue-only values: `syncMode`, `preset`, `configPassphrase`,
  `deviceAndVaultName`.
- Workflow panels: remote configuration management, E2EE setup, setup wizard,
  local/remote rebuild, maintenance commands, Customisation Sync dialogue open.

This matters primarily for maintainability and platform independence. A setting
should have one shared definition of its domain meaning regardless of whether it
is displayed in Obsidian, surfaced in a CLI, used by a WebApp, or documented.
Tests benefit from this separation, but testability is a consequence rather than
the main design goal.

Real Obsidian E2E remains the right signal for Obsidian shell behaviour such as
opening the settings tab, rendering real Obsidian components, and verifying
user-visible workflows. Harness-based tests can then focus on deterministic
setting semantics that no longer depend on mounting the whole Obsidian setting
tab.

## Decision

Introduce a platform-neutral Setting Definition Repository as the source of
truth for setting metadata and setting semantics.

The repository should live in the shared domain layer, not under the Obsidian
dialogue implementation and not under a generic model bucket. In the current
layout this means `src/lib/src/common/settings`.

The repository should not be an Obsidian UI abstraction. It should describe what
a setting is and how it behaves. Obsidian, CLI, WebApp, tests, and documentation
can then consume the same definitions through their own renderers or adapters.
The Obsidian settings tab should use an Obsidian renderer that maps repository
definitions to native Obsidian `Setting` components for simple controls, while
workflow panes remain custom.

The existing Obsidian setting dialogue should be migrated incrementally. Complex
workflow panes should remain custom-rendered at first. Simple controls should
move to repository-driven rendering first.

## Proposed Model

Each setting definition should describe a single setting key or a dialogue-only
virtual key.

```ts
type SettingStorageDomain = "persisted" | "local" | "derived" | "ephemeral";

type SettingValueKind = "boolean" | "text" | "password" | "number" | "select" | "textarea" | "string-list" | "custom";

type SettingCapability = "database-user" | "server-admin" | "filesystem" | "obsidian-shell" | "obsidian-plugin-host";

type SettingDefinition<TSettings, TKey extends keyof TSettings | string> = {
    key: TKey;
    storage: SettingStorageDomain;
    kind: SettingValueKind;
    defaultValue?: unknown;
    labelKey: string;
    descriptionKey?: string;
    label: string;
    description?: string;
    category: string;
    pane?: string;
    section?: string;
    level?: "ADVANCED" | "POWER_USER" | "EDGE_CASE";
    status?: "BETA" | "ALPHA" | "EXPERIMENTAL";
    obsolete?: boolean;
    internal?: boolean;
    placeholder?: string;
    options?: Record<string, string>;
    secret?: boolean;
    requiredCapabilities?: SettingCapability[];
    visible?: (context: SettingEvaluationContext<TSettings>) => boolean;
    enabled?: (context: SettingEvaluationContext<TSettings>) => boolean;
    validate?: (value: unknown, context: SettingEvaluationContext<TSettings>) => SettingValidationResult;
    coerce?: (value: unknown, context: SettingEvaluationContext<TSettings>) => unknown;
    affects?: SettingEffect[];
    commit?: SettingCommitPolicy<TKey>;
    render?: "auto" | "custom";
};
```

`SettingEvaluationContext` should carry the current editing settings, persisted
settings, platform capabilities, and remote capability information if known. It
should not carry an Obsidian `App`.

`labelKey` and `descriptionKey` should be i18n keys. During migration, the key
may be the literal English text already used by `configurationNames` and
`SettingInformation`. This matches the current i18n behaviour where an unknown
key resolves to the key itself, avoids adding translation resources up front, and
lets us later replace literal keys with stable resource keys without changing
consumers. `label` and `description` remain compatibility aliases while existing
code still expects resolved strings.

`internal` should mark settings that are not currently editable from the UI.
Obsolete settings are internal by default. Missing UI metadata alone should not
make a setting internal; `kind`, `render`, and explicit `internal` metadata
should decide whether the automatic renderer can safely handle it.

`commit` should describe when a value is persisted, not how a button is rendered.
Immediate settings can save on change. Explicit settings are held in the editing
buffer until an apply action commits the configured group. This keeps apply
buttons out of the repository while still making grouped save behaviour
testable.

## Storage Domains

Settings should be classified by where they live:

- `persisted`: normal `ObsidianLiveSyncSettings` values saved through
  `SettingService`.
- `local`: values stored outside the main settings document, for example local
  storage or device/vault identity.
- `derived`: values computed from persisted settings, for example `syncMode`.
- `ephemeral`: dialogue-only inputs such as `preset`.

This makes current special cases explicit:

- `configPassphrase` is local-only.
- `deviceAndVaultName` is local/service managed.
- `syncMode` is derived from `liveSync` and `periodicReplication`.
- `preset` is ephemeral and expands to several persisted settings.

## Rendering Strategy

The repository should support generic rendering, but it should not force every
pane to become schema-driven immediately.

Use three levels:

1. **Auto-rendered controls**
   Simple `boolean`, `number`, `text`, `password`, `select`, and `textarea`
   settings. These can replace many `new Setting(...).autoWire...` calls.

2. **Repository-defined groups with custom sections**
   A pane can declare layout, headings, and order through the repository but keep
   a custom renderer for the section body.

3. **Fully custom workflow panes**
   Remote configuration management, E2EE setup, setup wizard, maintenance, and
   rebuild flows should remain custom until their side effects are separately
   modelled.

The Obsidian setting dialogue becomes a renderer of repository definitions plus a
host for custom workflow panes.

## Side Effects

Setting changes should distinguish value persistence from effects.

Examples of effects:

- `requires-local-rebuild`
- `requires-remote-rebuild`
- `requires-restart`
- `requires-apply-settings`
- `suspends-sync`
- `updates-unresolved-error-ui`
- `changes-active-remote`
- `expands-preset`

The current `isNeedRebuildLocal()` and `isNeedRebuildRemote()` methods should
eventually be replaced by repository metadata. This would make rebuild prompts
testable without rendering the full settings tab.

## Capability Requirements

Some settings and actions require capabilities that not all users or platforms
have.

Examples:

- CouchDB server diagnostics and automatic CouchDB repair require server-admin
  capability.
- Normal CouchDB sync requires only database-user capability.
- Hidden File Sync and Customisation Sync require filesystem capability.
- Obsidian plug-in reload requires obsidian-plugin-host capability.
- Opening settings panes and workspace views requires obsidian-shell capability.

Capability metadata should be used for:

- warning text in Obsidian settings,
- disabling unsupported actions,
- CLI/WebApp help output,
- Harness tests for visibility and enabled-state rules.

The repository should not introduce a generic cross-platform `PluginManager`
concept. Obsidian plug-in host behaviour should remain an Obsidian-specific
adapter or custom workflow.

## Current Assumptions to Preserve

- Settings can be edited in a buffer before being saved.
- Some values save immediately unless `holdValue` is set.
- Some values require explicit Apply buttons.
- Visibility and enabled-state often depend on other editing values.
- Some settings are hidden in setup wizard mode.
- Advanced, power-user, and edge-case levels remain supported.
- The dialogue can be reloaded while preserving dirty local edits.
- Existing `SettingService` remains responsible for encryption, persistence,
  migration, and applying settings.
- Existing complex setup and remote configuration workflows remain custom.

## Migration Plan

### Phase 1: Repository Skeleton

- Create a repository module in the shared setting domain
  (`src/lib/src/common/settings`), not under the Obsidian dialogue folder.
- Move existing `configurationNames` metadata into repository definitions without
  changing runtime behaviour.
- Add storage domain, kind, i18n keys, internal marker, pane, section, level, and
  secret metadata for a small subset of settings.
- Keep `getConfig()`, `getConfName()`, and existing callers working through a
  compatibility facade.

### Phase 2: Evaluation API

- Add pure functions:
    - `getSettingDefinition(key)`
    - `listSettingDefinitions(filter)`
    - `evaluateSetting(definition, context)`
    - `validateSettingValue(key, value, context)`
    - `getSettingEffects(changedKeys, context)`
- Add unit tests for derived values, visibility, enabled-state, validation, and
  rebuild/restart effects.

### Phase 3: Obsidian Renderer for Simple Controls

- Add a small renderer that maps repository definitions to Obsidian `Setting`
  controls.
- Migrate one low-risk pane first, likely Appearance/Logging or Advanced memory
  cache settings.
- Keep custom panes untouched.
- Keep `LiveSyncSetting` as a compatibility wrapper during migration.

### Phase 4: Derived and Local Values

- Model `syncMode`, `preset`, `configPassphrase`, and `deviceAndVaultName`
  explicitly.
- Replace ad hoc save paths in `ObsidianLiveSyncSettingTab` with storage-domain
  handlers.
- Keep user-visible behaviour unchanged.

### Phase 5: Effects and Capability Warnings

- Replace `isNeedRebuildLocal()` and `isNeedRebuildRemote()` with
  repository-driven effect calculation.
- Model explicit commit groups for settings that must be applied together, for
  example configuration encryption passphrase settings, setting sync file, and
  database suffix changes.
- Add capability metadata for CouchDB diagnostics, repair, Hidden File Sync, and
  Obsidian-only plug-in operations.
- Use this to improve warnings for database-scoped CouchDB users and
  administrator-only actions.

### Phase 6: Documentation and Non-Obsidian Consumers

- Treat documentation as an authored source, not as an output that must be fully
  generated from code.
- Optionally combine repository metadata with a documentation source such as YAML
  to generate or lint `docs/settings.md`.
- Use the repository to verify that documented settings exist, that defaults and
  storage domains are consistent, and that internal settings are intentionally
  omitted or documented as internal.
- Expose repository metadata to CLI/WebApp where useful.
- Let Harness tests assert the same repository semantics used by Obsidian.

## Testing Strategy

Use Harness or unit tests for:

- default value coverage,
- type/kind consistency,
- every persisted setting has a definition or is explicitly internal,
- visibility and enabled-state predicates,
- derived values such as `syncMode`,
- preset expansion,
- rebuild/restart effect calculation,
- capability warnings.

Use real Obsidian E2E for:

- opening the actual setting tab,
- rendering Obsidian `Setting` components,
- setup wizard flow,
- remote configuration workflow,
- actual restart prompts,
- workflows that depend on Obsidian settings shell behaviour.

## Consequences

Positive:

- Setting semantics are maintained in one platform-neutral place.
- Setting semantics become testable without mounting Obsidian UI.
- Documentation, CLI, WebApp, and Obsidian can share setting metadata where it is
  useful.
- Capability-sensitive settings become explicit.
- Future settings are less likely to be implemented in only one surface.
- The Obsidian settings dialogue can be refactored incrementally.

Negative:

- There will be a temporary compatibility layer between old setting constants and
  the repository.
- Some panes will remain custom, so the repository will not remove all UI code.
- Definition metadata can become stale if not enforced by tests.
- Over-generalising workflow panes would make the repository harder to maintain.

## Non-Goals

- Do not replace `SettingService` persistence in the first phase.
- Do not make Obsidian plug-in host operations cross-platform.
- Do not convert all setting panes to schema-driven UI at once.
- Do not require real Obsidian E2E for every setting definition.
- Do not remove custom renderers for remote setup, E2EE setup, or maintenance
  workflows.

## Open Questions

- What should the exact `CapabilityProvider` interface look like for static
  platform capabilities and runtime-probed remote capabilities? This should be
  decided while implementing the Obsidian renderer so the interface follows a
  real consumer instead of an abstract capability model.
