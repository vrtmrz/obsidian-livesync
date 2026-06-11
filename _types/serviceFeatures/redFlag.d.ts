import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type LogFunction } from "@lib/services/lib/logUtils";
/**
 * Flag file handler interface, similar to target filter pattern.
 */
interface FlagFileHandler {
    priority: number;
    check: () => Promise<boolean>;
    handle: () => Promise<boolean>;
}
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
