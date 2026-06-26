# Interactive Conflict Resolver Feature

This feature module provides user-interactive conflict resolution capabilities for the Self-hosted LiveSync plug-in.

## Structure and Module Architecture

The interactive conflict resolver consists of the following components:

- **`types.ts`**: Defines the required services (`ConflictResolverServices`, including API, settings, UI, database, conflict, appLifecycle, replication, and path), modules (`ConflictResolverModules`), and the host container interface (`ConflictResolverHost`).
- **`state.ts`**: Provides a minimal state management interface. The interactive conflict resolver is stateless, utilising locks to prevent overlapping dialogue boxes.
- **`conflictOperations.ts`**: Contains the core logic for managing conflicts:
  - `resolveConflictByUI`: Opens a dialogue modal to resolve a specific file conflict.
  - `pickFileForResolve`: Prompts the user to pick a conflicted file to resolve.
  - `allConflictCheck`: Loops through all conflicted files to resolve them sequentially.
  - `allScanStat`: Scans the database for conflicted files on startup and displays safety dialogues if any exist.
- **`index.ts`**: The main entry point that exposes the `useInteractiveConflictResolver` hook, registers the commands, and binds hooks to database and application lifecycle events.

## Design Decisions

- **Modularity**: Logic is decoupled from the monolithic core class, allowing individual testability and easier maintainability.
- **UI Locking**: Conflicting file UI prompts are serialized using the `conflict-resolve-ui` lock to prevent multiple dialogues from appearing concurrently.
- **British English**: All comments, documentations, and logs follow British English spelling conventions (e.g., 'dialogue', 'serialisation', and serial commas).
