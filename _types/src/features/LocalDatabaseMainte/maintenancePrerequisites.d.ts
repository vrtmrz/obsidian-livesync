// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
type MaintenancePrerequisiteSettings = Pick<ObsidianLiveSyncSettings, "doNotUseFixedRevisionForChunks" | "readChunksOnline">;
type MaintenancePrerequisiteOptions = {
    operationName: string;
    settings: MaintenancePrerequisiteSettings;
    askSelectStringDialogue: (message: string, buttons: readonly ["Apply and continue", "Cancel"], options: {
        title: string;
        defaultAction: "Cancel";
    }) => Promise<"Apply and continue" | "Cancel" | false | undefined>;
    applyPartial: (settings: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean) => Promise<void>;
};
export declare function ensureLocalDatabaseMaintenancePrerequisites({ operationName, settings, askSelectStringDialogue, applyPartial, }: MaintenancePrerequisiteOptions): Promise<boolean>;
export {};
