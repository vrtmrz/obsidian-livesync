import { describe, expect, it, vi, afterEach } from "vitest";
import { registerSetupProtocolHandler, useSetupProtocolFeature } from "./setupProtocol";

vi.mock("@/common/types", () => {
    return {
        configURIBase: "mock-config://",
        configURIBaseV2: "mock-config-v2://",
    };
});

vi.mock("@/modules/features/SetupManager", () => {
    return {
        UserMode: {
            Unknown: "unknown",
            Update: "unknown",
        },
    };
});

describe("setupObsidian/setupProtocol", () => {
    it("routes the versioned encrypted payload through the matching URI format", async () => {
        const handlers = new Map<string, (params: Record<string, string>) => Promise<void>>();
        const host = {
            services: { API: { registerProtocolHandler: vi.fn((action, handler) => handlers.set(action, handler)) } },
        } as any;
        const setupManager = { onUseSetupURI: vi.fn(), decodeQR: vi.fn() } as any;
        registerSetupProtocolHandler(host, vi.fn(), setupManager);
        await handlers.get("setuplivesync-v2")!({ settings: "encrypted settings" });
        expect(setupManager.onUseSetupURI).toHaveBeenCalledWith("unknown", "mock-config-v2://encrypted%20settings");
        await handlers.get("setuplivesync-v2")!({ settingsQR: "plain settings" });
        expect(setupManager.decodeQR).not.toHaveBeenCalled();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("registerSetupProtocolHandler should route settings payload to onUseSetupURI", async () => {
        let protocolHandler: ((params: Record<string, string>) => Promise<void>) | undefined;
        const host = {
            services: {
                API: {
                    registerProtocolHandler: vi.fn(
                        (_action: string, handler: (params: Record<string, string>) => Promise<void>) => {
                            protocolHandler = handler;
                        }
                    ),
                },
            },
        } as any;
        const log = vi.fn();
        const setupManager = {
            onUseSetupURI: vi.fn(async () => await Promise.resolve(true)),
            decodeQR: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        registerSetupProtocolHandler(host, log, setupManager);
        expect(host.services.API.registerProtocolHandler).toHaveBeenCalledWith("setuplivesync", expect.any(Function));

        await protocolHandler!({ settings: "a b" });
        expect(setupManager.onUseSetupURI).toHaveBeenCalledWith(
            "unknown",
            `mock-config://${encodeURIComponent("a b")}`
        );
        expect(setupManager.decodeQR).not.toHaveBeenCalled();
    });

    it("registerSetupProtocolHandler should route settingsQR payload to decodeQR", async () => {
        let protocolHandler: ((params: Record<string, string>) => Promise<void>) | undefined;
        const host = {
            services: {
                API: {
                    registerProtocolHandler: vi.fn(
                        (_action: string, handler: (params: Record<string, string>) => Promise<void>) => {
                            protocolHandler = handler;
                        }
                    ),
                },
            },
        } as any;
        const log = vi.fn();
        const setupManager = {
            onUseSetupURI: vi.fn(async () => await Promise.resolve(true)),
            decodeQR: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        registerSetupProtocolHandler(host, log, setupManager);
        await protocolHandler!({ settingsQR: "qr-data" });

        expect(setupManager.decodeQR).toHaveBeenCalledWith("qr-data");
        expect(setupManager.onUseSetupURI).not.toHaveBeenCalled();
    });

    it("registerSetupProtocolHandler should log and continue when registration throws", () => {
        const host = {
            services: {
                API: {
                    registerProtocolHandler: vi.fn(() => {
                        throw new Error("register failed");
                    }),
                },
            },
        } as any;
        const log = vi.fn();
        const setupManager = {
            onUseSetupURI: vi.fn(),
            decodeQR: vi.fn(),
        } as any;

        registerSetupProtocolHandler(host, log, setupManager);

        expect(log).toHaveBeenCalledTimes(2);
    });

    it("useSetupProtocolFeature should register onLoaded handler", async () => {
        const addHandler = vi.fn();
        const registerProtocolHandler = vi.fn();
        const host = {
            services: {
                API: {
                    addLog: vi.fn(),
                    registerProtocolHandler,
                },
                appLifecycle: {
                    onLoaded: {
                        addHandler,
                    },
                },
            },
        } as any;
        const setupManager = {
            onUseSetupURI: vi.fn(),
            decodeQR: vi.fn(),
        } as any;

        useSetupProtocolFeature(host, setupManager);
        expect(addHandler).toHaveBeenCalledTimes(1);

        const loadedHandler = addHandler.mock.calls[0][0] as () => Promise<boolean>;
        await loadedHandler();

        expect(registerProtocolHandler).toHaveBeenCalledWith("setuplivesync", expect.any(Function));
    });
});
