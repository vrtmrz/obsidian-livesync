import { EVENT_SETTING_SAVED } from "@lib/events/coreEvents";
import { EVENT_REQUEST_RELOAD_SETTING_TAB } from "@/common/events";
import { eventHub } from "@lib/hub/hub";
import { handlers } from "@lib/services/lib/HandlerUtils";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { SettingService, type SettingServiceDependencies } from "@lib/services/base/SettingService";
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
            eventHub.emitEvent(EVENT_SETTING_SAVED, settings);
            return Promise.resolve(true);
        });
        this.onSettingLoaded.addHandler((settings) => {
            eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
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
