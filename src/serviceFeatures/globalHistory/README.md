# Global History Feature

This feature module registers and manages the Global History view within Obsidian to display vault-wide history.

## Structure and Module Architecture

- **`types.ts`**: Declares required service dependencies (`GlobalHistoryServices`, including API and appLifecycle) and host interfaces.
- **`state.ts`**: Provides stateless mock parameters.
- **`historyOperations.ts`**: Bundles the `showGlobalHistory` operation.
- **`index.ts`**: Handles view registration (`GlobalHistoryView`), command registration, and hook bindings on initialisation.

## British English Compliance

All user messages, logs, comments, and documentations adhere to British English spelling rules (e.g., 'initialisation', 'dialogue', and Oxford comma formatting).
