import * as path from "path";
import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/types";
import type { IConversionAdapter } from "@lib/serviceModules/adapters";
import type { NodeFile, NodeFolder } from "./NodeTypes";

/**
 * Conversion adapter implementation for Node.js
 */
export class NodeConversionAdapter implements IConversionAdapter<NodeFile, NodeFolder> {
    nativeFileToUXFileInfoStub(file: NodeFile): UXFileInfoStub {
        return {
            name: path.basename(file.path),
            path: file.path,
            stat: file.stat,
            isFolder: false,
        };
    }

    nativeFolderToUXFolder(folder: NodeFolder): UXFolderInfo {
        return {
            name: path.basename(folder.path),
            path: folder.path,
            isFolder: true,
            children: [],
            parent: path.dirname(folder.path) as any,
        };
    }
}
