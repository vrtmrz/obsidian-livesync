# Obsidian Document History Feature

This feature module manages document histories and integrates command actions within Obsidian.

## Structure and Module Architecture

- **`types.ts`**: Declares required service dependencies (`DocumentHistoryServices`, including API, vault, database, UI, path, and appLifecycle) and host interfaces.
- **`state.ts`**: Provides stateless mock parameters.
- **`historyOperations.ts`**: Bundles operations to show histories and select files:
  - `showHistory`: Opens the `DocumentHistoryModal` dialogue.
  - `fileHistory`: Displays select options for all local documents to view history.
- **`index.ts`**: Configures command registrations and hook bindings on application initialisation.

## British English Compliance

All user messages, dialogue text, comments, and documentations adhere to British English (e.g., 'initialisation', 'dialogue', and Oxford comma formatting).
