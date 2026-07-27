import { type TAbstractFile, normalizePath } from "@/deps";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IPathAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters";

/**
 * Path adapter implementation for Obsidian
 */
export class ObsidianPathAdapter implements IPathAdapter<TAbstractFile> {
    getPath(file: string | TAbstractFile): FilePath {
        return (typeof file === "string" ? file : file.path) as FilePath;
    }

    normalisePath(path: string): string {
        return normalizePath(path);
    }
}
