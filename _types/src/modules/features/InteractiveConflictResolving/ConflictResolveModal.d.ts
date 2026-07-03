// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { App, Modal } from "@/deps.ts";
import { CANCELLED, LEAVE_TO_SUBSEQUENT, type diff_result } from "@lib/common/types.ts";
import { eventHub } from "@/common/events.ts";
export type MergeDialogResult = typeof CANCELLED | typeof LEAVE_TO_SUBSEQUENT | string;
declare global {
    interface Slips extends LSSlips {
        "conflict-resolved": typeof CANCELLED | MergeDialogResult;
    }
}
export declare class ConflictResolveModal extends Modal {
    result: diff_result;
    filename: string;
    response: MergeDialogResult;
    isClosed: boolean;
    consumed: boolean;
    title: string;
    pluginPickMode: boolean;
    localName: string;
    remoteName: string;
    offEvent?: ReturnType<typeof eventHub.onEvent>;
    currentDiffIndex: number;
    diffView: HTMLDivElement;
    diffNavIndicator: HTMLSpanElement;
    constructor(app: App, filename: string, diff: diff_result, pluginPickMode?: boolean, remoteName?: string);
    appendDiffFragment(container: HTMLDivElement, text: string, cls: string): void;
    appendVersionInfo(container: HTMLDivElement, cls: string, name: string, date: string): void;
    navigateDiff(direction: "prev" | "next"): void;
    resetDiffNavigation(): void;
    onOpen(): void;
    sendResponse(result: MergeDialogResult): void;
    onClose(): void;
    waitForResult(): Promise<MergeDialogResult>;
}
