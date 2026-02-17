import {
    compareFileFreshness,
    markChangesAreSame,
    type BASE_IS_NEW,
    type EVEN,
    type TARGET_IS_NEW,
} from "@/common/utils";
import type { AnyEntry } from "@lib/common/models/db.type";
import type { UXFileInfo, UXFileInfoStub } from "@lib/common/models/fileaccess.type";
import { ServiceFileHandlerBase } from "@lib/serviceModules/ServiceFileHandlerBase";

// markChangesAreSame uses persistent data implicitly, we should refactor it too.
// also, compareFileFreshness depends on marked changes, so we should refactor it as well. For now, to make the refactoring done once, we just use them directly.
// Hence it is not on /src/lib/src/serviceModules. (markChangesAreSame is using indexedDB).
// TODO: REFACTOR
export class ServiceFileHandler extends ServiceFileHandlerBase {
    override markChangesAreSame(old: UXFileInfo | AnyEntry, newMtime: number, oldMtime: number) {
        return markChangesAreSame(old, newMtime, oldMtime);
    }
    override compareFileFreshness(
        baseFile: UXFileInfoStub | AnyEntry | undefined,
        checkTarget: UXFileInfo | AnyEntry | undefined
    ): typeof TARGET_IS_NEW | typeof BASE_IS_NEW | typeof EVEN {
        return compareFileFreshness(baseFile, checkTarget);
    }
}
