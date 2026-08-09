import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IPathAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters";
import type { NodeFile } from "./NodeTypes";
import { path } from "@vrtmrz/livesync-commonlib/node";

/**
 * Path adapter implementation for Node.js
 */
export class NodePathAdapter implements IPathAdapter<NodeFile> {
    getPath(file: string | NodeFile): FilePath {
        return (typeof file === "string" ? file : file.path) as FilePath;
    }

    normalisePath(p: string): string {
        // Normalize path separators to forward slashes (like Obsidian)
        return path.normalize(p).replace(/\\/g, "/");
    }
}
