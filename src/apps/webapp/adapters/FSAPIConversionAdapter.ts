import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/types";
import type { IConversionAdapter } from "@lib/serviceModules/adapters";
import type { FSAPIFile, FSAPIFolder } from "./FSAPITypes";

/**
 * Conversion adapter implementation for FileSystem API
 */
export class FSAPIConversionAdapter implements IConversionAdapter<FSAPIFile, FSAPIFolder> {
    nativeFileToUXFileInfoStub(file: FSAPIFile): UXFileInfoStub {
        const pathParts = file.path.split("/");
        const name = pathParts[pathParts.length - 1] || file.handle.name;

        return {
            name: name,
            path: file.path,
            stat: file.stat,
            isFolder: false,
        };
    }

    nativeFolderToUXFolder(folder: FSAPIFolder): UXFolderInfo {
        const pathParts = folder.path.split("/");
        const name = pathParts[pathParts.length - 1] || folder.handle.name;
        const parentPath = pathParts.slice(0, -1).join("/");

        return {
            name: name,
            path: folder.path,
            isFolder: true,
            children: [],
            parent: parentPath as any,
        };
    }
}
