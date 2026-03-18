import { describe, expect, it, vi, afterEach } from "vitest";
import { eventHub } from "@lib/hub/hub";
import { EVENT_REQUEST_OPEN_P2P_SETTINGS, EVENT_REQUEST_OPEN_SETUP_URI } from "@lib/events/coreEvents";
import { openP2PSettings, openSetupURI, useSetupManagerHandlersFeature } from "./setupManagerHandlers";

vi.mock("@/modules/features/SetupManager", () => {
    return {
        UserMode: {
            Unknown: "unknown",
            Update: "unknown",
        },
    };
});

describe("setupObsidian/setupManagerHandlers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("openSetupURI should delegate to SetupManager.onUseSetupURI", async () => {
        const setupManager = {
            onUseSetupURI: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        await openSetupURI(setupManager);
        expect(setupManager.onUseSetupURI).toHaveBeenCalledWith("unknown");
    });

    it("openP2PSettings should delegate to SetupManager.onP2PManualSetup", async () => {
        const settings = { x: 1 };
        const host = {
            services: {
                setting: {
                    currentSettings: vi.fn(() => settings),
                },
            },
        } as any;
        const setupManager = {
            onP2PManualSetup: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        await openP2PSettings(host, setupManager);
        expect(setupManager.onP2PManualSetup).toHaveBeenCalledWith("unknown", settings, false);
    });

    it("useSetupManagerHandlersFeature should register onLoaded handler that wires command and events", async () => {
        const addHandler = vi.fn();
        const addCommand = vi.fn();
        const onEventSpy = vi.spyOn(eventHub, "onEvent");

        const host = {
            services: {
                API: {
                    addCommand,
                },
                appLifecycle: {
                    onLoaded: {
                        addHandler,
                    },
                },
                setting: {
                    currentSettings: vi.fn(() => ({ x: 1 })),
                },
            },
        } as any;
        const setupManager = {
            onUseSetupURI: vi.fn(async () => await Promise.resolve(true)),
            onP2PManualSetup: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        useSetupManagerHandlersFeature(host, setupManager);
        expect(addHandler).toHaveBeenCalledTimes(1);

        const loadedHandler = addHandler.mock.calls[0][0] as () => Promise<boolean>;
        await loadedHandler();

        expect(addCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "livesync-opensetupuri",
                name: "Use the copied setup URI (Formerly Open setup URI)",
            })
        );
        expect(onEventSpy).toHaveBeenCalledWith(EVENT_REQUEST_OPEN_SETUP_URI, expect.any(Function));
        expect(onEventSpy).toHaveBeenCalledWith(EVENT_REQUEST_OPEN_P2P_SETTINGS, expect.any(Function));
    });
});
