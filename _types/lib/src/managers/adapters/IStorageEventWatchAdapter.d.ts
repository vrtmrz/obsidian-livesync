import type { FilePath } from "@lib/common/models/db.type";
/**
 * Event handlers for storage events
 */
export interface IStorageEventWatchHandlers {
    onCreate: (file: unknown, ctx?: unknown) => void;
    onChange: (file: unknown, ctx?: unknown) => void;
    onDelete: (file: unknown, ctx?: unknown) => void;
    onRename: (file: unknown, oldPath: string, ctx?: unknown) => void;
    onRaw: (path: FilePath) => void;
    onEditorChange?: (editor: unknown, info: unknown) => void;
}
/**
 * Adapter interface for watching vault/storage events
 */
export interface IStorageEventWatchAdapter {
    /**
     * Begin watching for storage events
     */
    beginWatch(handlers: IStorageEventWatchHandlers): Promise<void>;
}
