import { nodePath as path } from "@cli/lib/nodeModules";
import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/models/fileaccess.type";
import type { IConversionAdapter } from "@lib/serviceModules/adapters";
import type { NodeFile, NodeFolder } from "./NodeTypes";
import type { FilePathWithPrefix } from "@lib/common/models/db.type";

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
            parent: path.dirname(folder.path) as FilePathWithPrefix,
        };
    }
}
