---
date: 2026-08-25
commonlib-version: "0.1.19"
self-hosted-livesync-version: "1.0.18"
status: accepted
---

# Architectural Decision Record: Adapt Standard Settings to Obsidian's Declarative API

## Status

Accepted and implemented through Stage C1 and two bounded Stage C2
landing-page improvements. The shared specification remains deliberately
limited to one-key, immediately persisted controls. Complex pages retain their
existing renderers instead of being forced through a general abstraction.

## Context

Obsidian 1.13 introduced declarative plug-in settings through
`PluginSettingTab.getSettingDefinitions()`. Declarative definitions are used for
native rendering, validation, navigation, and global settings search. When the
method returns a non-empty array, Obsidian does not call the existing
`display()` implementation.

Self-hosted LiveSync still supports Obsidian versions before 1.13 through its
`minAppVersion` of 1.7.2. It must therefore retain an imperative `display()`
fallback unless the minimum supported Obsidian version is raised separately.
Maintaining an unrelated declarative definition and imperative implementation
for each setting would allow the two interfaces to drift.

The current `LiveSyncSetting` AutoWire implementation combines several
responsibilities:

- Commonlib setting metadata supplies setting names, descriptions, maturity, and
  configuration level;
- pane functions decide page and group membership, control type, options, and
  conditional visibility;
- `LiveSyncSetting` creates and updates Obsidian DOM components;
- `ObsidianLiveSyncSettingTab` owns an editing buffer, dirty state, local and
  persisted settings, and save operations; and
- selected controls add staged Apply behaviour, derived values, or effects
  which run after a successful save.

These responsibilities are not all declarative setting data. In particular,
Remote Configuration, Hatch, Maintenance, Help, and Selector contain dynamic
lists, Svelte components, diagnostic results, multi-step actions, and
destructive confirmations. Encoding those interactions in a general settings
DSL would increase the abstraction before a second renderer had proved which
parts are genuinely shared.

Commonlib's `SettingInformation` setting metadata contains more entries than
the current settings interface exposes. Generating definitions from all of it
would therefore make compatibility or internal settings searchable merely
because they have labels. Page membership must remain an explicit LiveSync
decision.

The existing legacy settings wizard also changes DOM classes and selects panes
through `enableMinimalSetup()`. The maintained onboarding path now uses
`SetupManager`. The current call graph has no caller for
`askAgainForSetupURI()`: it is the only emitter of
`EVENT_REQUEST_OPEN_SETTING_WIZARD`, and that event's only handler calls
`enableMinimalSetup()`. The old route is therefore obsolete rather than a
second onboarding interface which the declarative renderer must preserve.
Historically, it was the second prompt after a user reported having no Setup
URI. It offered the in-settings wizard, P2P setup, manual settings, or a reminder
at the next launch, then stopped initialisation while the selected interface
took over. `SetupManager` now owns that decision and continuation.

## Decision

### Retire the obsolete in-settings wizard first

The old in-settings wizard will be removed as a focused prerequisite. This is
cleanup of an unreachable interface, not part of the declarative settings
model. The cleanup will remove:

- `askAgainForSetupURI()`, `EVENT_REQUEST_OPEN_SETTING_WIZARD`, its handler, and
  `enableMinimalSetup()`;
- the `inWizard` completion branch in Sync Settings;
- the `isWizard`, `wizardHidden`, and `wizardOnly` styling contract;
- the General-page `Next` control and the already commented Remote
  Configuration `Next` control;
- the now-unnecessary `wizardHidden` argument on the old pane builder; and
- message keys whose final production consumer is the removed route, followed
  by the normal catalogue regeneration.

This cleanup does not affect `SetupManager`, Setup URI onboarding, QR-code
navigation, document-history navigation, or any other control which happens to
use the word 'Next'. The existing onboarding and ordinary settings E2E paths
must pass before the declarative work begins.

The English quick-setup documentation already describes the maintained
onboarding. Older localised quick-setup pages which still describe the removed
interface are documentation maintenance rather than a prerequisite for this
runtime cleanup.

### Use one explicit page catalogue

LiveSync will define one ordered page catalogue. It will be the sole source for
page identity, name, configuration level, visibility, and content ownership.
Each entry keeps the existing pane renderer for the legacy path and selects one
of two native content forms:

```typescript
type SettingsPageEntry = {
    id: string;
    name: () => string;
    icon: string;
    order: number;
    level?: ConfigLevel;
    content: "native" | "custom";
    legacy: PaneRenderer;
};
```

In Stage C1, `native` identifies the Advanced proof page, whose definitions are
supplied by the adapter, and `custom` selects the shared lazy custom-page
factory. The catalogue will gain a per-page native factory only when a second
native page requires one; Stage C1 does not introduce that abstraction in
advance.

A native `items` page may mix groups of `SettingSpec` controls with Obsidian's
direct action, render, list, and nested-page definitions. A native custom
`SettingPage` is the final escape hatch when the page cannot yet be divided
safely. The imperative and declarative interfaces consume the same catalogue:

| Catalogue content                     | Obsidian before 1.13             | Obsidian 1.13 and later                    |
| ------------------------------------- | -------------------------------- | ------------------------------------------ |
| Standard `SettingSpec`                | Render through `LiveSyncSetting` | Convert to a control definition            |
| Native group, action, or rendered row | Use the existing pane renderer   | Use `SettingDefinitionPage.items`          |
| Full custom page                      | Use the existing pane renderer   | Open a lazily created custom `SettingPage` |

This makes page names and visibility consistent without requiring every page
to migrate at once. Page names must be unique because Obsidian uses them for
nested navigation.

`SettingDefinitionPage` does not expose a separate icon field. The declarative
renderer therefore prefixes each native page name with the emoji already held
by the catalogue, while the imperative renderer continues to pass the same
emoji to its existing menu button. This preserves the established visual
identity without adding host-DOM manipulation.

`SettingDefinitionGroup` likewise exposes only a string heading. Root groups
therefore have semantic identifiers whose catalogue entries keep their emoji
and late-translated names separate. The adapter combines those fields only
when constructing the Obsidian definition, so callers select a group by its
identifier instead of repeating presentation strings.

### Compose the native landing page around common tasks

The declarative root is a composition of native groups and catalogue pages,
not a second flat copy of the legacy tab menu. General Settings contains the
native Appearance, Logging, and Extra menus child pages. Their standard
`SettingSpec` controls remain searchable without crowding the root. The small
Quick Setup actions are native action rows on the root. The old Setup child
page is not retained: its feature-level controls move to Extra menus, its full
reset moves to Maintenance, and its online guidance becomes Help and
troubleshooting. The pane-based interface exposes Quick Setup as a pane and
renders the same controls within General Settings.

Remote Configuration and Sync Settings remain catalogue pages. Obsidian's
native group contract permits navigable pages as group items, so both pages are
placed inside an explicit Synchronisation group. This keeps them near the top
for narrow mobile displays while preventing the unheaded page entries from
appearing to continue the preceding Quick Setup group. The root order reflects
the current task:

| Current state               | First root sections                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Synchronisation is inactive | Quick Setup, Synchronisation (Remote Configuration and Sync Settings), then General |
| Synchronisation is active   | Synchronisation (Remote Configuration and Sync Settings), General, then Quick Setup |

Set up other devices follows the Quick Setup and General groups when the
plug-in is configured. The remaining destinations are grouped explicitly:

| Group                    | Pages                                    |
| ------------------------ | ---------------------------------------- |
| Maintenance and recovery | Maintenance and Hatch                    |
| Extra features           | Selector and Customisation sync          |
| Advanced settings        | Advanced, Power users, and Patches       |
| Help and information     | Help and troubleshooting, and Change Log |

This prevents Obsidian from presenting them as one undifferentiated 'Detailed
settings' continuation. Changing a setting which can move or reveal a page
requests a catalogue refresh after persistence. External setting reloads use
the same boundary. Constructing the definitions still performs no persistence,
service, file, database, or network operation.

The imperative renderer retains its existing default-page selection: Quick Setup for
an inactive configuration and General for an active configuration. The landing
composition is therefore a native 1.13 improvement rather than a behaviour
change for earlier supported Obsidian versions.

The custom `SettingPage` adapter class will be constructed lazily from the
1.13-or-later path. `SettingPage` may remain a normal runtime import because the
bundle reads Obsidian exports through its namespace object, but the import must
not be subclassed or instantiated while the module is loading. The factory
will first use `requireApiVersion("1.13.0")`, then verify that `SettingPage` is
available. Older supported Obsidian versions therefore continue to call the
imperative `display()` fallback without requiring a dynamic import or a
polyfill for host behaviour which does not exist in those versions.

The adapter sets `title` from the catalogue and renders pane content into the
host-provided `containerEl`. Its `hide()` boundary will unload the page-owned
`Component`, unmount Svelte and markdown content, and remove page-owned update
handlers. The parent tab's `hide()` remains a final cleanup boundary because
Obsidian does not guarantee a page-level `hide()` call when the host window is
destroyed.

Custom pages receive only the current page's `containerEl` and the existing
`addPanel` helper. They do not recreate the old top-level tab menu inside each
native page.

### Prefer native groups and searchable rows to full custom pages

An existing `addPanel` section maps naturally to a
`SettingDefinitionGroup`. Within that group:

- ordinary value controls use `SettingSpec`;
- a simple button operation may use `SettingDefinitionAction` directly;
- a Svelte control or a specialised Obsidian row uses
  `SettingDefinitionRender` and returns its cleanup callback; and
- a truly dynamic collection may use `SettingDefinitionList` when its existing
  behaviour already matches the list contract.

These Obsidian-specific definitions are written directly in the page adapter.
They are not added to the shared `SettingSpec` vocabulary. This keeps the shared
model small while allowing page, panel, and row names, descriptions, and aliases
to participate in settings search.

Search indexes the metadata on a definition; it does not infer searchable
entries from arbitrary DOM created inside a `render` callback. A whole panel
wrapped in one rendered row therefore provides panel-level search only.
Individual controls or actions require individual standard, action, or render
definitions when control-level search is worthwhile.

A full custom `SettingPage` remains acceptable for a workflow which cannot yet
be split without nesting several existing setting rows inside one synthetic
row. It is a compatibility escape hatch, not the default representation for
every complex pane.

### Keep `SettingSpec` intentionally small

`SettingSpec` describes only controls which have all of the following
properties:

- one explicit persisted setting key, excluding keys from `OnDialogSettings`;
- one standard toggle, number, or dropdown control in the first proof page;
- a value which is read from the current editing buffer;
- a change which can be persisted immediately through the existing
  `saveSettings([key])` path; and
- no additional operation which must run after saving.

A representative, key-safe shape is:

```typescript
type PersistedBooleanSettingKey = Exclude<AllBooleanItemKey, keyof OnDialogSettings>;
type PersistedStringSettingKey = Exclude<AllStringItemKey, keyof OnDialogSettings>;
type PersistedNumericSettingKey = Exclude<AllNumericItemKey, keyof OnDialogSettings>;
type PersistedSettingKey = PersistedBooleanSettingKey | PersistedStringSettingKey | PersistedNumericSettingKey;

type SettingSpecBase<K extends PersistedSettingKey, C> = {
    key: K;
    control: C;
    visible?: () => boolean;
    disabled?: () => boolean;
    aliases?: string[];
};

type SettingSpec =
    | SettingSpecBase<PersistedBooleanSettingKey, { type: "toggle"; defaultValue?: boolean }>
    | SettingSpecBase<
          PersistedNumericSettingKey,
          {
              type: "number";
              min?: number;
              max?: number;
              allowZero?: boolean;
          }
      >
    | SettingSpecBase<
          PersistedStringSettingKey,
          {
              type: "dropdown";
              options: () => Record<string, string>;
          }
      >;
```

The initial union contains only the three control types used by the Advanced
proof page. Text and textarea controls will be added when a migrated page
provides a concrete use for them. Number validation is derived from `min`,
`max`, and `allowZero`, so the native and imperative renderers enforce the same
constraints without introducing an arbitrary validation language.

Names, descriptions, maturity labels, and placeholders come from the translated
Commonlib setting metadata by default. The native renderer appends the existing
maturity marker to `name`, and maps the description and supported placeholder
directly. Configuration level remains a page and renderer concern: the legacy
renderer retains its existing DOM classes, while the native page catalogue owns
page-level visibility. A mixed-level native group must provide an explicit
visibility predicate at that boundary rather than inferring one in the pure
control converter. The specification may override a label only where the
current interface already uses a deliberate product-specific label. Options
remain LiveSync owned because they can depend on the active remote, platform,
or language. A control which needs the current obsolete-row styling remains
custom because the native definition does not provide an equivalent per-row
class contract.

The catalogue explicitly lists each exposed key. It does not enumerate
`SettingInformation` automatically.

The following behaviours are outside the standard specification and remain a
custom row or custom page:

- `holdValue` and Apply buttons;
- `invert` bindings;
- password inputs;
- a control which maps one displayed value to several stored keys, such as
  `syncMode`;
- a control whose save effect cannot remain an explicit tab-owned handler;
- button clusters, dynamic lists, Svelte components, rich diagnostic output,
  or destructive actions; and
- styling which exists only to support the old wizard or tab menu.

This is a migration boundary, not a permanent prohibition. A second concrete
use may justify a focused extension, but the first implementation will not add
a generic action language, transaction language, or lifecycle hook system.

### Retain the existing editing and persistence owner

`ObsidianLiveSyncSettingTab` remains the owner of editing values and saves. The
first implementation will expose a small adapter over its existing methods
rather than move settings persistence into a new service.

For declarative controls:

- `getControlValue(key)` reads `editingSettings[key]`;
- `setControlValue(key, value)` resolves an explicitly registered standard
  specification, updates the editing value, and calls `saveSettings([key])`;
- successful saves continue to pass through `saveLocalSetting()` or
  `services.setting.saveSettingData()` as appropriate; and
- the tab calls `refreshDomState()` after a value changes when another
  definition's `visible` or `disabled` predicate can depend on it.

An unknown key is an implementation error. The adapter must not fall through
to `plugin.settings`, because LiveSync does not use that conventional storage
shape.

Specification construction and `getSettingDefinitions()` must remain cheap
and side-effect free. Obsidian calls the method during search indexing and
again on updates; it must perform no file, database, network, or settings
write.

### Give imperative pages an explicit lifetime and refresh boundary

The present `display()` renders every pane together, so arrays of
`settingComponents`, controlled DOM updates, and `onSavedHandlers` can be
cleared and rebuilt as one unit. Native page navigation mounts one custom page
at a time. Reusing those arrays without a page boundary would leak updates from
a hidden page or remove effects which a staged edit still needs.

Each imperative render will therefore receive a small page scope containing:

- its `Component` lifetime;
- its `LiveSyncSetting` instances;
- its controlled DOM update functions; and
- its explicit cleanup callbacks for Svelte, markdown, and other mounted
  content.

The legacy `display()` fallback uses one scope for the complete old tab. A
custom declarative page creates one scope when opened and disposes it when
hidden. This scope is renderer state and is not part of `SettingSpec`.
Pane-construction callbacks which are queued by the existing helpers run only
whilst the scope which requested them remains current. Closing or replacing a
page therefore cannot attach delayed controls or cleanup callbacks to its
successor.

Saved-setting effects remain owned by the tab session, not by a DOM page. The
existing handlers are unique by setting key, so `addOnSaved()` will replace the
handler for that key instead of appending duplicate closures when a page is
reopened. A later migration may declare those effects in a separate catalogue,
but they will not be added to the standard control specification merely to
support page navigation.

Direct calls to `this.display()` from pane code and the tab's own reload path
will be replaced by an explicit refresh request with one of two scopes:

- `page` re-renders the active custom page, or the legacy tab; and
- `catalogue` calls the declarative tab's `update()` so translated page names,
  page visibility, and search definitions are rebuilt, or re-renders the
  legacy tab.

Changing the display language or the Advanced, Power User, or Edge Case mode
uses a catalogue refresh. Dynamic Selector rows, Maintenance status, and
Hidden File Sync status use a page refresh. This keeps the renderer choice out
of pane actions and prevents a direct `display()` call from replacing native
declarative navigation.

### Preserve imperative rendering as a renderer

The existing AutoWire calls are not the shared model. Instead,
`LiveSyncSetting` becomes the legacy renderer for `SettingSpec` where a pane
has migrated. It continues to own DOM classes, dirty-value decoration, and
component updates for older Obsidian versions.

Unmigrated pane functions continue to call `LiveSyncSetting` directly inside a
custom page. This allows incremental migration without first rewriting their
behaviour.

The initial implementation must not modify Commonlib's setting metadata.
Commonlib owns setting identity and shared labels; LiveSync owns page placement,
Obsidian controls, persistence routing, and side effects.

### Use Advanced as the first proof page

The Advanced page is the first page whose groups contain only standard
`SettingSpec` controls. It provides a useful proof without introducing
unrelated workflows:

- number, dropdown, and toggle controls;
- translated Commonlib labels;
- minimum-value validation and a default value;
- CouchDB-dependent visibility; and
- configuration-level page visibility.

It has no current `onSaved` handler, Svelte component, staged Apply group, or
destructive action. General was not the first proof because changing the
display language re-renders the interface and other controls emit status events
after saving. After the standard binding was proven, these effects remained
explicit, tab-owned saved handlers while their one-key controls adopted
`SettingSpec`.

The first native activation does not also divide other pages into searchable
rows. It exposes their established pane renderers as custom pages, limited to
page-level search. A later, optional migration can replace an individual custom
page with standard, action, or rendered rows without changing the page
catalogue.

## Implementation Stages and Checkpoint

### Stage A: remove the old wizard

Complete the focused prerequisite described above. This removes a DOM contract
which would otherwise distort both renderers.

### Stage B: prove the shared standard-control model

The first declarative-settings change remains deliberately small. It will:

1. add the minimal `SettingSpec` type and pure conversion functions;
2. describe only the Advanced controls as specifications;
3. render those specifications through the existing `LiveSyncSetting` path;
4. prove conversion to Obsidian setting definitions with focused tests; and
5. retain the current `display()` behaviour, page menu, persistence owner, and
   `minAppVersion`, without returning non-empty setting definitions.

Stage B does not enable the native declarative renderer. It proves that the
shared model can express a real page without first taking ownership of every
page's lifetime. Returning an empty definition array merely to silence review
output is not an outcome of this stage.

### Stage C1: activate the native catalogue

Activation is a separate checkpoint because it is the first cross-cutting
change. It will add the page catalogue, custom `SettingPage` adapter, scoped
imperative lifetime, renderer-neutral refresh operation, declarative control
read and write overrides, and non-empty definitions on Obsidian 1.13 or later.

The non-empty definition array replaces `display()` completely. Partial
activation is therefore not safe: all 12 existing pages must enter the native
catalogue together. Advanced is the only page represented by native groups in
this stage. The other 11 pages use their existing pane renderers inside lazy
custom pages. Obsidian versions before 1.13 retain the complete imperative
renderer and its menu.

The existing rebuild-required action remains available while navigating native
pages. Custom pages render the established action at their page boundary, and
the Advanced definition includes an equivalent action item whose visibility is
derived from the same dirty-state predicate. Both forms call the existing
`confirmRebuild()` owner rather than introducing another apply workflow.

This stage necessarily touches direct `display()` callers, saved-handler
ownership, and cleanup for Svelte and markdown content. It does not expand
`SettingSpec` to absorb those concerns merely to make activation appear
smaller.

### Stage C2: improve search coverage selectively

After activation, an individual custom page may be replaced with native groups,
actions, and rendered rows where the existing panel boundary maps cleanly to
Obsidian's definitions. The bounded improvement converts the General and
Logging controls and the simple Quick Setup actions, then organises Appearance,
Logging, and Extra menus as child pages of General Settings. It also removes
the now-misleading Setup child page and assigns its remaining responsibilities
to their existing owners: Extra menus, Maintenance, and Help and
troubleshooting. Further conversions remain optional follow-up work rather than
a condition of Stage C1. Complex workflows may remain custom pages indefinitely.

Stage C2 must not introduce a general action or lifecycle language. Each page
conversion should be justified by useful settings-search coverage and retain
the catalogue, persistence owner, and refresh boundaries established by Stage
C1.

## Verification

Stage A runs the maintained onboarding E2E scenario and an ordinary settings
navigation scenario. A source check confirms that no old wizard event, state,
class, or message consumer remains.

Stage B focused unit tests verify:

- only explicitly listed Advanced controls become specifications;
- synthetic `OnDialogSettings` keys cannot be standard specifications;
- control type, options, defaults, validation, metadata, and visibility map
  consistently to the legacy and native representations; and
- rendering the Advanced specifications through `LiveSyncSetting` preserves
  the current save behaviour.

Stage C1 and the landing-page focused unit tests verify:

- the page catalogue contains all 13 pane-based destinations with stable, unique
  identifiers and names;
- Appearance, Logging, Extra menus, and Advanced are native-items child pages,
  and ten child pages retain custom factories;
- inactive and active configurations use their specified landing-page order;
- Remote Configuration and Sync Settings remain native navigable pages inside
  the separate Synchronisation group;
- maintenance, extra features, advanced settings, and help have explicit page
  groups, and the old Setup child page is absent;
- all eight General and Logging controls are registered once, with their
  existing conditional visibility;
- the three Extra menus controls are registered once and refresh page
  visibility after persistence;
- every standard setting key is registered once;
- reads use the editing buffer;
- writes use `saveSettings([key])` and never `plugin.settings`;
- custom pages dispose their page-owned resources and do not duplicate saved
  handlers when reopened; and
- importing and opening the imperative fallback does not evaluate or require
  `SettingPage` on Obsidian before 1.13.

Real-Obsidian verification on 1.13 or later confirms:

- the common landing controls and actions render before native page navigation;
- the Quick Setup action opens the maintained onboarding dialogue;
- Remote Configuration remains visible without initial scrolling in mobile
  test mode;
- native page navigation opens every remaining child page;
- Advanced controls appear in global settings search;
- Advanced values persist and are restored after reopening settings;
- CouchDB-dependent controls and Advanced-mode visibility update correctly;
- a representative custom page, including its cleanup, still works;
- page and catalogue refreshes preserve native navigation and the
  rebuild-required action; and
- no duplicate save, update handler, or saved-setting effect occurs after
  leaving and reopening a page.

Because the manifest continues to support earlier Obsidian versions, a
pre-1.13 real-runtime smoke test must confirm that the imperative fallback
still opens, navigates, saves one Advanced value, and opens one custom page. If
the maintained E2E runner cannot install that runtime, the exact manual version
and procedure must be recorded before the implementation is merged.

The current real-Obsidian runner defaults to Obsidian 1.12.7, so it owns the
fallback smoke path. The declarative path uses a separately installed
1.13-or-later AppImage selected through `OBSIDIAN_BINARY` and `OBSIDIAN_CLI`.
`E2E_OBSIDIAN_SETTINGS_ONLY=true` limits that run to the settings contract so
the same scenario can validate a second Obsidian runtime without repeating its
unrelated compatibility-review and mobile-layout coverage.

Existing E2E scenarios must use one shared settings-page navigation helper.
That helper uses the current `.sls-setting-menu-btn` contract on the legacy
runtime and accessible native page names on 1.13 or later. Individual scenarios
must not duplicate version checks or retain selectors for a menu which the
declarative renderer does not create.

The initial Stage C1 implementation was exercised against the official Obsidian
1.13.4 arm64 AppImage with SHA-256
`20d0b13c6d40bb3d7e73d9b4be6d2e21dfcc145b2106a747d0c1b81e651dabfe`.
That run opened all 12 pages from the native page catalogue, found the Advanced
control through global settings search, persisted a numeric value on Enter,
and restored it after the settings dialogue was closed and reopened. The
complete default scenario also passed on Obsidian 1.12.7, including
compatibility review, mobile layout, imperative page navigation, and immediate
persistence of the same Advanced value. The shared E2E navigator owns both the
separate settings renderer used by Obsidian 1.13 and the legacy
`.sls-setting-menu-btn` interface.

The Stage C2 landing composition was then exercised on Obsidian 1.13.4. With
synchronisation inactive, the real interface rendered Quick Setup, a separate
Synchronisation group containing Remote Configuration and Sync Settings, and a
General Settings group containing Appearance, Logging, and Extra menus in the
specified order. It opened all 14 nested settings pages, found the Advanced
control through global settings search, and restored its saved value after
reopening settings. In mobile test mode, Remote Configuration remained inside
the initial viewport below the two Quick Setup actions and the Synchronisation
heading. The complete scenario also passed with the same bundle on Obsidian
1.12.7, confirming that the imperative fallback retained its navigation and
save behaviour.

## Expansion Checkpoints

Review the scope with the maintainer before any implementation adds one of the
following:

- a generic representation of actions, confirmations, rebuilds, or service
  lifecycles;
- staged multi-setting transactions in `SettingSpec`;
- a replacement for the current onboarding workflow;
- a Commonlib setting metadata contract change;
- a minimum Obsidian version increase; or
- further conversion of Remote Configuration, Hatch, Maintenance, Help, or the
  Svelte-based Selector controls.

These may become worthwhile after the first proof, but none is required to
establish a shared standard-control model and native settings search.

## Alternatives Rejected

### Return an empty definition array

This can satisfy a syntactic lint check while retaining `display()`, but it
does not add native settings search or prove a migration path.

### Generate every setting from Commonlib setting metadata

Metadata does not define current page membership, control type, options,
visibility, save policy, or whether a compatibility key should be exposed.
Automatic generation would expose settings which the current interface omits.

### Teach `LiveSyncSetting` to run against a simulated DOM

The existing class is a renderer with direct component and element access.
Making it emulate declarative output would preserve its mixed responsibilities
and make the new API depend on implementation details of the old one.

### Model every pane before adopting the API

This would require a general action and lifecycle language for approximately
50 buttons, several dynamic lists, five Svelte-based regular-expression
controls, and multiple recovery workflows. The resulting framework would be
larger than the standard-control problem it is intended to solve.

## References

- [Migrate to declarative settings](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)
- Obsidian `PluginSettingTab`, `SettingDefinitionItem`, and `SettingPage` type
  declarations from the dependency version locked by this repository
