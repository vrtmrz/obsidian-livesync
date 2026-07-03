// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { CouchDBCredentials, EntryDoc } from "@lib/common/types";
import type { IRemoteService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import { type LOG_LEVEL } from "@lib/common/types";
import { AuthorizationHeaderGenerator } from "@lib/replication/httplib";
import type { APIService } from "@lib/services/base/APIService";
import type { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { SettingService } from "@lib/services/base/SettingService";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";
import { type LogFunction } from "@lib/services/lib/logUtils";
export interface RemoteServiceDependencies {
    APIService: APIService;
    appLifecycle: AppLifecycleService;
    setting: SettingService;
}
declare const FetchMethod: {
    readonly webCompat: 0;
    readonly native: 1;
};
type FetchMethod = (typeof FetchMethod)[keyof typeof FetchMethod];
/**
 * The RemoteService provides methods for interacting with the remote database.
 */
export declare abstract class RemoteService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IRemoteService {
    /**
     * Connect to the remote database with the provided settings.
     * @param uri  The URI of the remote database.
     * @param auth  The authentication credentials for the remote database.
     * @param disableRequestURI  Whether to disable the request URI.
     * @param passphrase  The passphrase for the remote database.
     * @param useDynamicIterationCount  Whether to use dynamic iteration count.
     * @param performSetup  Whether to perform setup.
     * @param skipInfo  Whether to skip information retrieval.
     * @param compression  Whether to enable compression.
     * @param customHeaders  Custom headers to include in the request.
     * @param useRequestAPI  Whether to use the request API.
     * @param getPBKDF2Salt  Function to retrieve the PBKDF2 salt.
     * Note that this function is used for CouchDB and compatible only.
     */
    protected _log: LogFunction;
    protected _authHeader: AuthorizationHeaderGenerator;
    protected _APIService: APIService;
    protected _appLifecycleService: AppLifecycleService;
    protected _settingService: SettingService;
    protected _unresolvedErrors: UnresolvedErrorManager;
    protected last_successful_post: boolean;
    get hadLastPostFailedBySize(): boolean;
    constructor(context: T, dependencies: RemoteServiceDependencies);
    showError(msg: string, max_log_level?: LOG_LEVEL): void;
    clearErrors(): void;
    performFetch(req: string | Request, opts?: RequestInit, fetchMethod?: FetchMethod): Promise<Response>;
    connect(uri: string, auth: CouchDBCredentials, disableRequestURI: boolean, passphrase: string | false, useDynamicIterationCount: boolean, performSetup: boolean, skipInfo: boolean, compression: boolean, customHeaders: Record<string, string>, useRequestAPI: boolean, getPBKDF2Salt: () => Promise<Uint8Array>): Promise<string | {
        db: PouchDB.Database<EntryDoc>;
        info: PouchDB.Core.DatabaseInfo;
    }>;
}
export {};
