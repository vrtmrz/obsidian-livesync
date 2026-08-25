import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SettingDefinitionGroup, SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import type { PageFunctions } from "./SettingPane.ts";

const runtime = vi.hoisted(() => ({
    components: [] as Array<{
        load: ReturnType<typeof vi.fn>;
        unload: ReturnType<typeof vi.fn>;
        callbacks: Array<() => unknown>;
    }>,
    paneChangeLog: vi.fn(),
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
    EVENT_ON_UNRESOLVED_ERROR: "on-unresolved-error",
    EVENT_REQUEST_COPY_SETUP_URI: "request-copy-setup-uri",
    EVENT_REQUEST_OPEN_SETUP_URI: "request-open-setup-uri",
    EVENT_REQUEST_RELOAD_SETTING_TAB: "request-reload-setting-tab",
    EVENT_REQUEST_SHOW_SETUP_QR: "request-show-setup-qr",
    eventHub: { emitEvent: vi.fn(), onEvent: vi.fn() },
}));
vi.mock("@/modules/features/SetupManager.ts", () => ({ SetupManager: class {} }));
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
vi.mock("./PaneChangeLog.ts", () => ({ paneChangeLog: runtime.paneChangeLog }));
vi.mock("./PaneQuickSetup.ts", () => ({ paneQuickSetup: vi.fn() }));
vi.mock("./PaneHelp.ts", () => ({ paneHelp: vi.fn() }));
vi.mock("./PaneGeneral.ts", () => ({ paneGeneral: vi.fn() }));
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

function isGroup(item: SettingDefinitionItem): item is SettingDefinitionGroup {
    return "type" in item && item.type === "group";
}

function isAction(item: SettingDefinitionItem): item is Extract<SettingDefinitionItem, { action: unknown }> {
    return "action" in item && typeof item.action === "function";
}

function itemLabel(item: SettingDefinitionItem): string {
    if (isPage(item)) return item.name;
    if (isGroup(item)) return item.heading ?? "";
    return item.name;
}

function collectPages(items: readonly SettingDefinitionItem[]): SettingDefinitionPage[] {
    return items.flatMap((item) => {
        if (isPage(item)) return [item, ...collectPages(item.items ?? [])];
        if (isGroup(item)) return collectPages(item.items ?? []);
        return [];
    });
}

function findPage(tab: ObsidianLiveSyncSettingTab, name: string): SettingDefinitionPage {
    const page = collectPages(tab.getSettingDefinitions()).find((candidate) => candidate.name.endsWith(` ${name}`));
    if (!page) throw new Error(`${name} custom page is unavailable`);
    return page;
}

type SettingsTabOptions = {
    activeReplicatorGetter?: () => { syncStatus: "CONNECTED" | "PAUSED" } | undefined;
    replicationStatus?: "CLOSED" | "CONNECTED" | "PAUSED";
};

function createSettingsTab(options: SettingsTabOptions = {}): ObsidianLiveSyncSettingTab {
    const core = {
        settings: { ...DEFAULT_SETTINGS, useAdvancedMode: true },
        confirm: {
            askInPopup: vi.fn(),
        },
        services: {
            setting: {
                getDeviceAndVaultName: vi.fn(() => ""),
                saveSettingData: vi.fn(async () => undefined),
            },
            replicator: {
                replicationStatics: {
                    value: { syncStatus: options.replicationStatus ?? "CLOSED" },
                },
            },
        },
    };
    Object.defineProperty(core, "replicator", {
        get: options.activeReplicatorGetter ?? (() => undefined),
    });
    const plugin = {
        app: {},
        core,
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
    runtime.paneChangeLog.mockClear();
    runtime.paneChangeLog.mockImplementation(function (this: ObsidianLiveSyncSettingTab) {
        this.lifetimeComponent.register(runtime.pageCleanup);
    });
    runtime.pageCleanup.mockClear();
    runtime.savedEffect.mockClear();
    runtime.superHide.mockClear();
});

describe("ObsidianLiveSyncSettingTab native page lifecycle", () => {
    it("builds definitions before database readiness without requesting the active replicator", () => {
        const activeReplicatorGetter = vi.fn(() => {
            throw new Error("The active replicator is not ready");
        });
        const tab = createSettingsTab({ activeReplicatorGetter });

        expect(() => tab.getSettingDefinitions()).not.toThrow();
        expect(activeReplicatorGetter).not.toHaveBeenCalled();
    });

    it("keeps Quick Setup first while LiveSync is not configured, regardless of transient replication status", () => {
        const tab = createSettingsTab({ replicationStatus: "CONNECTED" });
        tab.editingSettings.isConfigured = false;
        const definitions = tab.getSettingDefinitions().filter(isGroup);

        expect(definitions[0]?.heading).toBe("🧙‍♂️ Quick Setup");
    });

    it("keeps Quick Setup first while LiveSync is not configured and separates synchronisation pages from it", () => {
        const tab = createSettingsTab();
        tab.editingSettings.isConfigured = false;
        const definitions = tab.getSettingDefinitions().filter(isGroup);

        expect(definitions.slice(0, 3).map(itemLabel)).toEqual([
            "🧙‍♂️ Quick Setup",
            "🔄 Synchronisation",
            "⚙️ General Settings",
        ]);
    });

    it("keeps the synchronisation group first for a configured device with automatic triggers disabled", () => {
        const tab = createSettingsTab();
        tab.editingSettings.isConfigured = true;
        const definitions = tab.getSettingDefinitions().filter(isGroup);

        expect(definitions.slice(0, 4).map(itemLabel)).toEqual([
            "🔄 Synchronisation",
            "⚙️ General Settings",
            "📲 Set up other devices",
            "🧙‍♂️ Quick Setup",
        ]);
    });

    it("keeps the pending initialisation action visible on the root settings page", () => {
        const tab = createSettingsTab();
        tab.editingSettings.handleFilenameCaseSensitive = !tab.initialSettings!.handleFilenameCaseSensitive;

        const action = tab.getSettingDefinitions().find(isAction);

        expect(action?.name).toBe("Apply");
        expect(typeof action?.visible === "function" ? action.visible() : action?.visible).toBe(true);
    });

    it("keeps Remote Configuration and Sync Settings as native pages inside the Synchronisation group", () => {
        const tab = createSettingsTab();
        const definitions = tab.getSettingDefinitions();
        const synchronisation = definitions.find(
            (item): item is SettingDefinitionGroup => isGroup(item) && item.heading === "🔄 Synchronisation"
        );

        expect(synchronisation?.items?.filter(isPage).map(({ name }) => name)).toEqual([
            "🛰️ Remote Configuration",
            "🔄 Sync Settings",
        ]);
        expect(
            definitions
                .filter(isPage)
                .map(({ name }) => name)
                .filter((name) => name.endsWith(" Remote Configuration") || name.endsWith(" Sync Settings"))
        ).toEqual([]);
    });

    it("groups secondary pages by purpose instead of exposing a flat Detailed settings list", () => {
        const tab = createSettingsTab();
        const definitions = tab.getSettingDefinitions();
        const groups = definitions.filter(isGroup);

        expect(groups.map(({ heading }) => heading)).toEqual([
            "🧙‍♂️ Quick Setup",
            "🔄 Synchronisation",
            "⚙️ General Settings",
            "📲 Set up other devices",
            "🛠️ Maintenance and recovery",
            "🧩 Extra features",
            "🔧 Advanced settings",
            "ℹ️ Help and information",
        ]);
        expect(
            groups
                .find(({ heading }) => heading === "🛠️ Maintenance and recovery")
                ?.items?.filter(isPage)
                .map(({ name }) => name)
        ).toEqual(["🎛️ Maintenance", "🧰 Hatch"]);
        expect(
            groups
                .find(({ heading }) => heading === "🧩 Extra features")
                ?.items?.filter(isPage)
                .map(({ name }) => name)
        ).toEqual(["🚦 Selector", "🔌 Customisation sync"]);
        expect(
            groups
                .find(({ heading }) => heading === "🔧 Advanced settings")
                ?.items?.filter(isPage)
                .map(({ name }) => name)
        ).toEqual(["🔧 Advanced", "💪 Power users", "🩹 Patches"]);
        expect(
            groups
                .find(({ heading }) => heading === "ℹ️ Help and information")
                ?.items?.filter(isPage)
                .map(({ name }) => name)
        ).toEqual(["❓ Help and troubleshooting", "💬 Change Log"]);
        expect(
            groups.find(({ heading }) => heading === "📲 Set up other devices")?.items?.map(({ name }) => name)
        ).toEqual(["Copy the current settings to a Setup URI", "Show QR code"]);
    });

    it("keeps Appearance, Logging, and Extra menus inside General Settings", () => {
        const tab = createSettingsTab();
        const definitions = tab.getSettingDefinitions();
        const general = definitions.find(
            (item): item is SettingDefinitionGroup => isGroup(item) && item.heading === "⚙️ General Settings"
        );
        const generalPages = general?.items?.filter(isPage);
        const appearance = generalPages?.find(({ name }) => name === "🎨 Appearance");
        const logging = generalPages?.find(({ name }) => name === "📝 Logging");
        const extraMenus = general?.items?.find(
            (item): item is SettingDefinitionPage => isPage(item) && item.name === "🎚️ Extra menus"
        );

        expect(generalPages?.map(({ name }) => name)).toEqual(["🎨 Appearance", "📝 Logging", "🎚️ Extra menus"]);
        expect(
            appearance?.items?.flatMap((item) => ("control" in item && item.control ? [item.control.key] : []))
        ).toEqual([
            "displayLanguage",
            "showStatusOnEditor",
            "showOnlyIconsOnEditor",
            "showStatusOnStatusbar",
            "hideFileWarningNotice",
            "networkWarningStyle",
        ]);
        expect(
            logging?.items?.flatMap((item) => ("control" in item && item.control ? [item.control.key] : []))
        ).toEqual(["lessInformationInLog", "showVerboseLog"]);
        expect(
            extraMenus?.items?.flatMap((item) => ("control" in item && item.control ? [item.control.key] : []))
        ).toEqual(["useAdvancedMode", "usePowerUserMode", "useEdgeCaseMode"]);
    });

    it("omits the old Setup child page and keeps standard General and Advanced pages native", () => {
        const tab = createSettingsTab();
        const pages = collectPages(tab.getSettingDefinitions());

        expect(pages).toHaveLength(14);
        expect(pages.map(({ name }) => name)).toEqual(
            expect.arrayContaining(
                createSettingsPageCatalogue()
                    .filter(({ id }) => id !== "general" && id !== "quick-setup")
                    .map((entry) => `${entry.icon} ${entry.name()}`)
            )
        );
        expect(pages.some(({ name }) => name.endsWith(" General Settings"))).toBe(false);
        expect(pages.some(({ name }) => name.endsWith(" Setup"))).toBe(false);
        const advanced = pages.find(({ name }) => name.endsWith(" Advanced"));
        expect(advanced?.items?.filter((item) => "type" in item && item.type === "group")).toHaveLength(4);
        expect(advanced?.items?.filter((item) => "action" in item && typeof item.action === "function")).toHaveLength(
            1
        );
        expect(advanced?.page).toBeUndefined();
        expect(pages.filter(({ page }) => page !== undefined)).toHaveLength(10);
    });

    it("keeps simple setup actions on the landing page without a second Setup destination", () => {
        const tab = createSettingsTab();
        const definitions = tab.getSettingDefinitions();
        const quickSetup = definitions.find(
            (item): item is SettingDefinitionGroup => isGroup(item) && item.heading === "🧙‍♂️ Quick Setup"
        );

        expect(quickSetup?.items?.map(({ name }) => name)).toEqual([
            "Connect with Setup URI",
            "Rerun Onboarding Wizard",
            "Enable LiveSync",
        ]);
        expect(collectPages(definitions).some(({ name }) => name.endsWith(" Setup"))).toBe(false);
    });

    it("constructs custom page state only when opened and disposes each rendered scope", () => {
        const tab = createSettingsTab();
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }

        expect(runtime.components).toHaveLength(0);
        const page = changeLog.page();
        expect(runtime.components).toHaveLength(0);

        page.display();
        expect(runtime.paneChangeLog).toHaveBeenCalledOnce();
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
        runtime.paneChangeLog.mockImplementation(function (
            this: ObsidianLiveSyncSettingTab,
            _paneEl: HTMLElement,
            { addPanel }: Pick<PageFunctions, "addPanel">
        ) {
            void addPanel(createElement(), "Delayed panel").then(() => {
                this.lifetimeComponent.register(runtime.pageCleanup);
            });
        });
        const tab = createSettingsTab();
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }

        const page = changeLog.page();
        page.display();
        page.hide();
        await Promise.resolve();

        expect(runtime.pageCleanup).not.toHaveBeenCalled();
    });

    it("runs a delayed pane callback inside its active scope before a queued hide", async () => {
        runtime.paneChangeLog.mockImplementation(function (
            this: ObsidianLiveSyncSettingTab,
            _paneEl: HTMLElement,
            { addPanel }: Pick<PageFunctions, "addPanel">
        ) {
            void addPanel(createElement(), "Delayed panel").then(() => {
                this.lifetimeComponent.register(runtime.pageCleanup);
            });
        });
        const tab = createSettingsTab();
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }

        const page = changeLog.page();
        page.display();
        queueMicrotask(() => page.hide());
        await Promise.resolve();
        await Promise.resolve();

        expect(runtime.pageCleanup).toHaveBeenCalledOnce();
    });

    it("rebuilds the catalogue when an externally loaded setting changes page visibility", () => {
        const tab = createSettingsTab();
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }
        changeLog.page().display();
        tab.core.settings.usePowerUserMode = !tab.editingSettings.usePowerUserMode;

        tab.requestReload();

        expect(tab.update).toHaveBeenCalledOnce();
    });

    it("rebuilds the catalogue after an Extra menus feature level is saved", async () => {
        const tab = createSettingsTab();
        tab.editingSettings.usePowerUserMode = true;

        await tab.saveSettings(["usePowerUserMode"]);

        expect(tab.update).toHaveBeenCalledOnce();
    });

    it("rebuilds translated catalogue names when the display language changes externally", () => {
        const tab = createSettingsTab();
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }
        changeLog.page().display();
        tab.core.settings.displayLanguage = "ja";

        tab.requestReload();

        expect(tab.update).toHaveBeenCalledOnce();
    });

    it("rebuilds the catalogue after accepting an external page-visibility setting over a dirty value", () => {
        const tab = createSettingsTab();
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }
        changeLog.page().display();
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
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }
        const page = changeLog.page();
        page.display();
        vi.mocked(tab.update).mockImplementation(() => page.hide());

        tab.requestCatalogueRefresh();

        expect(runtime.paneChangeLog).toHaveBeenCalledOnce();
    });

    it("keeps saved-setting effects owned by the tab after a custom page closes", async () => {
        runtime.paneChangeLog.mockImplementation(function (this: ObsidianLiveSyncSettingTab) {
            this.addOnSaved("displayLanguage", runtime.savedEffect);
        });
        const tab = createSettingsTab();
        const changeLog = findPage(tab, "Change Log");
        if (!changeLog.page) {
            throw new Error("Change Log custom page is unavailable");
        }

        const page = changeLog.page();
        page.display();
        page.hide();
        tab.editingSettings.displayLanguage = "ja";
        await tab.saveSettings(["displayLanguage"]);

        expect(runtime.savedEffect).toHaveBeenCalledOnce();
    });
});
