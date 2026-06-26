// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type FilePathWithPrefix } from "@lib/common/types";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type { NecessaryObsidianFeature } from "@/types";
export type ConflictCheckerHost = NecessaryObsidianFeature<"API" | "conflict" | "vault" | "setting">;
export declare const queueConflictCheckIfOpenHandler: (host: ConflictCheckerHost, file: FilePathWithPrefix) => Promise<void>;
export declare const queueConflictCheckHandler: (host: ConflictCheckerHost, queue: QueueProcessor<FilePathWithPrefix, any>, file: FilePathWithPrefix) => Promise<void>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function useConflictChecker(host: ConflictCheckerHost): {
    conflictCheckQueue: QueueProcessor<FilePathWithPrefix, FilePathWithPrefix>;
    conflictResolveQueue: QueueProcessor<FilePathWithPrefix, unknown>;
};
