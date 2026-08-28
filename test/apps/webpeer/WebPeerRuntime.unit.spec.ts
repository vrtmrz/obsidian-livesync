import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { DEFAULT_SETTINGS, SETTING_KEY_P2P_DEVICE_NAME } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { EVENT_LAYOUT_READY } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { describe, expect, it, vi } from "vitest";

import { WebPeerRuntime } from "@/apps/webpeer/src/WebPeerRuntime";

function createMemoryStore(): SimpleStore<unknown> {
    const values = new Map<string, unknown>();
    return {
        db: Promise.resolve(undefined),
        get: async (key) => values.get(key),
        set: async (key, value) => {
            values.set(key, value);
        },
        delete: async (key) => {
            values.delete(key);
        },
        keys: async () => [...values.keys()],
    };
}

describe("WebPeer runtime composition", () => {
    it("preserves one context and live P2P result across the service graph and pane host", () => {
        const context = createServiceContext({
            translate: (key) => `webpeer:${key}`,
        });
        const runtime = new WebPeerRuntime({
            context,
            store: createMemoryStore(),
        });

        expect(runtime.context).toBe(context);
        expect(runtime.services.context).toBe(context);
        expect(runtime.events).toBe(context.events);
        expect(runtime.paneHost.p2p.transportLifecycle).toBe(runtime.p2p.transportLifecycle);
        expect(runtime.paneHost.services).toBe(runtime.services);
        expect(runtime.paneHost.p2p).toBe(runtime.p2p);
        expect(runtime.paneHost.showPeerMenu).toBeTypeOf("function");
        expect("controller" in runtime).toBe(false);
    });

    it("loads settings and opens the local database before announcing layout readiness", async () => {
        const runtime = new WebPeerRuntime({
            store: createMemoryStore(),
        });
        const loadSettings = vi.spyOn(runtime.services.setting, "loadSettings").mockResolvedValue(undefined);
        vi.spyOn(runtime.services.setting, "currentSettings").mockReturnValue({
            ...DEFAULT_SETTINGS,
            P2P_AutoStart: false,
            P2P_Enabled: false,
        });
        const openDatabase = vi.spyOn(runtime.services.database, "openDatabase").mockResolvedValue(true);
        const markIsReady = vi.spyOn(runtime.services.appLifecycle, "markIsReady");
        const layoutReady = vi.fn();
        runtime.events.onEvent(EVENT_LAYOUT_READY, layoutReady);

        await expect(runtime.start()).resolves.toBe(runtime);

        expect(loadSettings).toHaveBeenCalledOnce();
        expect(openDatabase).toHaveBeenCalledOnce();
        expect(markIsReady).toHaveBeenCalledOnce();
        expect(layoutReady).toHaveBeenCalledOnce();
    });

    it("delegates automatic P2P startup to the resumed lifecycle handler", async () => {
        vi.useFakeTimers();
        try {
            const runtime = new WebPeerRuntime({
                store: createMemoryStore(),
            });
            vi.spyOn(runtime.services.setting, "loadSettings").mockResolvedValue(undefined);
            vi.spyOn(runtime.services.setting, "currentSettings").mockReturnValue({
                ...DEFAULT_SETTINGS,
                P2P_AutoStart: true,
                P2P_Enabled: true,
            });
            vi.spyOn(runtime.services.database, "openDatabase").mockResolvedValue(true);
            const onResumed = vi
                .spyOn(runtime.services.appLifecycle, "onResumed")
                .mockResolvedValue(true);
            const open = vi.spyOn(runtime.p2p.transportLifecycle, "connect").mockResolvedValue(undefined);

            await runtime.start();

            expect(onResumed).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(100);
            expect(open).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejects start when the browser-local database cannot be opened", async () => {
        const runtime = new WebPeerRuntime({
            store: createMemoryStore(),
        });
        vi.spyOn(runtime.services.setting, "loadSettings").mockResolvedValue(undefined);
        vi.spyOn(runtime.services.database, "openDatabase").mockResolvedValue(false);

        await expect(runtime.start()).rejects.toThrow("WebPeer local database could not be opened");
    });

    it("isolates a specialised runtime and applies its device name before opening the database", async () => {
        const runtime = new WebPeerRuntime({
            store: createMemoryStore(),
            deviceName: "  p2p-check-browser-desktop-abc  ",
            systemVaultName: "p2p-check-vault",
        });
        vi.spyOn(runtime.services.setting, "loadSettings").mockResolvedValue(undefined);
        vi.spyOn(runtime.services.setting, "currentSettings").mockReturnValue({
            ...DEFAULT_SETTINGS,
            P2P_AutoStart: false,
            P2P_Enabled: false,
        });
        const setSmallConfig = vi.spyOn(runtime.services.config, "setSmallConfig").mockImplementation(() => undefined);
        const openDatabase = vi.spyOn(runtime.services.database, "openDatabase").mockImplementation(async () => {
            expect(setSmallConfig).toHaveBeenCalledWith(SETTING_KEY_P2P_DEVICE_NAME, "p2p-check-browser-desktop-abc");
            return true;
        });

        await runtime.start();

        expect(runtime.services.API.getSystemVaultName()).toBe("p2p-check-vault");
        expect(openDatabase).toHaveBeenCalledOnce();
    });
});
