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
            !(file as { isFolder?: boolean }).isFolder
        );
    }

    isFolder(item: unknown): item is FSAPIFolder {
        return !!(
            item &&
            typeof item === "object" &&
            "path" in item &&
            (item as { isFolder?: boolean }).isFolder === true &&
            "handle" in item
        );
    }
}
