// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type LogFunction } from "@lib/services/lib/logUtils";
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
/**
 * Flag file handler interface, similar to target filter pattern.
 */
interface FlagFileHandler {
    priority: number;
    check: () => Promise<boolean>;
    handle: () => Promise<boolean>;
}
export declare function isFlagFileExist(host: NecessaryServices<never, "storageAccess">, path: string): Promise<boolean>;
export declare function deleteFlagFile(host: NecessaryServices<never, "storageAccess">, log: LogFunction, path: string): Promise<void>;
/**
 * Factory function to create a fetch all flag handler.
 * All logic related to fetch all flag is encapsulated here.
 */
export declare function createFetchAllFlagHandler(host: NecessaryServices<"vault" | "fileProcessing" | "tweakValue" | "UI" | "setting" | "appLifecycle" | "path" | "keyValueDB" | "database", "storageAccess" | "rebuilder" | "fileHandler">, log: LogFunction): FlagFileHandler;
/**
 * Adjust setting to remote configuration.
 * @param config current configuration to retrieve remote preferred config
 * @returns updated configuration if applied, otherwise null.
 */
export declare function adjustSettingToRemote(host: NecessaryServices<"tweakValue" | "UI" | "setting", never>, log: LogFunction, config: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings | undefined>;
/**
 * Adjust setting to remote if needed.
 * @param extra result of dialogues that may contain preventFetchingConfig flag (e.g, from FetchEverything or RebuildEverything)
 * @param config current configuration to retrieve remote preferred config
 */
export declare function adjustSettingToRemoteIfNeeded(host: NecessaryServices<"tweakValue" | "UI" | "setting", never>, log: LogFunction, extra: {
    preventFetchingConfig: boolean;
}, config: ObsidianLiveSyncSettings): Promise<void>;
/**
 * Process vault initialisation with suspending file watching and sync.
 * @param proc process to be executed during initialisation, should return true if can be continued, false if app is unable to continue the process.
 * @param keepSuspending  whether to keep suspending file watching after the process.
 * @returns result of the process, or false if error occurs.
 */
export declare function processVaultInitialisation(host: NecessaryServices<"setting", never>, log: LogFunction, proc: () => Promise<boolean>, keepSuspending?: boolean): Promise<boolean>;
export declare function verifyAndUnlockSuspension(host: NecessaryServices<"setting" | "appLifecycle" | "UI", never>, log: LogFunction): Promise<boolean>;
/**
 * Factory function to create a rebuild flag handler.
 * All logic related to rebuild flag is encapsulated here.
 */
export declare function createRebuildFlagHandler(host: NecessaryServices<"setting" | "appLifecycle" | "UI" | "tweakValue", "storageAccess" | "rebuilder">, log: LogFunction): {
    priority: number;
    check: () => Promise<boolean>;
    handle: () => Promise<boolean>;
};
/**
 * Factory function to create a suspend all flag handler.
 * All logic related to suspend flag is encapsulated here.
 */
export declare function createSuspendFlagHandler(host: NecessaryServices<"setting", "storageAccess">, log: LogFunction): FlagFileHandler;
export declare function flagHandlerToEventHandler(flagHandler: FlagFileHandler): () => Promise<boolean>;
export declare function useRedFlagFeatures(host: NecessaryServices<"API" | "appLifecycle" | "UI" | "setting" | "tweakValue" | "fileProcessing" | "vault" | "path" | "keyValueDB" | "database", "storageAccess" | "rebuilder" | "fileHandler">): void;
export {};
