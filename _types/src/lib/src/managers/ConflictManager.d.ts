// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type Diff } from "diff-match-patch";
import { type EntryDoc, type FilePathWithPrefix, type diff_result_leaf, type LoadedEntry, type DIFF_CHECK_RESULT_AUTO } from "@lib/common/types.ts";
import type { EntryManager } from "@lib/managers/EntryManager/EntryManager.ts";
import type { IPathService } from "@lib/services/base/IService.ts";
type AutoMergeOutcomeOK = {
    ok: DIFF_CHECK_RESULT_AUTO;
};
type AutoMergeCanBeDoneByDeletingRev = {
    result: string;
    conflictedRev: string;
};
type UserActionRequired = {
    leftRev: string;
    rightRev: string;
    leftLeaf: diff_result_leaf | false;
    rightLeaf: diff_result_leaf | false;
};
export type AutoMergeResult = Promise<AutoMergeOutcomeOK | AutoMergeCanBeDoneByDeletingRev | UserActionRequired>;
export interface ConflictManagerOptions {
    entryManager: EntryManager;
    pathService: IPathService;
    database: PouchDB.Database<EntryDoc>;
}
export declare class ConflictManager {
    options: ConflictManagerOptions;
    constructor(options: ConflictManagerOptions);
    get database(): PouchDB.Database<EntryDoc>;
    getConflictedDoc(path: FilePathWithPrefix, rev: string): Promise<false | diff_result_leaf>;
    mergeSensibly(path: FilePathWithPrefix, baseRev: string, currentRev: string, conflictedRev: string): Promise<Diff[] | false>;
    mergeObject(path: FilePathWithPrefix, baseRev: string, currentRev: string, conflictedRev: string): Promise<string | false>;
    tryAutoMergeSensibly(path: FilePathWithPrefix, test: LoadedEntry, conflicts: string[]): Promise<false | {
        result: string;
        conflictedRev: string;
    }>;
    tryAutoMerge(path: FilePathWithPrefix, enableMarkdownAutoMerge: boolean): AutoMergeResult;
}
export {};
