import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
    panels: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
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

        setName() {
            return this;
        }

        setDesc() {
            return this;
        }

        setClass() {
            return this;
        }

        addButton() {
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
    runtime.panels.length = 0;
    vi.clearAllMocks();
});

describe("paneRemoteConfig", () => {
    it("destroys the E2EE info panel when the settings page lifetime unloads", async () => {
        const callbacks: Array<() => unknown> = [];
        const lifetimeComponent = {
            register: vi.fn((callback: () => unknown) => callbacks.push(callback)),
            unload: vi.fn(() => callbacks.splice(0).forEach((callback) => callback())),
        };
        const addPanel = vi.fn((_parent: HTMLElement, _heading: string) => Promise.resolve(createPanelElement()));
        const host = {
            editingSettings: { remoteConfigurations: {} },
            core: { settings: { remoteConfigurations: {} } },
            lifetimeComponent,
        };

        paneRemoteConfig.call(host as never, {} as HTMLElement, { addPanel } as never);
        await vi.waitFor(() => expect(runtime.panels).toHaveLength(1));

        lifetimeComponent.unload();

        expect(runtime.panels[0].destroy).toHaveBeenCalledOnce();
    });
});
