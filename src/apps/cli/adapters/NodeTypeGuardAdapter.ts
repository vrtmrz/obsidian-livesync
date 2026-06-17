import type { ITypeGuardAdapter } from "@lib/serviceModules/adapters";
import type { NodeFile, NodeFolder } from "./NodeTypes";

/**
 * Type guard adapter implementation for Node.js
 */
export class NodeTypeGuardAdapter implements ITypeGuardAdapter<NodeFile, NodeFolder> {
    isFile(file: any): file is NodeFile {
        return file && typeof file === "object" && "path" in file && "stat" in file && !file.isFolder;
    }

    isFolder(item: any): item is NodeFolder {
        return item && typeof item === "object" && "path" in item && item.isFolder === true;
    }
}
