# Log and Status Display Feature

This feature module manages logging capture, status bar updating, editor overlay logs, and debug report dumps.

## Structure and Module Architecture

- **`types.ts`**: Declares required service dependencies (`LogFeatureServices`, including API, settings, replication, conflict, fileProcessing, appLifecycle, vault, and UI) and modules (`storageAccess`).
- **`state.ts`**: Encapsulates state for the logger instance, including DOM overlays, active files, and cached notifications.
- **`logOperations.ts`**: Implements status calculations and logging:
  - `processAddLog`: Formats logs and handles platform-specific notifications.
  - `observeForLogs`: Hooks reactive properties onto the status bar and calculates throughput.
  - `adjustStatusDivPosition`: Dynamically moves editor status tags inside workspace panels.
  - `writeLogToTheFile`: Commits formatted entries to local hidden markdown files.
- **`index.ts`**: Binds the global `addLog` service hooks and sets up commands and UI pane views.

## British English Compliance

All user logs, notifications, and documentations adhere to British English (e.g., 'initialisation', 'serialisation', and Oxford comma formatting).
