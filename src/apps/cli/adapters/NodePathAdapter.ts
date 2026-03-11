import * as path from "path";
import type { FilePath } from "@lib/common/types";
import type { IPathAdapter } from "@lib/serviceModules/adapters";
import type { NodeFile } from "./NodeTypes";

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
