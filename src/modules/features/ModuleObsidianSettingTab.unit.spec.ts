import { beforeEach, describe, expect, it, vi } from "vitest";

const settingTabState = vi.hoisted(() => ({
    callOrder: [] as string[],
    reloadAllSettings: vi.fn<(skipUpdate?: boolean) => void>(),
}));

const eventHubState = vi.hoisted(() => ({
    onEvent: vi.fn(),
}));

vi.mock("./SettingDialogue/ObsidianLiveSyncSettingTab.ts", () => ({
    ObsidianLiveSyncSettingTab: class ObsidianLiveSyncSettingTab {
        reloadAllSettings(skipUpdate?: boolean) {
            settingTabState.callOrder.push(`reload:${String(skipUpdate)}`);
            settingTabState.reloadAllSettings(skipUpdate);
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
        settingTabState.reloadAllSettings.mockClear();
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
        const { initialisationHandler, settingsLoadedHandler } = createModuleHarness();
        const handler = settingsLoadedHandler() ?? initialisationHandler();

        expect(handler).toBeTypeOf("function");
        await handler!();

        expect(settingTabState.reloadAllSettings).toHaveBeenCalledWith(true);
        expect(settingTabState.callOrder).toEqual(["reload:true", "add-setting-tab"]);
    });
});
