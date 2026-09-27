import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
    buttonClasses: [] as string[],
    clickHandlers: [] as Array<() => Promise<void> | void>,
    panels: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
    settingClasses: [] as string[],
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/common/types", () => ({
    DEFAULT_SETTINGS: {},
    LOG_LEVEL_NOTICE: 1,
    LOG_LEVEL_VERBOSE: 2,
    REMOTE_COUCHDB: "couchdb",
    REMOTE_MINIO: "minio",
    REMOTE_P2P: "p2p",
}));
vi.mock("@/deps.ts", () => ({
    Menu: class {},
}));
vi.mock("@/common/translation", () => ({
    $msg: (message: string) => message,
}));
vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class {
        nameEl = { addClass: vi.fn(), appendText: vi.fn() };
        settingEl = {
            classList: {
                toggle: (value: string, enabled: boolean) => {
                    if (enabled) runtime.settingClasses.push(value);
                },
            },
        };

        setName() {
            return this;
        }

        setDesc() {
            return this;
        }

        addButton(callback: (button: unknown) => void) {
            const button = {
                buttonEl: {
                    classList: {
                        toggle: (value: string, enabled: boolean) => {
                            if (enabled) runtime.buttonClasses.push(value);
                        },
                    },
                },
                setDestructive() {
                    return this;
                },
                onClick(callback: () => Promise<void> | void) {
                    runtime.clickHandlers.push(callback);
                    return this;
                },
                setButtonText() {
                    return this;
                },
            };
            callback(button);
            return this;
        }

        autoWireNumeric() {
            return this;
        }
    },
}));
vi.mock("./InfoPanel.svelte", () => ({ default: {} }));
vi.mock("./SveltePanel.ts", () => ({
    SveltePanel: class {
        destroy = vi.fn();

        constructor() {
            runtime.panels.push(this);
        }
    },
}));
vi.mock("./settingUtils.ts", () => ({
    getE2EEConfigSummary: vi.fn(() => ({ summary: "summary" })),
}));
vi.mock("@/modules/features/SetupManager.ts", () => ({
    SetupManager: class {},
    UserMode: { Update: "update" },
}));
vi.mock("./settingConstants.ts", () => ({
    OnDialogSettingsDefault: {},
}));
vi.mock("@vrtmrz/livesync-commonlib/remote-configurations", () => ({
    activateRemoteConfiguration: vi.fn(),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/ConnectionString", () => ({
    ConnectionStringParser: {
        parse: vi.fn(),
        serialize: vi.fn(() => ""),
    },
}));
vi.mock("@/modules/features/SetupWizard/dialogs/SetupRemote.svelte", () => ({ default: {} }));
vi.mock("@/modules/features/SetupWizard/dialogs/SetupRemoteE2EE.svelte", () => ({ default: {} }));
vi.mock("@/modules/features/SetupWizard/dialogs/SetupRemoteCouchDB.svelte", () => ({ default: {} }));
vi.mock("@/modules/features/SetupWizard/dialogs/SetupRemoteBucket.svelte", () => ({ default: {} }));
vi.mock("@/modules/features/SetupWizard/dialogs/SetupRemoteP2P.svelte", () => ({ default: {} }));
vi.mock("./remoteConfigBuffer.ts", () => ({
    syncActivatedRemoteSettings: vi.fn(),
}));

import { paneRemoteConfig } from "./PaneRemoteConfig.ts";

function createPanelElement(): HTMLElement {
    return {
        createDiv: vi.fn(() => ({ empty: vi.fn() })),
    } as unknown as HTMLElement;
}

afterEach(() => {
    runtime.buttonClasses.length = 0;
    runtime.clickHandlers.length = 0;
    runtime.panels.length = 0;
    runtime.settingClasses.length = 0;
    vi.clearAllMocks();
});

describe("paneRemoteConfig", () => {
    it("destroys the E2EE info panel when the settings page lifetime unloads", async () => {
        const callbacks: Array<() => unknown> = [];
        const lifetimeComponent = {
            register: vi.fn((callback: () => unknown) => callbacks.push(callback)),
            unload: vi.fn(() => callbacks.splice(0).forEach((callback) => callback())),
        };
        const addPanel = vi.fn((_parent: HTMLElement, heading: string) => ({
            then(callback: (paneEl: HTMLElement) => void) {
                if (heading === "E2EE Configuration") {
                    callback(createPanelElement());
                }
            },
        }));
        const host = {
            editingSettings: { remoteConfigurations: {} },
            core: { settings: { remoteConfigurations: {} } },
            lifetimeComponent,
        };

        paneRemoteConfig.call(host as never, {} as HTMLElement, { addPanel } as never);
        await vi.waitFor(() => expect(runtime.panels).toHaveLength(1));
        expect(runtime.settingClasses).toContain("sls-setting-with-additional-actions");
        expect(runtime.buttonClasses).toEqual(["sls-setting-additional-action"]);

        lifetimeComponent.unload();

        expect(runtime.panels[0].destroy).toHaveBeenCalledOnce();
    });

    it("applies an internal Metadata preference change without scheduling setup initialisation", async () => {
        const originalSettings = {
            encrypt: true,
            passphrase: "passphrase",
            E2EEAlgorithm: "v2",
            usePathObfuscation: true,
            encryptInternalMetadata: false,
            remoteConfigurations: {},
        };
        const setupManager = {
            onlyE2EEConfiguration: vi.fn(async () => {
                host.core.settings.encryptInternalMetadata = true;
                return true;
            }),
        };
        const host = {
            editingSettings: { ...originalSettings },
            initialSettings: { ...originalSettings },
            core: {
                settings: { ...originalSettings },
                getModule: vi.fn(() => setupManager),
            },
            lifetimeComponent: { register: vi.fn() },
            requestUpdate: vi.fn(),
        };
        const addPanel = vi.fn((_parent: HTMLElement, heading: string) => ({
            then(callback: (paneEl: HTMLElement) => void) {
                if (heading === "E2EE Configuration") {
                    callback(createPanelElement());
                }
            },
        }));

        paneRemoteConfig.call(host as never, {} as HTMLElement, { addPanel } as never);
        await runtime.clickHandlers[0]();

        expect(setupManager.onlyE2EEConfiguration).toHaveBeenCalledOnce();
        expect(host.editingSettings.encryptInternalMetadata).toBe(true);
        expect(host.initialSettings.encryptInternalMetadata).toBe(true);
        expect(host.requestUpdate).toHaveBeenCalledOnce();
    });
});
