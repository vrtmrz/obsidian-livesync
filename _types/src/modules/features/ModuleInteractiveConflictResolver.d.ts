import type { FilePathWithPrefix } from "@lib/common/models/db.type";
import type { diff_result } from "@lib/common/models/diff.definition";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleInteractiveConflictResolver extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean>;
    _anyResolveConflictByUI(filename: FilePathWithPrefix, conflictCheckResult: diff_result): Promise<boolean>;
    allConflictCheck(): Promise<void>;
    pickFileForResolve(): Promise<boolean>;
    _allScanStat(): Promise<boolean>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
