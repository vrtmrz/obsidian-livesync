import type { FilePath } from "@lib/common/types";
import type { IPathAdapter } from "@lib/serviceModules/adapters";
import type { FSAPIFile } from "./FSAPITypes";

/**
 * Path adapter implementation for FileSystem API
 */
export class FSAPIPathAdapter implements IPathAdapter<FSAPIFile> {
    getPath(file: string | FSAPIFile): FilePath {
        return (typeof file === "string" ? file : file.path) as FilePath;
    }

    normalisePath(p: string): string {
        // Normalize path separators to forward slashes (like Obsidian)
        // Remove leading/trailing slashes
        return p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    }
}
