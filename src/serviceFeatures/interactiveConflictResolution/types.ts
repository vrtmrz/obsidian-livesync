import {
    CANCELLED,
    LEAVE_TO_SUBSEQUENT,
    type diff_result,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

export const POSTPONED = Symbol("postponed");

export type MergeDialogResult = typeof CANCELLED | typeof POSTPONED | typeof LEAVE_TO_SUBSEQUENT | string;

export interface ConflictResolveDialogue {
    open(): void;
    waitForResult(): Promise<MergeDialogResult>;
}

export type ConflictResolveDialogueFactory = (
    filename: FilePathWithPrefix,
    conflictCheckResult: diff_result
) => ConflictResolveDialogue;
