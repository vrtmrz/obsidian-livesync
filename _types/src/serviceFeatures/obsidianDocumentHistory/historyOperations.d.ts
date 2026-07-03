// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type TFile } from "@/deps.ts";
import type { FilePathWithPrefix, DocumentID } from "@lib/common/types.ts";
import type { DocumentHistoryHost } from "./types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
/**
 * Opens the document history modal dialogue for a given file.
 *
 * @param host - The service feature host context.
 * @param file - The file path or TFile reference to query history.
 * @param id - Optional CouchDB document identifier.
 */
export declare function showHistory(host: DocumentHistoryHost, file: TFile | FilePathWithPrefix, id?: DocumentID): void;
/**
 * Displays a list of all local documents, prompting the user to select one to view its history.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 */
export declare function fileHistory(host: DocumentHistoryHost, log: LogFunction): Promise<void>;
