import type { ITypeGuardAdapter } from "@lib/serviceModules/adapters";
import type { FSAPIFile, FSAPIFolder } from "./FSAPITypes";

/**
 * Type guard adapter implementation for FileSystem API
 */
export class FSAPITypeGuardAdapter implements ITypeGuardAdapter<FSAPIFile, FSAPIFolder> {
    isFile(file: unknown): file is FSAPIFile {
        return !!(
            file &&
            typeof file === "object" &&
            "path" in file &&
            "stat" in file &&
            "handle" in file &&
            !("isFolder" in file && file.isFolder === true)
        );
    }

    isFolder(item: unknown): item is FSAPIFolder {
        return !!(
            item &&
            typeof item === "object" &&
            "path" in item &&
            "isFolder" in item &&
            item.isFolder === true &&
            "handle" in item
        );
    }
}
