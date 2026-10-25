import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import type { OnUpdateFunc, PageFunctions } from "./SettingPane";

const controls = vi.hoisted(() => new Map<string, { onUpdate?: () => { visibility?: boolean } }>());
vi.mock("@/common/translation", () => ({ $msg: (key: string) => key }));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/logger", () => ({ Logger: vi.fn() }));
vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class {
        autoWireDropDown(key: string, options = {}) {
            controls.set(key, options);
            return this;
        }
        autoWireToggle(key: string, options = {}) {
            controls.set(key, options);
            return this;
        }
        autoWireNumeric(key: string, options = {}) {
            controls.set(key, options);
            return this;
        }
    },
}));

import { paneSyncSettings } from "./PaneSyncSettings";

function setup(liveSync: boolean, batchSave: boolean, batchSaveInLiveSync: boolean) {
    const callbacks = new Map<string, (value: string) => Promise<void>>();
    const panels = new Map<string, OnUpdateFunc | undefined>();
    const tab = {
        editingSettings: { ...DEFAULT_SETTINGS, liveSync, batchSave, batchSaveInLiveSync },
        services: { API: { isMobile: () => false }, control: { applySettings: vi.fn(async () => {}) } },
        addOnSaved: (key: string, callback: (value: string) => Promise<void>) => callbacks.set(key, callback),
        isConfiguredAs(key: string, value: unknown) {
            if (key === "syncMode") {
                return (
                    (this.editingSettings.liveSync
                        ? "LIVESYNC"
                        : this.editingSettings.periodicReplication
                          ? "PERIODIC"
                          : "ONEVENTS") === value
                );
            }
            return this.editingSettings[key as keyof typeof this.editingSettings] === value;
        },
        saveSettings: vi.fn(async () => {}),
        requestCatalogueRefresh: vi.fn(),
    };
    const functions = {
        addPanel: (_element: HTMLElement, title: string, _callback: unknown, onUpdate?: OnUpdateFunc) => ({
            then(callback: (element: HTMLElement) => void) {
                if (!title.endsWith("titleSynchronizationMethod") && !title.endsWith("titleUpdateThinning")) return;
                panels.set(title, onUpdate);
                callback({} as HTMLElement);
            },
        }),
    } as unknown as PageFunctions;
    paneSyncSettings.call(tab as unknown as ObsidianLiveSyncSettingTab, {} as HTMLElement, functions);
    return { tab, callbacks, panels };
}

function visible(key: string): boolean {
    const control = controls.get(key);
    if (!control) throw new Error(`Missing setting control: ${key}`);
    return control.onUpdate?.().visibility !== false;
}

beforeEach(() => controls.clear());

describe("mode-specific database batching settings", () => {
    it.each([
        { liveSync: true, batchSave: true, batchSaveInLiveSync: false, delays: false },
        { liveSync: true, batchSave: false, batchSaveInLiveSync: true, delays: true },
        { liveSync: false, batchSave: true, batchSaveInLiveSync: false, delays: true },
        { liveSync: false, batchSave: false, batchSaveInLiveSync: true, delays: false },
    ])("shows the current mode choice and its shared delays: %j", ({ delays, ...settings }) => {
        const { panels } = setup(settings.liveSync, settings.batchSave, settings.batchSaveInLiveSync);
        expect(panels.get("obsidianLiveSyncSettingTab.titleUpdateThinning")?.().visibility).not.toBe(false);
        expect(visible("batchSave")).toBe(!settings.liveSync);
        expect(visible("batchSaveInLiveSync")).toBe(settings.liveSync);
        expect(visible("batchSaveMinimumDelay")).toBe(delays);
        expect(visible("batchSaveMaximumDelay")).toBe(delays);
    });

    it.each([
        [true, false],
        [false, true],
    ])("retains both batching choices across mode changes: %j", async (batchSave, batchSaveInLiveSync) => {
        const { tab, callbacks } = setup(false, batchSave, batchSaveInLiveSync);
        const switchMode = callbacks.get("syncMode")!;
        for (const mode of ["LIVESYNC", "PERIODIC", "ONEVENTS", "LIVESYNC"]) {
            await switchMode(mode);
            expect(tab.editingSettings).toMatchObject({ batchSave, batchSaveInLiveSync });
        }
        expect(tab.services.control.applySettings).toHaveBeenCalledTimes(4);
    });
});
