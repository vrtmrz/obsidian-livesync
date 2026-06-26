// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { AUTO_MERGED, MISSING_OR_ERROR, type diff_check_result, type FilePathWithPrefix } from "@lib/common/types";
import type { NecessaryObsidianFeature } from "@/types";
declare global {
    interface LSEvents {
        "conflict-cancelled": FilePathWithPrefix;
    }
}
export type ConflictResolverHost = NecessaryObsidianFeature<"API" | "conflict" | "appLifecycle" | "replication" | "vault" | "setting" | "database", "databaseFileAccess" | "fileHandler" | "storageAccess">;
export declare const resolveConflictByDeletingRevHandler: (host: ConflictResolverHost, path: FilePathWithPrefix, deleteRevision: string, subTitle?: string) => Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED>;
export declare const checkConflictAndPerformAutoMerge: (host: ConflictResolverHost, path: FilePathWithPrefix) => Promise<diff_check_result>;
export declare const resolveConflictHandler: (host: ConflictResolverHost, filename: FilePathWithPrefix) => Promise<void>;
export declare const resolveConflictByNewestHandler: (host: ConflictResolverHost, filename: FilePathWithPrefix) => Promise<boolean>;
export declare const resolveAllConflictedFilesByNewerOnesHandler: (host: ConflictResolverHost) => Promise<void>;
export declare function useConflictResolver(host: ConflictResolverHost): void;
