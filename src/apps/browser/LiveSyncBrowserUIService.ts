import type { BrowserServiceHostDependencies } from "@vrtmrz/livesync-commonlib/compat/services/BrowserServices";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { UIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/UIService";
import DialogToCopy from "@/modules/services/LiveSyncUI/dialogues/DialogueToCopy.svelte";
import { BrowserSvelteDialogManager } from "./BrowserSvelteDialogManager";

export class LiveSyncBrowserUIService<T extends ServiceContext> extends UIService<T> {
    override get dialogToCopy() {
        return DialogToCopy;
    }
    constructor(context: T, dependents: BrowserServiceHostDependencies<T>) {
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
