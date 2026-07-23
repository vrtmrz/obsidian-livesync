import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { eventHub, EVENT_REQUEST_OPEN_P2P } from "@/common/events";

vi.mock("@/features/P2PSync/P2PReplicator/P2PServerStatusPaneView", () => ({
    P2PServerStatusPaneView: class {
        getViewType() {
            return "p2p-status";
        }
    },
    VIEW_TYPE_P2P_SERVER_STATUS: "p2p-status",
}));

import { useP2PReplicatorUI } from "./useP2PReplicatorUI";

describe("useP2PReplicatorUI commands", () => {
    it("waits for settings to load before deciding whether to show the P2P ribbon", async () => {
        let initialise: (() => Promise<unknown>) | undefined;
        let settingLoaded: (() => Promise<unknown>) | undefined;
        let settings: Record<string, unknown> | undefined;
        const currentSettings = vi.fn(() => settings);
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    showWindow: vi.fn(async () => undefined),
                    registerWindow: vi.fn(),
                    addCommand: vi.fn(),
                    addRibbonIcon: vi.fn(),
                },
                appLifecycle: {
                    onInitialise: {
                        addHandler: vi.fn((handler) => {
                            initialise = handler;
                        }),
                    },
                    onSettingLoaded: {
                        addHandler: vi.fn((handler) => {
                            settingLoaded = handler;
                        }),
                    },
                    onLayoutReady: { addHandler: vi.fn() },
                },
                setting: {
                    currentSettings,
                    onSettingSaved: { addHandler: vi.fn() },
                },
                replicator: { runFiniteReplicationActivity: vi.fn() },
            },
        } as any;

        useP2PReplicatorUI(host, {} as any, { replicator: undefined } as any);

        await expect(initialise?.()).resolves.toBe(true);
        expect(currentSettings).not.toHaveBeenCalled();
        settings = {
            remoteType: "COUCHDB",
            remoteConfigurations: {},
        };
        await expect(settingLoaded?.()).resolves.toBe(true);
        expect(currentSettings).toHaveBeenCalledOnce();
    });

    it("exposes a direct modal P2P replication command as finite replication activity", async () => {
        const commands: Array<{ id: string; checkCallback?: (isChecking: boolean) => unknown }> = [];
        let initialise: (() => Promise<unknown>) | undefined;
        const openReplication = vi.fn(async () => true);
        const runFiniteReplicationActivity = vi.fn(async (task: () => unknown) => await task());
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    showWindow: vi.fn(async () => undefined),
                    registerWindow: vi.fn(),
                    addCommand: vi.fn((command) => commands.push(command)),
                    addRibbonIcon: vi.fn(),
                    getPlatform: vi.fn(() => "obsidian"),
                },
                appLifecycle: {
                    onInitialise: {
                        addHandler: vi.fn((handler) => {
                            initialise = handler;
                        }),
                    },
                    onSettingLoaded: { addHandler: vi.fn() },
                    onLayoutReady: { addHandler: vi.fn() },
                },
                setting: { currentSettings: vi.fn(() => ({ remoteType: "COUCHDB" })) },
                replicator: { runFiniteReplicationActivity },
            },
        } as any;
        const p2p = {
            replicator: {
                server: { isServing: true },
                openReplication,
                replicateFromCommand: vi.fn(),
            },
        } as any;

        useP2PReplicatorUI(host, {} as any, p2p);
        await initialise?.();
        commands.find((command) => command.id === "replicate-now-by-p2p")?.checkCallback?.(false);

        await vi.waitFor(() => expect(openReplication).toHaveBeenCalledOnce());
        expect(runFiniteReplicationActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "replication",
        });
    });

    it("keeps the current replicator in the pane parameters after replacement", () => {
        const first = { id: "first" };
        const second = { id: "second" };
        let current = first;
        const p2p = {
            get replicator() {
                return current;
            },
        } as any;
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    showWindow: vi.fn(async () => undefined),
                    registerWindow: vi.fn(),
                    addCommand: vi.fn(),
                    addRibbonIcon: vi.fn(),
                    getPlatform: vi.fn(() => "obsidian"),
                },
                appLifecycle: {
                    onInitialise: { addHandler: vi.fn() },
                    onSettingLoaded: { addHandler: vi.fn() },
                    onLayoutReady: { addHandler: vi.fn() },
                },
                setting: { currentSettings: vi.fn(() => ({ remoteType: "COUCHDB" })) },
                replicator: { runFiniteReplicationActivity: vi.fn() },
            },
        } as any;

        const paneParams = useP2PReplicatorUI(host, {} as any, p2p);
        current = second;

        expect(paneParams.replicator).toBe(second);
    });

    it("retains only the current P2P status command and routes existing open requests to it", async () => {
        const commands: Array<{ id: string; callback?: () => void }> = [];
        let initialise: (() => Promise<unknown>) | undefined;
        const showWindow = vi.fn(async () => undefined);
        const showWindowOnRight = vi.fn(async () => undefined);
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    showWindow,
                    showWindowOnRight,
                    registerWindow: vi.fn(),
                    addCommand: vi.fn((command) => commands.push(command)),
                    addRibbonIcon: vi.fn(),
                    getPlatform: vi.fn(() => "desktop"),
                },
                appLifecycle: {
                    onInitialise: {
                        addHandler: vi.fn((handler) => {
                            initialise = handler;
                        }),
                    },
                    onSettingLoaded: { addHandler: vi.fn() },
                    onLayoutReady: { addHandler: vi.fn() },
                },
                setting: {
                    currentSettings: vi.fn(() => ({
                        remoteType: "COUCHDB",
                        remoteConfigurations: {},
                    })),
                },
                replicator: { runFiniteReplicationActivity: vi.fn() },
            },
        } as any;
        const p2p = { replicator: undefined } as any;

        useP2PReplicatorUI(host, {} as any, p2p);
        await initialise?.();

        expect(commands.map((command) => command.id)).not.toContain("open-p2p-replicator");
        expect(commands.map((command) => command.id)).toContain("open-p2p-server-status");

        eventHub.emitEvent(EVENT_REQUEST_OPEN_P2P);
        await vi.waitFor(() => expect(showWindowOnRight).toHaveBeenCalledWith("p2p-status"));
        expect(showWindow).not.toHaveBeenCalledWith("p2p");
    });

    it("does not open the P2P status pane automatically when the workspace becomes ready", async () => {
        let layoutReady: (() => Promise<unknown>) | undefined;
        const showWindow = vi.fn(async () => undefined);
        const showWindowOnRight = vi.fn(async () => undefined);
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    showWindow,
                    showWindowOnRight,
                    registerWindow: vi.fn(),
                    addCommand: vi.fn(),
                    addRibbonIcon: vi.fn(),
                    getPlatform: vi.fn(() => "obsidian"),
                },
                appLifecycle: {
                    onInitialise: { addHandler: vi.fn() },
                    onSettingLoaded: { addHandler: vi.fn() },
                    onLayoutReady: {
                        addHandler: vi.fn((handler) => {
                            layoutReady = handler;
                        }),
                    },
                },
                setting: {
                    currentSettings: vi.fn(() => ({
                        remoteType: "COUCHDB",
                        remoteConfigurations: {},
                    })),
                },
                replicator: { runFiniteReplicationActivity: vi.fn() },
            },
        } as any;

        useP2PReplicatorUI(host, {} as any, { replicator: undefined } as any);
        await layoutReady?.();

        expect(showWindow).not.toHaveBeenCalled();
        expect(showWindowOnRight).not.toHaveBeenCalled();
    });

    it("shows the ribbon only whilst a P2P configuration exists", async () => {
        let initialise: (() => Promise<unknown>) | undefined;
        let settingLoaded: (() => Promise<unknown>) | undefined;
        let onSettingSaved: ((settings: unknown) => Promise<unknown>) | undefined;
        let currentSettings: any = {
            remoteType: "COUCHDB",
            remoteConfigurations: {},
            P2P_Enabled: false,
            P2P_roomID: "",
            P2P_passphrase: "",
        };
        const ribbon = { addClass: vi.fn(), remove: vi.fn() };
        const addRibbonIcon = vi.fn(() => ribbon);
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    showWindow: vi.fn(async () => undefined),
                    showWindowOnRight: vi.fn(async () => undefined),
                    registerWindow: vi.fn(),
                    addCommand: vi.fn(),
                    addRibbonIcon,
                    getPlatform: vi.fn(() => "desktop"),
                },
                appLifecycle: {
                    onInitialise: {
                        addHandler: vi.fn((handler) => {
                            initialise = handler;
                        }),
                    },
                    onSettingLoaded: {
                        addHandler: vi.fn((handler) => {
                            settingLoaded = handler;
                        }),
                    },
                    onLayoutReady: { addHandler: vi.fn() },
                },
                setting: {
                    currentSettings: vi.fn(() => currentSettings),
                    onSettingSaved: {
                        addHandler: vi.fn((handler) => {
                            onSettingSaved = handler;
                        }),
                    },
                },
                replicator: { runFiniteReplicationActivity: vi.fn() },
            },
        } as any;

        useP2PReplicatorUI(host, {} as any, { replicator: undefined } as any);
        await initialise?.();
        await settingLoaded?.();
        expect(addRibbonIcon).not.toHaveBeenCalled();

        currentSettings = {
            ...currentSettings,
            remoteConfigurations: {
                peer: {
                    id: "peer",
                    name: "Peer",
                    uri: "sls+p2p://room?passphrase=secret",
                    isEncrypted: false,
                },
            },
        };
        await onSettingSaved?.(currentSettings);
        expect(addRibbonIcon).toHaveBeenCalledOnce();

        await onSettingSaved?.(currentSettings);
        expect(addRibbonIcon).toHaveBeenCalledOnce();

        currentSettings = {
            ...currentSettings,
            remoteConfigurations: {},
        };
        await onSettingSaved?.(currentSettings);
        expect(ribbon.remove).toHaveBeenCalledOnce();
    });

    it("replaces a restored legacy P2P leaf with the current status view without opening another leaf", async () => {
        let layoutReady: (() => Promise<unknown>) | undefined;
        const legacyLeaf = {
            setViewState: vi.fn(async () => undefined),
        };
        const workspace = {
            getLeavesOfType: vi.fn((type: string) => (type === "p2p-replicator" ? [legacyLeaf] : [])),
        };
        const context = createServiceContext() as ReturnType<typeof createServiceContext> & {
            app: { workspace: typeof workspace };
        };
        context.app = { workspace };
        const showWindow = vi.fn(async () => undefined);
        const showWindowOnRight = vi.fn(async () => undefined);
        const host = {
            services: {
                context,
                API: {
                    showWindow,
                    showWindowOnRight,
                    registerWindow: vi.fn(),
                    addCommand: vi.fn(),
                    addRibbonIcon: vi.fn(),
                    getPlatform: vi.fn(() => "desktop"),
                },
                appLifecycle: {
                    onInitialise: { addHandler: vi.fn() },
                    onSettingLoaded: { addHandler: vi.fn() },
                    onLayoutReady: {
                        addHandler: vi.fn((handler) => {
                            layoutReady = handler;
                        }),
                    },
                },
                setting: {
                    currentSettings: vi.fn(() => ({
                        remoteType: "COUCHDB",
                        remoteConfigurations: {},
                    })),
                },
                replicator: { runFiniteReplicationActivity: vi.fn() },
            },
        } as any;

        useP2PReplicatorUI(host, {} as any, { replicator: undefined } as any);
        await layoutReady?.();

        expect(legacyLeaf.setViewState).toHaveBeenCalledWith({
            type: "p2p-status",
            active: false,
        });
        expect(showWindow).not.toHaveBeenCalled();
        expect(showWindowOnRight).not.toHaveBeenCalled();
    });
});
