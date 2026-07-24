import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    EVENT_REQUEST_RELOAD_SETTING_TAB,
    EVENT_SETTING_SAVED,
} from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import {
    SettingService,
    type SettingServiceDependencies,
} from "@vrtmrz/livesync-commonlib/compat/services/base/SettingService";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";

export function normaliseObsidianSettingsData(data: unknown): ObsidianLiveSyncSettings | undefined {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
    return data as ObsidianLiveSyncSettings;
}

export class ObsidianSettingService<T extends ObsidianServiceContext> extends SettingService<T> {
    constructor(context: T, dependencies: SettingServiceDependencies) {
        super(context, dependencies);
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
        // TODO: Implement nativeLocalStorage.
        return compatGlobal.localStorage.setItem(key, value);
    }
    protected getItem(key: string): string {
        // TODO: Implement nativeLocalStorage.
        return compatGlobal.localStorage.getItem(key) ?? "";
    }
    protected deleteItem(key: string): void {
        // TODO: Implement nativeLocalStorage.
        compatGlobal.localStorage.removeItem(key);
    }

    protected override async saveData(data: ObsidianLiveSyncSettings): Promise<void> {
        return await this.context.liveSyncPlugin.saveData(data);
    }
    protected override async loadData(): Promise<ObsidianLiveSyncSettings | undefined> {
        return normaliseObsidianSettingsData(await this.context.liveSyncPlugin.loadData());
    }
}
