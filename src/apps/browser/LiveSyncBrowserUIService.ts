import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context.js";
import type { AppLifecycleService } from "@vrtmrz/livesync-commonlib/compat/services/base/AppLifecycleService.js";
import type { ConfigService } from "@vrtmrz/livesync-commonlib/compat/services/base/ConfigService.js";
import type { ControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/ControlService.js";
import type { ReplicatorService } from "@vrtmrz/livesync-commonlib/compat/services/base/ReplicatorService.js";
import type { InjectableAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAPIService.js";
import { UIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/UIService.js";
import DialogToCopy from "@/modules/services/LiveSyncUI/dialogues/DialogueToCopy.svelte";
import { BrowserSvelteDialogManager } from "./BrowserSvelteDialogManager.js";

export interface LiveSyncBrowserUIServiceDependencies<T extends ServiceContext> {
    API: InjectableAPIService<T>;
    appLifecycle: AppLifecycleService<T>;
    config: ConfigService<T>;
    control: ControlService<T>;
    replicator: ReplicatorService<T>;
}

export class LiveSyncBrowserUIService<T extends ServiceContext> extends UIService<T> {
    override get dialogToCopy() {
        return DialogToCopy;
    }
    constructor(context: T, dependents: LiveSyncBrowserUIServiceDependencies<T>) {
        const browserConfirm = dependents.API.confirm;
        const obsidianSvelteDialogManager = new BrowserSvelteDialogManager<T>(context, {
            appLifecycle: dependents.appLifecycle,
            config: dependents.config,
            replicator: dependents.replicator,
            confirm: browserConfirm,
            control: dependents.control,
        });
        super(context, {
            dialogManager: obsidianSvelteDialogManager,
            APIService: dependents.API,
        });
    }
}
