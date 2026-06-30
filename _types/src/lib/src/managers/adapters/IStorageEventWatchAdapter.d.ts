// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath } from "@lib/common/types";
/**
 * Event handlers for storage events
 */
export interface IStorageEventWatchHandlers<TFile = unknown, TCtx = unknown> {
    onCreate: (file: TFile, ctx?: TCtx) => void;
    onChange: (file: TFile, ctx?: TCtx) => void;
    onDelete: (file: TFile, ctx?: TCtx) => void;
    onRename: (file: TFile, oldPath: string, ctx?: TCtx) => void;
    onRaw: (path: FilePath) => void;
    onEditorChange?: <TEditor = unknown, TInfo = unknown>(editor: TEditor, info: TInfo) => void;
}
/**
 * Adapter interface for watching vault/storage events
 */
export interface IStorageEventWatchAdapter<TFile = unknown, TCtx = unknown> {
    /**
     * Begin watching for storage events
     */
    beginWatch(handlers: IStorageEventWatchHandlers<TFile, TCtx>): Promise<void>;
}
