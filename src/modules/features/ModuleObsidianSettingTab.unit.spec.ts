import { beforeEach, describe, expect, it, vi } from "vitest";

const settingTabState = vi.hoisted(() => ({
    callOrder: [] as string[],
    loadSettings: vi.fn<() => Promise<void>>(),
}));

const eventHubState = vi.hoisted(() => ({
    onEvent: vi.fn(),
}));

vi.mock("./SettingDialogue/ObsidianLiveSyncSettingTab.ts", () => ({
    ObsidianLiveSyncSettingTab: class ObsidianLiveSyncSettingTab {
        async loadSettings() {
            await settingTabState.loadSettings();
            settingTabState.callOrder.push("settings-loaded");
        }
    },
}));

vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_SETTINGS: "request-open-settings",
    eventHub: eventHubState,
}));

import { ModuleObsidianSettingDialogue } from "./ModuleObsidianSettingTab.ts";

function createModuleHarness() {
    let initialisationHandler: (() => Promise<boolean>) | undefined;
    let settingsLoadedHandler: (() => Promise<boolean>) | undefined;
    const plugin = {
        app: {},
        addSettingTab: vi.fn(() => settingTabState.callOrder.push("add-setting-tab")),
    };
    const services = {
        appLifecycle: {
            onInitialise: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    initialisationHandler = handler;
                }),
            },
            onSettingLoaded: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    settingsLoadedHandler = handler;
                }),
            },
        },
    };
    const module = Object.assign(Object.create(ModuleObsidianSettingDialogue.prototype), {
        plugin,
        core: { services },
    }) as ModuleObsidianSettingDialogue;

    module.onBindFunction(module.core as never, services as never);

    return {
        initialisationHandler: () => initialisationHandler,
        module,
        plugin,
        services,
        settingsLoadedHandler: () => settingsLoadedHandler,
    };
}

describe("ModuleObsidianSettingDialogue startup lifecycle", () => {
    beforeEach(() => {
        settingTabState.callOrder.length = 0;
        settingTabState.loadSettings.mockReset().mockResolvedValue(undefined);
        eventHubState.onEvent.mockClear();
    });

    it("registers the setting tab after persisted settings have loaded", () => {
        const { initialisationHandler, services, settingsLoadedHandler } = createModuleHarness();

        expect(services.appLifecycle.onInitialise.addHandler).not.toHaveBeenCalled();
        expect(services.appLifecycle.onSettingLoaded.addHandler).toHaveBeenCalledOnce();
        expect(initialisationHandler()).toBeUndefined();
        expect(settingsLoadedHandler()).toBeTypeOf("function");
    });

    it("seeds the setting editor without requesting a render before registration", async () => {
        const { initialisationHandler, settingsLoadedHandler, plugin } = createModuleHarness();
        let finishRead!: () => void;
        settingTabState.loadSettings.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRead = resolve;
            })
        );
        const handler = settingsLoadedHandler() ?? initialisationHandler();

        expect(handler).toBeTypeOf("function");
        const loading = handler!();
        expect(plugin.addSettingTab).not.toHaveBeenCalled();
        finishRead();
        await loading;

        expect(settingTabState.loadSettings).toHaveBeenCalledOnce();
        expect(settingTabState.callOrder).toEqual(["settings-loaded", "add-setting-tab"]);
    });
    it("does not register an editor when reading device values fails", async () => {
        const { settingsLoadedHandler, plugin } = createModuleHarness();
        const failure = new Error("device storage unavailable");
        settingTabState.loadSettings.mockRejectedValueOnce(failure);
        await expect(settingsLoadedHandler()!()).rejects.toBe(failure);
        expect(plugin.addSettingTab).not.toHaveBeenCalled();
    });
});
