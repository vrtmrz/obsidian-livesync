# Development Utility Feature

This feature module integrates debugging and unit/integration testing utilities inside the application workspace.

## Structure and Module Architecture

- **`types.ts`**: Declares required service dependencies (`DevFeatureServices`, including API, setting, appLifecycle, test, path, vault, keyValueDB, and UI) and modules (`storageAccess`, `databaseFileAccess`).
- **`state.ts`**: Holds the `testResults` Svelte store representing completed and active unit testing logs.
- **`devOperations.ts`**: Implements operational debug functions:
  - `onMissingTranslation`: Formats missing dialogue translation keys and appends them to debug logs.
  - `createConflict`: Generates local file revisions and mock sync conflicts.
  - `addTestResult`: Commits test outcome metrics into the Svelte store.
- **`index.ts`**: Hook interfaces for lifecycle handlers, window view registers, and command overrides.

## British English Compliance

All logs, dialogue texts, comments, and documentations follow British English spelling rules (e.g., 'initialisation', 'dialogue', and Oxford comma formatting).
