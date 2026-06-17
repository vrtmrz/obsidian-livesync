import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import { normalizePath } from "@/deps";
import { PathService } from "@lib/services/base/PathService";

import {
    type BASE_IS_NEW,
    type TARGET_IS_NEW,
    type EVEN,
    markChangesAreSame,
    unmarkChanges,
    compareFileFreshness,
    isMarkedAsSameChanges,
} from "@/common/utils";
import type { UXFileInfo, AnyEntry, UXFileInfoStub, FilePathWithPrefix } from "@lib/common/types";
export class ObsidianPathService extends PathService<ObsidianServiceContext> {
    override markChangesAreSame(
        old: UXFileInfo | AnyEntry | FilePathWithPrefix,
        newMtime: number,
        oldMtime: number
    ): boolean | undefined {
        return markChangesAreSame(old, newMtime, oldMtime);
    }
    override unmarkChanges(file: AnyEntry | FilePathWithPrefix | UXFileInfoStub): void {
        return unmarkChanges(file);
    }
    override compareFileFreshness(
        baseFile: UXFileInfoStub | AnyEntry | undefined,
        checkTarget: UXFileInfo | AnyEntry | undefined
    ): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN {
        return compareFileFreshness(baseFile, checkTarget);
    }
    override isMarkedAsSameChanges(
        file: UXFileInfoStub | AnyEntry | FilePathWithPrefix,
        mtimes: number[]
    ): undefined | typeof EVEN {
        return isMarkedAsSameChanges(file, mtimes);
    }
    protected normalizePath(path: string): string {
        return normalizePath(path);
    }
}
