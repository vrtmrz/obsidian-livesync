// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { ConfigService } from "@lib/services/base/ConfigService";
import type { IAPIService, ISettingService } from "@lib/services/base/IService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
export interface ConfigServiceBrowserCompatDependencies {
    settingService: ISettingService;
    APIService: IAPIService;
}
export declare class ConfigServiceBrowserCompat<T extends ServiceContext = ServiceContext> extends ConfigService<T> {
    private _settingService;
    _log: ReturnType<typeof createInstanceLogFunction>;
    constructor(context: T, dependencies: ConfigServiceBrowserCompatDependencies);
    getSmallConfig(key: string): string | null;
    setSmallConfig(key: string, value: string): void;
    deleteSmallConfig(key: string): void;
}
