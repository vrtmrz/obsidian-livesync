import type { ConfigService } from "@lib/services/base/ConfigService";
import type { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { ReplicatorService } from "@lib/services/base/ReplicatorService";
import { UIService } from "@lib/services//implements/base/UIService";
import { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";
import { ObsidianSvelteDialogManager } from "./SvelteDialogObsidian";
import { ObsidianConfirm } from "./ObsidianConfirm";

export type ObsidianUIServiceDependencies<T extends ObsidianServiceContext = ObsidianServiceContext> = {
    appLifecycle: AppLifecycleService<T>;
    config: ConfigService<T>;
    replicator: ReplicatorService<T>;
};

export class ObsidianUIService extends UIService<ObsidianServiceContext> {
    constructor(context: ObsidianServiceContext, dependents: ObsidianUIServiceDependencies<ObsidianServiceContext>) {
        const obsidianConfirm = new ObsidianConfirm(context);
        const obsidianSvelteDialogManager = new ObsidianSvelteDialogManager<ObsidianServiceContext>(context, {
            appLifecycle: dependents.appLifecycle,
            config: dependents.config,
            replicator: dependents.replicator,
            confirm: obsidianConfirm,
        });
        super(context, {
            appLifecycle: dependents.appLifecycle,
            dialogManager: obsidianSvelteDialogManager,
            confirm: obsidianConfirm,
        });
    }
}
