import { EVENT_SETTING_SAVED } from "@lib/events/coreEvents";
import { EVENT_REQUEST_RELOAD_SETTING_TAB } from "@/common/events";
import { eventHub } from "@lib/hub/hub";
import { handlers } from "@lib/services/lib/HandlerUtils";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { SettingService, type SettingServiceDependencies } from "@lib/services/base/SettingService";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

export class NodeSettingService<T extends ServiceContext> extends SettingService<T> {
    private storagePath: string;
    private localStore: Record<string, string> = {};

    constructor(context: T, dependencies: SettingServiceDependencies, storagePath: string) {
        super(context, dependencies);
        this.storagePath = storagePath;
        this.loadLocalStoreFromFile();
        this.onSettingSaved.addHandler((settings) => {
            eventHub.emitEvent(EVENT_SETTING_SAVED, settings);
            return Promise.resolve(true);
        });
        this.onSettingLoaded.addHandler((settings) => {
            eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
            return Promise.resolve(true);
        });
    }

    private loadLocalStoreFromFile() {
        try {
            const loaded = JSON.parse(nodeFs.readFileSync(this.storagePath, "utf-8")) as Record<string, string>;
            this.localStore = { ...loaded };
        } catch {
            this.localStore = {};
        }
    }

    private flushLocalStoreToFile() {
        nodeFs.mkdirSync(nodePath.dirname(this.storagePath), { recursive: true });
        nodeFs.writeFileSync(this.storagePath, JSON.stringify(this.localStore, null, 2), "utf-8");
    }

    protected setItem(key: string, value: string) {
        this.localStore[key] = value;
        this.flushLocalStoreToFile();
    }

    protected getItem(key: string): string {
        return this.localStore[key] ?? "";
    }

    protected deleteItem(key: string): void {
        if (key in this.localStore) {
            delete this.localStore[key];
            this.flushLocalStoreToFile();
        }
    }

    public saveData = handlers<{ saveData: (data: ObsidianLiveSyncSettings) => Promise<void> }>().binder("saveData");
    public loadData = handlers<{ loadData: () => Promise<ObsidianLiveSyncSettings | undefined> }>().binder("loadData");
}
