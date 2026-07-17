import { EVENT_SETTING_SAVED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { EVENT_REQUEST_RELOAD_SETTING_TAB } from "@/common/events";
import { handlers } from "@vrtmrz/livesync-commonlib/compat/services/lib/HandlerUtils";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { SettingService, type SettingServiceDependencies } from "@vrtmrz/livesync-commonlib/compat/services/base/SettingService";
import {
    configureNodeLocalStorage,
    deleteNodeLocalStorageItem,
    getNodeLocalStorageItem,
    setNodeLocalStorageItem,
} from "./NodeLocalStorage";

export class NodeSettingService<T extends ServiceContext> extends SettingService<T> {
    constructor(context: T, dependencies: SettingServiceDependencies, storagePath: string) {
        super(context, dependencies);
        configureNodeLocalStorage(storagePath);
        this.onSettingSaved.addHandler((settings) => {
            this.context.events.emitEvent(EVENT_SETTING_SAVED, settings);
            return Promise.resolve(true);
        });
        this.onSettingLoaded.addHandler((settings) => {
            this.context.events.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
            return Promise.resolve(true);
        });
    }

    protected setItem(key: string, value: string) {
        setNodeLocalStorageItem(key, value);
    }

    protected getItem(key: string): string {
        return getNodeLocalStorageItem(key);
    }

    protected deleteItem(key: string): void {
        deleteNodeLocalStorageItem(key);
    }

    public saveData = handlers<{ saveData: (data: ObsidianLiveSyncSettings) => Promise<void> }>().binder("saveData");
    public loadData = handlers<{ loadData: () => Promise<ObsidianLiveSyncSettings | undefined> }>().binder("loadData");
}
