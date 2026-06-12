import type { ITypeGuardAdapter } from "@lib/serviceModules/adapters";
import type { NodeFile, NodeFolder } from "./NodeTypes";

/**
 * Type guard adapter implementation for Node.js
 */
export class NodeTypeGuardAdapter implements ITypeGuardAdapter<NodeFile, NodeFolder> {
    isFile(file: unknown): file is NodeFile {
        return !!(
            file &&
            typeof file === "object" &&
            "path" in file &&
            "stat" in file &&
            !("isFolder" in file && file.isFolder === true)
        );
    }

    isFolder(item: unknown): item is NodeFolder {
        return !!(item && typeof item === "object" && "path" in item && "isFolder" in item && item.isFolder === true);
    }
}
