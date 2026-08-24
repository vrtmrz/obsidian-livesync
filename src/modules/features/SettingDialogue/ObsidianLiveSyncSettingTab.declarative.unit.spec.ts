import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import type { PageFunctions } from "./SettingPane.ts";

const runtime = vi.hoisted(() => ({
    components: [] as Array<{
        load: ReturnType<typeof vi.fn>;
        unload: ReturnType<typeof vi.fn>;
        callbacks: Array<() => unknown>;
    }>,
    paneGeneral: vi.fn(),
    pageCleanup: vi.fn(),
    savedEffect: vi.fn(),
    superHide: vi.fn(),
}));

function createElement(): HTMLElement {
    const element = {
        empty: vi.fn(),
        addClass: vi.fn(),
        removeClass: vi.fn(),
        toggleClass: vi.fn(),
        createEl: vi.fn(() => createElement()),
        createDiv: vi.fn(() => createElement()),
        querySelectorAll: vi.fn(() => []),
    };
    return element as unknown as HTMLElement;
}

vi.mock("@/deps.ts", () => ({
    App: class {},
    Component: class {
        callbacks: Array<() => unknown> = [];
        load = vi.fn();
        unload = vi.fn(() => {
            for (const callback of this.callbacks.splice(0)) callback();
        });
        register = vi.fn((callback: () => unknown) => this.callbacks.push(callback));
        constructor() {
            runtime.components.push(this);
        }
    },
    PluginSettingTab: class {
        app: unknown;
        plugin: unknown;
        refreshDomState = vi.fn();
        update = vi.fn();
        constructor(app: unknown, plugin: unknown) {
            this.app = app;
            this.plugin = plugin;
        }
        hide() {}
    },
    SettingPage: class {
        containerEl = createElement();
        title = "";
        display() {}
        hide() {
            runtime.superHide();
        }
    },
    requireApiVersion: vi.fn(() => true),
}));
vi.mock("@/main.ts", () => ({ default: class {} }));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", () => ({
    getLanguage: vi.fn(() => "en"),
    compatGlobal: {
        localStorage: {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
        },
    },
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_RELOAD_SETTING_TAB: "request-reload-setting-tab",
    eventHub: { onEvent: vi.fn() },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation", () => ({ checkSyncInfo: vi.fn() }));
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {},
}));
vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class {
        static env: unknown;
    },
}));
vi.mock("./SettingPane.ts", () => ({
    enableOnly: vi.fn((condition: () => boolean) => () => ({ disabled: !condition() })),
    setLevelClass: vi.fn(),
    setStyle: vi.fn(),
    visibleOnly: vi.fn((condition: () => boolean) => () => ({ visibility: condition() })),
}));
vi.mock("./PaneChangeLog.ts", () => ({ paneChangeLog: vi.fn() }));
vi.mock("./PaneSetup.ts", () => ({ paneSetup: vi.fn() }));
vi.mock("./PaneGeneral.ts", () => ({ paneGeneral: runtime.paneGeneral }));
vi.mock("./PaneRemoteConfig.ts", () => ({ paneRemoteConfig: vi.fn() }));
vi.mock("./PaneSelector.ts", () => ({ paneSelector: vi.fn() }));
vi.mock("./PaneSyncSettings.ts", () => ({ paneSyncSettings: vi.fn() }));
vi.mock("./PaneCustomisationSync.ts", () => ({ paneCustomisationSync: vi.fn() }));
vi.mock("./PaneHatch.ts", () => ({ paneHatch: vi.fn() }));
vi.mock("./PaneAdvanced.ts", () => ({ paneAdvanced: vi.fn() }));
vi.mock("./PanePowerUsers.ts", () => ({ panePowerUsers: vi.fn() }));
vi.mock("./PanePatches.ts", () => ({ panePatches: vi.fn() }));
vi.mock("./PaneMaintenance.ts", () => ({ paneMaintenance: vi.fn() }));

import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { createSettingsPageCatalogue } from "./SettingsPageCatalogue.ts";

function isPage(item: SettingDefinitionItem): item is SettingDefinitionPage {
    return "type" in item && item.type === "page";
}

function createSettingsTab(): ObsidianLiveSyncSettingTab {
    const plugin = {
        app: {},
        core: {
            settings: { ...DEFAULT_SETTINGS, useAdvancedMode: true },
            confirm: {
                askInPopup: vi.fn(),
            },
            services: {
                setting: {
                    getDeviceAndVaultName: vi.fn(() => ""),
                    saveSettingData: vi.fn(async () => undefined),
                },
            },
        },
    };
    const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
    Object.assign(tab, {
        _editingSettings: { ...DEFAULT_SETTINGS, useAdvancedMode: true },
        initialSettings: { ...DEFAULT_SETTINGS, useAdvancedMode: true },
    });
    return tab;
}

beforeEach(() => {
    runtime.components.length = 0;
    runtime.paneGeneral.mockClear();
    runtime.paneGeneral.mockImplementation(function (this: ObsidianLiveSyncSettingTab) {
        this.lifetimeComponent.register(runtime.pageCleanup);
    });
    runtime.pageCleanup.mockClear();
    runtime.savedEffect.mockClear();
    runtime.superHide.mockClear();
});

describe("ObsidianLiveSyncSettingTab native page lifecycle", () => {
    it("returns all catalogue pages and keeps Advanced as native items", () => {
        const tab = createSettingsTab();
        const pages = tab.getSettingDefinitions().filter(isPage);

        expect(pages).toHaveLength(12);
        expect(pages.map(({ name }) => name)).toEqual(
            createSettingsPageCatalogue().map((entry) => `${entry.icon} ${entry.name()}`)
        );
        const advanced = pages.find(({ name }) => name.endsWith(" Advanced"));
        expect(advanced?.items?.filter((item) => "type" in item && item.type === "group")).toHaveLength(4);
        expect(advanced?.items?.filter((item) => "action" in item && typeof item.action === "function")).toHaveLength(
            1
        );
        expect(advanced?.page).toBeUndefined();
        expect(pages.filter(({ page }) => page !== undefined)).toHaveLength(11);
    });

    it("constructs custom page state only when opened and disposes each rendered scope", () => {
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }

        expect(runtime.components).toHaveLength(0);
        const page = general.page();
        expect(runtime.components).toHaveLength(0);

        page.display();
        expect(runtime.paneGeneral).toHaveBeenCalledOnce();
        expect(runtime.components).toHaveLength(1);
        expect(runtime.components[0].load).toHaveBeenCalledOnce();

        page.display();
        expect(runtime.components[0].unload).toHaveBeenCalledOnce();
        expect(runtime.pageCleanup).toHaveBeenCalledOnce();
        expect(runtime.components).toHaveLength(2);

        page.hide();
        expect(runtime.components[1].unload).toHaveBeenCalledOnce();
        expect(runtime.pageCleanup).toHaveBeenCalledTimes(2);
        expect(runtime.superHide).toHaveBeenCalledOnce();
    });

    it("does not run delayed pane work after its page scope has been disposed", async () => {
        runtime.paneGeneral.mockImplementation(function (
            this: ObsidianLiveSyncSettingTab,
            _paneEl: HTMLElement,
            { addPanel }: Pick<PageFunctions, "addPanel">
        ) {
            void addPanel(createElement(), "Delayed panel").then(() => {
                this.lifetimeComponent.register(runtime.pageCleanup);
            });
        });
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }

        const page = general.page();
        page.display();
        page.hide();
        await Promise.resolve();

        expect(runtime.pageCleanup).not.toHaveBeenCalled();
    });

    it("runs a delayed pane callback inside its active scope before a queued hide", async () => {
        runtime.paneGeneral.mockImplementation(function (
            this: ObsidianLiveSyncSettingTab,
            _paneEl: HTMLElement,
            { addPanel }: Pick<PageFunctions, "addPanel">
        ) {
            void addPanel(createElement(), "Delayed panel").then(() => {
                this.lifetimeComponent.register(runtime.pageCleanup);
            });
        });
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }

        const page = general.page();
        page.display();
        queueMicrotask(() => page.hide());
        await Promise.resolve();
        await Promise.resolve();

        expect(runtime.pageCleanup).toHaveBeenCalledOnce();
    });

    it("rebuilds the catalogue when an externally loaded setting changes page visibility", () => {
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }
        general.page().display();
        tab.core.settings.usePowerUserMode = !tab.editingSettings.usePowerUserMode;

        tab.requestReload();

        expect(tab.update).toHaveBeenCalledOnce();
    });

    it("rebuilds translated catalogue names when the display language changes externally", () => {
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }
        general.page().display();
        tab.core.settings.displayLanguage = "ja";

        tab.requestReload();

        expect(tab.update).toHaveBeenCalledOnce();
    });

    it("rebuilds the catalogue after accepting an external page-visibility setting over a dirty value", () => {
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }
        general.page().display();
        tab.initialSettings!.usePowerUserMode = false;
        tab.editingSettings.usePowerUserMode = true;
        tab.core.settings.usePowerUserMode = true;

        tab.requestReload();
        const configureAnchor = vi.mocked(tab.core.confirm.askInPopup).mock.calls[0]?.[2];
        expect(configureAnchor).toBeTypeOf("function");
        let acceptExternalSetting: (() => void) | undefined;
        configureAnchor?.({
            text: "",
            addEventListener: vi.fn((_event: string, callback: () => void) => {
                acceptExternalSetting = callback;
            }),
        } as unknown as HTMLAnchorElement);
        expect(acceptExternalSetting).toBeTypeOf("function");
        vi.mocked(tab.update).mockClear();
        acceptExternalSetting!();

        expect(tab.update).toHaveBeenCalledOnce();
    });

    it("does not reopen a custom page when a catalogue update has already hidden it", () => {
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }
        const page = general.page();
        page.display();
        vi.mocked(tab.update).mockImplementation(() => page.hide());

        tab.requestCatalogueRefresh();

        expect(runtime.paneGeneral).toHaveBeenCalledOnce();
    });

    it("keeps saved-setting effects owned by the tab after a custom page closes", async () => {
        runtime.paneGeneral.mockImplementation(function (this: ObsidianLiveSyncSettingTab) {
            this.addOnSaved("displayLanguage", runtime.savedEffect);
        });
        const tab = createSettingsTab();
        const general = tab.getSettingDefinitions().filter(isPage)[2];
        if (!general?.page) {
            throw new Error("General custom page is unavailable");
        }

        const page = general.page();
        page.display();
        page.hide();
        tab.editingSettings.displayLanguage = "ja";
        await tab.saveSettings(["displayLanguage"]);

        expect(runtime.savedEffect).toHaveBeenCalledOnce();
    });
});
