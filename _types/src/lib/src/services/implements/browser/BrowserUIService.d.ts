// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { UIService } from "@lib/services/implements/base/UIService";
import type { ConfigService } from "@lib/services/base/ConfigService";
import type { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { ReplicatorService } from "@lib/services/base/ReplicatorService";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import type { IAPIService, IControlService } from "@lib/services/base/IService";
export type BrowserUIServiceDependencies<T extends ServiceContext = ServiceContext> = {
    appLifecycle: AppLifecycleService<T>;
    config: ConfigService<T>;
    replicator: ReplicatorService<T>;
    APIService: IAPIService;
    control: IControlService;
};
export declare class BrowserUIService<T extends ServiceContext> extends UIService<T> {
    get dialogToCopy(): import("svelte/legacy").LegacyComponentType;
    constructor(context: T, dependents: BrowserUIServiceDependencies<T>);
}
