# External Merge Tool Integration

## Objective
To allow users to resolve file conflicts using their preferred external merge tools (e.g., Meld, WinMerge, KDiff3) directly from the Obsidian LiveSync conflict resolution dialog. This provides a more powerful and familiar interface for handling complex merges compared to the built-in simple resolution options.

## Configuration

Two new settings have been added under **Settings -> Conflict Resolution (Advanced)**:

1.  **Use External Merge Tool**: A toggle to enable the feature.
2.  **External Merge Tool Command**: The command line string to launch the tool.
    *   **Default**: `meld`
    *   **Placeholders**:
        *   `%1`: Path to the **Base (Local)** file (Temporary copy).
        *   `%2`: Path to the **Conflicted (Remote)** file (Temporary copy).
        *   `%3`: Path to the **Merged** file (Target for the result).
    *   **Default Behavior (No placeholders)**: If no placeholders are found, the tool is invoked as: `[executable] [base_path] [merged_path] [remote_path]`.

## Workflow

1.  **Conflict Detection**: When a conflict is detected, the user opens the "Resolve conflict" dialog (e.g., via command "Pick a file to resolve conflict").
2.  **Dialog Interaction**:
    *   If enabled, a new button **"Open External Tool"** appears in the `ConflictResolveModal`.
3.  **Launch**:
    *   The plugin creates three temporary files in the OS temporary directory:
        *   `base_[filename]`: Content of the local revision.
        *   `remote_[filename]`: Content of the conflicted remote revision.
        *   `merged_[filename]`: Initially a copy of the local revision.
    *   The configured external tool is spawned using `child_process.spawn`.
4.  **Merging**:
    *   The user performs the merge in the external tool and saves the changes to the "Merged" file.
    *   The plugin waits for the external tool process to exit.
5.  **Resolution**:
    *   On exit (code 0), the plugin reads the content of `merged_[filename]`.
    *   The merged content is written to the local database, replacing the conflicting revisions.
    *   The conflict is marked as resolved.
    *   Temporary files are deleted.

## Technical Implementation Details

### Modules Modified

*   **`src/modules/features/ModuleObsidianSetting.ts`**:
    *   Initialized default values for `useExternalMergeTool` (false) and `externalMergeToolCommand` ("").
*   **`src/modules/features/SettingDialogue/PaneSyncSettings.ts`**:
    *   Added UI controls for the new settings.
*   **`src/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts`**:
    *   Updated `MergeDialogResult` type to accept an object `{ content: string }` for returning merged content.
    *   Added `onExternalMerge` callback prop to the constructor.
    *   Added the "Open External Tool" button which triggers the callback.
*   **`src/modules/features/ModuleInteractiveConflictResolver.ts`**:
    *   Implemented `openExternalMergeTool` method:
        *   Uses `fs.promises` for file I/O.
        *   Uses `os.tmpdir()` for temporary file location.
        *   Parses the command string to separate executable and arguments.
        *   Handles placeholder replacement (`%1`, `%2`, `%3`).
        *   Uses `child_process.spawn` to run the tool.
    *   Updated `_anyResolveConflictByUI` to:
        *   Pass the `openExternalMergeTool` callback to the modal.
        *   Handle the `{ content: string }` result type.
        *   Apply the merged content using `core.databaseFileAccess.storeContent`.
        *   Resolve the conflict by deleting the conflicted revision.

### Limitations / Notes
*   **Node.js Environment**: This feature relies on `child_process` and `fs` modules, so it is strictly limited to the **Desktop** version of Obsidian (Electron). It will not work on Mobile.
*   **Blocking**: The plugin waits for the external process to close. The user must close the merge tool to complete the flow.
