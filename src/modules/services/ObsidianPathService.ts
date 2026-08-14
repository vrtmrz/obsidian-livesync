import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext.js";
import { normalizePath } from "@/deps.js";
import { PathService } from "@vrtmrz/livesync-commonlib/compat/services/base/PathService.js";

import {
    type BASE_IS_NEW,
    type TARGET_IS_NEW,
    type EVEN,
    markChangesAreSame,
    unmarkChanges,
    compareFileFreshness,
    isMarkedAsSameChanges,
} from "@/common/utils.js";
import type { UXFileInfo, AnyEntry, UXFileInfoStub, FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
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
