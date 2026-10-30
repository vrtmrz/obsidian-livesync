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
import { EVENT_SYNC_GUARD_PREFERENCES_CHANGED } from "@/common/events.ts";

export type SyncGuardSettings = {
    syncGuardEnabled: boolean;
    syncGuardMinimumFiles: number;
};

export type SyncGuardSettingKey = keyof SyncGuardSettings;

export const DEFAULT_SYNC_GUARD_SETTINGS: Readonly<SyncGuardSettings> = {
    syncGuardEnabled: false,
    syncGuardMinimumFiles: 20,
};

export function isSyncGuardSettingKey(key: string): key is SyncGuardSettingKey {
    return key === "syncGuardEnabled" || key === "syncGuardMinimumFiles";
}

/** Access the Obsidian host preferences from a service exposed through the shared hub type. */
export function getSyncGuardSettings(setting: SettingService<ObsidianServiceContext>): Readonly<SyncGuardSettings> {
    return (setting as ObsidianSettingService<ObsidianServiceContext>).syncGuardSettings;
}

export async function setSyncGuardSetting<K extends SyncGuardSettingKey>(
    setting: SettingService<ObsidianServiceContext>,
    key: K,
    value: SyncGuardSettings[K]
): Promise<void> {
    await (setting as ObsidianSettingService<ObsidianServiceContext>).setSyncGuardSetting(key, value);
}

export function normaliseObsidianSettingsData(data: unknown): ObsidianLiveSyncSettings | undefined {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
    return data as ObsidianLiveSyncSettings;
}

export class ObsidianSettingService<T extends ObsidianServiceContext> extends SettingService<T> {
    private _syncGuardSettings: SyncGuardSettings = { ...DEFAULT_SYNC_GUARD_SETTINGS };
    private legacySyncGuardSettings: Partial<SyncGuardSettings> = {};

    get syncGuardSettings(): Readonly<SyncGuardSettings> {
        return this._syncGuardSettings;
    }

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

    override async loadSettings(): Promise<void> {
        await super.loadSettings();
        const storedEnabled = await this.config.getObject("syncGuardEnabled");
        const storedMinimumFiles = await this.config.getObject("syncGuardMinimumFiles");
        const enabled = typeof storedEnabled === "boolean" ? storedEnabled : this.legacySyncGuardSettings.syncGuardEnabled;
        const minimumFiles =
            typeof storedMinimumFiles === "number" && Number.isFinite(storedMinimumFiles) && storedMinimumFiles >= 1
                ? storedMinimumFiles
                : this.legacySyncGuardSettings.syncGuardMinimumFiles;

        this._syncGuardSettings = {
            syncGuardEnabled: enabled ?? DEFAULT_SYNC_GUARD_SETTINGS.syncGuardEnabled,
            syncGuardMinimumFiles: minimumFiles ?? DEFAULT_SYNC_GUARD_SETTINGS.syncGuardMinimumFiles,
        };
        if (storedEnabled === undefined && enabled !== undefined) {
            await this.config.setObject("syncGuardEnabled", enabled);
        }
        if (storedMinimumFiles === undefined && minimumFiles !== undefined) {
            await this.config.setObject("syncGuardMinimumFiles", minimumFiles);
        }
    }

    async setSyncGuardSetting<K extends SyncGuardSettingKey>(key: K, value: SyncGuardSettings[K]): Promise<void> {
        if (key === "syncGuardMinimumFiles" && (typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
            throw new RangeError("SyncGuard minimum files must be a positive integer");
        }
        if (this._syncGuardSettings[key] === value) return;
        await this.config.setObject(key, value);
        this._syncGuardSettings = { ...this._syncGuardSettings, [key]: value };
        // These preferences change only the workspace overlay. Re-applying all
        // replication settings would unnecessarily interrupt an active sync.
        this.context.events.emitEvent(EVENT_SYNC_GUARD_PREFERENCES_CHANGED);
    }

    protected override async saveData(data: ObsidianLiveSyncSettings): Promise<void> {
        const persisted: Record<string, unknown> = { ...data };
        delete persisted.syncGuardEnabled;
        delete persisted.syncGuardMinimumFiles;
        return await this.context.liveSyncPlugin.saveData(persisted);
    }
    protected override async loadData(): Promise<ObsidianLiveSyncSettings | undefined> {
        const data = normaliseObsidianSettingsData(await this.context.liveSyncPlugin.loadData());
        if (!data) return undefined;
        const persisted: Record<string, unknown> = { ...data };
        const { syncGuardEnabled, syncGuardMinimumFiles } = persisted;
        this.legacySyncGuardSettings = {
            ...(typeof syncGuardEnabled === "boolean" ? { syncGuardEnabled } : {}),
            ...(typeof syncGuardMinimumFiles === "number" &&
            Number.isFinite(syncGuardMinimumFiles) &&
            syncGuardMinimumFiles >= 1
                ? { syncGuardMinimumFiles }
                : {}),
        };
        delete persisted.syncGuardEnabled;
        delete persisted.syncGuardMinimumFiles;
        return persisted as unknown as ObsidianLiveSyncSettings;
    }
}
