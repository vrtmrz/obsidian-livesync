import { AbstractModule } from "@/modules/AbstractModule.ts";
import type { diff_check_result } from "@lib/common/models/diff.definition";
import type { FilePathWithPrefix } from "@lib/common/models/db.type";
import type { InjectableServiceHub } from "@lib/services/InjectableServices.ts";
import type { LiveSyncCore } from "@/main.ts";
declare global {
    interface LSEvents {
        "conflict-cancelled": FilePathWithPrefix;
    }
}
export declare class ModuleConflictResolver extends AbstractModule {
    private _resolveConflictByDeletingRev;
    checkConflictAndPerformAutoMerge(path: FilePathWithPrefix): Promise<diff_check_result>;
    private _resolveConflict;
    private _anyResolveConflictByNewest;
    private _resolveAllConflictedFilesByNewerOnes;
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void;
}
