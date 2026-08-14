import type { ConfigService } from "@vrtmrz/livesync-commonlib/compat/services/base/ConfigService.js";
import type { AppLifecycleService } from "@vrtmrz/livesync-commonlib/compat/services/base/AppLifecycleService.js";
import type { ReplicatorService } from "@vrtmrz/livesync-commonlib/compat/services/base/ReplicatorService.js";
import { UIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/UIService.js";
import { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext.js";
import { ObsidianSvelteDialogManager } from "./SvelteDialogObsidian.js";
import DialogToCopy from "@/modules/services/LiveSyncUI/dialogues/DialogueToCopy.svelte";
import type { IAPIService, IControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService.js";
export type ObsidianUIServiceDependencies<T extends ObsidianServiceContext = ObsidianServiceContext> = {
    appLifecycle: AppLifecycleService<T>;
    config: ConfigService<T>;
    replicator: ReplicatorService<T>;
    APIService: IAPIService;
    control: IControlService;
};

export class ObsidianUIService extends UIService<ObsidianServiceContext> {
    override get dialogToCopy() {
        return DialogToCopy;
    }
    constructor(context: ObsidianServiceContext, dependents: ObsidianUIServiceDependencies<ObsidianServiceContext>) {
        const obsidianConfirm = dependents.APIService.confirm;
        const obsidianSvelteDialogManager = new ObsidianSvelteDialogManager<ObsidianServiceContext>(context, {
            appLifecycle: dependents.appLifecycle,
            config: dependents.config,
            replicator: dependents.replicator,
            confirm: obsidianConfirm,
            control: dependents.control,
        });
        super(context, {
            dialogManager: obsidianSvelteDialogManager,
            APIService: dependents.APIService,
        });
    }
}
