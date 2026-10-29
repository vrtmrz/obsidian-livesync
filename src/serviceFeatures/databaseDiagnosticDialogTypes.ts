import type { DiagnosticNameMode } from "@vrtmrz/livesync-commonlib/diagnostics";
import type {
    DatabaseDiagnosticKind,
    DatabaseDiagnosticOutput,
    DatabaseDiagnosticProgress,
} from "./databaseDiagnostics";

/** The dialogue can run or cancel an inspection without receiving the service container. */
export interface DatabaseDiagnosticDialogOptions {
    kind: DatabaseDiagnosticKind;
    run(
        nameMode: DiagnosticNameMode,
        onProgress: (progress: DatabaseDiagnosticProgress) => void,
        includeRemote?: boolean
    ): Promise<DatabaseDiagnosticOutput>;
    cancel(): void;
}
