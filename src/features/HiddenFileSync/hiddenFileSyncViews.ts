import type { InternalFileInfo } from "@/common/types.ts";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

export type HiddenFileSyncInitialisationDirection = "push" | "pull" | "safe" | "pullForce" | "pushForce";

/** Initialisation operation needed by the Customisation Sync dialogue. */
export interface HiddenFileSyncInitialisationView {
    initialiseInternalFileSync(
        direction: HiddenFileSyncInitialisationDirection,
        showMessage: boolean,
        targetFiles?: string[] | false
    ): Promise<void>;
}

/** Exact-revision operations needed by the Hatch repair pane. */
export interface HiddenFileSyncRepairView {
    scanInternalFiles(): Promise<InternalFileInfo[]>;
    storeInternalFileToDatabase(file: InternalFileInfo, forceWrite?: boolean): Promise<boolean | undefined>;
    storeInternalFileToDatabaseWithBaseRevision(
        file: InternalFileInfo,
        baseRevision: string,
        createIfDifferent?: boolean
    ): Promise<boolean>;
    extractInternalFileRevisionFromDatabase(
        storageFilePath: FilePath,
        revision: string,
        force?: boolean
    ): Promise<boolean>;
}

/** Operations consumed by the host-owned Hidden File Sync commands. */
export interface HiddenFileSyncCommandView extends HiddenFileSyncInitialisationView {
    isManualCommandAvailable(): boolean;
    scanAllStorageChanges(showNotice: boolean): Promise<unknown>;
    scanAllDatabaseChanges(showNotice: boolean): Promise<unknown>;
    applyOfflineChanges(showNotice: boolean): Promise<unknown>;
    updateSettingCache(): void;
}
