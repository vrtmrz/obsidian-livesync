// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type FilePathWithPrefix, type diff_result } from "@lib/common/types.ts";
import type { ConflictResolverHost } from "./types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
/**
 * Resolves a conflict using the user interface modal, one-by-one.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @param filename - The path of the conflicted file.
 * @param conflictCheckResult - The result of conflict detection / diff.
 * @returns A promise resolving to true if successfully resolved, otherwise false.
 */
export declare function resolveConflictByUI(host: ConflictResolverHost, log: LogFunction, filename: FilePathWithPrefix, conflictCheckResult: diff_result): Promise<boolean>;
/**
 * Iteratively prompts the user to resolve all conflicted files.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 */
export declare function allConflictCheck(host: ConflictResolverHost, log: LogFunction): Promise<void>;
/**
 * Prompts the user to pick a file from the list of conflicted files.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @returns A promise resolving to true if a file was selected and queued for checking, otherwise false.
 */
export declare function pickFileForResolve(host: ConflictResolverHost, log: LogFunction): Promise<boolean>;
/**
 * Scans the database for conflicted files and displays a safety popup if any are found.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @returns A promise resolving to true if execution completes successfully, otherwise false.
 */
export declare function allScanStat(host: ConflictResolverHost, log: LogFunction): Promise<boolean>;
