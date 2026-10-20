import type { FilePath, FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { DatabaseDiagnosticOutput } from "./databaseDiagnostics";

export type DiagnosticFileCandidate = {
    path: string;
    databasePath?: FilePathWithPrefix | FilePath;
    documentId?: string;
    storageExists: boolean;
    source: "metadata" | "vault";
};

export type DiagnosticFileLookupResult =
    | {
          valid: false;
          status: "invalid";
          processed: 0;
          candidates: [];
      }
    | {
          valid: true;
          status: "cancelled" | "complete";
          processed: number;
          candidates: DiagnosticFileCandidate[];
      };

export interface FindDiagnosticFilesOptions {
    signal?: AbortSignal;
    onProgress?(processed: number): void;
}

export interface DiagnosticFileLookupDialogOptions {
    find(token: string, onProgress: (processed: number) => void): Promise<DiagnosticFileLookupResult>;
    prepareReport(candidate: DiagnosticFileCandidate, token: string): Promise<DatabaseDiagnosticOutput>;
    openFile?(path: string): Promise<void> | void;
    cancel(): void;
}
