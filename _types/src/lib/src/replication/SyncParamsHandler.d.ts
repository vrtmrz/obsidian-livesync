// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { SyncParameters } from "@lib/common/types.ts";
import { LiveSyncError } from "@lib/common/LSError.ts";
/**
 * Creates a SyncParamsHandler for managing synchronisation parameters.
 */
type putFunc = (params: SyncParameters) => Promise<boolean>;
/**
 * Fetches synchronisation parameters from the server.
 */
type getFunc = () => Promise<SyncParameters>;
/**
 * The function to create new synchronisation parameters.
 * Note that this function should not return `pbkdf2salt` in the result; it should be generated and stored in the handler.
 */
type createFunc = () => Promise<SyncParameters>;
type CreateSyncParamsHanderOptions = {
    put: putFunc;
    get: getFunc;
    create: createFunc;
};
export type SyncParamsHandler = {
    fetch: (refresh?: boolean) => Promise<SyncParameters | false>;
    getPBKDF2Salt: (refresh?: boolean) => Promise<Uint8Array>;
};
export declare function createSyncParamsHanderForServer(key: string, options: CreateSyncParamsHanderOptions): SyncParamsHandler;
export declare function clearHandlers(): void;
export declare class SyncParamsHandlerError extends LiveSyncError {
}
export declare class SyncParamsFetchError extends SyncParamsHandlerError {
}
export declare class SyncParamsNotFoundError extends SyncParamsHandlerError {
}
export declare class SyncParamsUpdateError extends SyncParamsHandlerError {
}
export {};
