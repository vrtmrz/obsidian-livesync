// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type TAbstractFile } from "@/deps";
import type { FilePath } from "@lib/common/types";
import type { IPathAdapter } from "@lib/serviceModules/adapters";
/**
 * Path adapter implementation for Obsidian
 */
export declare class ObsidianPathAdapter implements IPathAdapter<TAbstractFile> {
    getPath(file: string | TAbstractFile): FilePath;
    normalisePath(path: string): string;
}
