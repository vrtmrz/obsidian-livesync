# Obsidian Setting Dialogue Feature

This feature module initialises and registers the settings tab interface inside Obsidian.

## Structure and Module Architecture

- **`types.ts`**: Declares required service dependencies (`SettingDialogueServices`, including API and appLifecycle) and host interfaces.
- **`state.ts`**: Holds the reference to the instantiated `ObsidianLiveSyncSettingTab`.
- **`settingOperations.ts`**: Contains operational routines:
  - `openSetting`: Invokes Obsidian's internal settings panel and targets the plug-in tab.
  - `openSettingWizard`: Triggers settings and starts the minimal configuration setup flow.
- **`index.ts`**: Standardises setting tab instantiation, ribbon command integration, and event registrations.

## British English Compliance

All text configurations, user interfaces, and comments follow British English spelling conventions (e.g., 'initialisation', 'dialogue', and Oxford comma formatting).
