// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ConfigService } from "@lib/services/base/ConfigService";
import type { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { ReplicatorService } from "@lib/services/base/ReplicatorService";
import { UIService } from "@lib/services/implements/base/UIService";
import { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import type { IAPIService, IControlService } from "@lib/services/base/IService";
export type ObsidianUIServiceDependencies<T extends ObsidianServiceContext = ObsidianServiceContext> = {
    appLifecycle: AppLifecycleService<T>;
    config: ConfigService<T>;
    replicator: ReplicatorService<T>;
    APIService: IAPIService;
    control: IControlService;
};
export declare class ObsidianUIService extends UIService<ObsidianServiceContext> {
    get dialogToCopy(): import("svelte/legacy").LegacyComponentType;
    constructor(context: ObsidianServiceContext, dependents: ObsidianUIServiceDependencies<ObsidianServiceContext>);
}
