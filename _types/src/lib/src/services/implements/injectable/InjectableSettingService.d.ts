// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { SettingService, type SettingServiceDependencies } from "@lib/services/base/SettingService";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
export declare class InjectableSettingService<T extends ServiceContext> extends SettingService<T> {
    constructor(context: T, dependencies: SettingServiceDependencies);
    protected setItem(key: string, value: string): void;
    protected getItem(key: string): string;
    protected deleteItem(key: string): void;
    saveData: import("@lib/services/lib/HandlerUtils").HandlerFunction<(data: ObsidianLiveSyncSettings) => Promise<void>, unknown>;
    loadData: import("@lib/services/lib/HandlerUtils").HandlerFunction<() => Promise<ObsidianLiveSyncSettings | undefined>, unknown>;
}
