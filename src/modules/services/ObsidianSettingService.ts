import { type ObsidianLiveSyncSettings } from "@lib/common/types";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, EVENT_SETTING_SAVED } from "@lib/events/coreEvents";
import { eventHub } from "@lib/hub/hub";
import { SettingService, type SettingServiceDependencies } from "@lib/services/base/SettingService";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";

export class ObsidianSettingService<T extends ObsidianServiceContext> extends SettingService<T> {
    constructor(context: T, dependencies: SettingServiceDependencies) {
        super(context, dependencies);
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
        return localStorage.setItem(key, value);
    }
    protected getItem(key: string): string {
        return localStorage.getItem(key) ?? "";
    }
    protected deleteItem(key: string): void {
        localStorage.removeItem(key);
    }

    protected override async saveData(data: ObsidianLiveSyncSettings): Promise<void> {
        return await this.context.liveSyncPlugin.saveData(data);
    }
    protected override async loadData(): Promise<ObsidianLiveSyncSettings | undefined> {
        return await this.context.liveSyncPlugin.loadData();
    }
}
