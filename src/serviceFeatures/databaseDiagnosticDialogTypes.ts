import type { DiagnosticNameMode } from "@vrtmrz/livesync-commonlib/diagnostics";
import type { DatabaseDiagnosticKind, DatabaseDiagnosticOutput } from "./databaseDiagnostics";

/** The dialogue can run or cancel an inspection without receiving the service container. */
export interface DatabaseDiagnosticDialogOptions {
    kind: DatabaseDiagnosticKind;
    run(nameMode: DiagnosticNameMode, onProgress: (processed: number) => void): Promise<DatabaseDiagnosticOutput>;
    cancel(): void;
}
