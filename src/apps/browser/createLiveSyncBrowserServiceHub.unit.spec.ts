import { createServiceContext } from "@vrtmrz/livesync-commonlib/context.js";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    observeServiceComposition,
    observeServiceContext,
    SERVICE_CONTEXT_MEMBERS,
} from "../../../test/contracts/serviceContext";
import {
    createLiveSyncBrowserServiceHub,
    type LiveSyncBrowserServiceHubOptions,
} from "./createLiveSyncBrowserServiceHub";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("LiveSync browser service context contract", () => {
    it("preserves one injected context and its API results throughout the Webapp composition", () => {
        const context = createServiceContext({
            translate: (key) => `webapp:${key}`,
        });
        const hub = createLiveSyncBrowserServiceHub({ context });

        expect(observeServiceContext(context, "moduleLocalDatabase.logWaitingForReady")).toEqual({
            translation: "webapp:moduleLocalDatabase.logWaitingForReady",
            receivedEvents: ["context-contract-event"],
        });
        const composition = observeServiceComposition(hub, context);
        expect(composition.hubUsesExpectedContext).toBe(true);
        expect(SERVICE_CONTEXT_MEMBERS.filter((member) => !composition.servicesUsingExpectedContext[member])).toEqual(
            []
        );
    });

    it("binds browser identity, persistence, restart policy, and native Fetch while composing the hub", async () => {
        const deviceLocalSettings = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => deviceLocalSettings.get(key) ?? null,
            setItem: (key: string, value: string) => deviceLocalSettings.set(key, value),
            removeItem: (key: string) => deviceLocalSettings.delete(key),
            clear: () => deviceLocalSettings.clear(),
        });
        const savedSettings: (typeof DEFAULT_SETTINGS)[] = [];
        const restartCalls: string[] = [];
        const nativeFetch = vi.fn(async () => new Response("ok"));
        const options: LiveSyncBrowserServiceHubOptions<ReturnType<typeof createServiceContext>> = {
            getSystemVaultName: () => "browser-vault",
            settings: {
                load: async () => ({
                    ...DEFAULT_SETTINGS,
                    couchDB_DBNAME: "browser-database",
                }),
                save: async (settings) => {
                    savedSettings.push(settings);
                },
            },
            restart: {
                schedule: () => restartCalls.push("schedule"),
                perform: () => restartCalls.push("perform"),
                ask: (message) => restartCalls.push(`ask:${message ?? ""}`),
                isScheduled: () => true,
            },
            API: {
                fetch: nativeFetch as typeof fetch,
            },
        };

        const hub = createLiveSyncBrowserServiceHub(options);

        expect(hub.API.getSystemVaultName()).toBe("browser-vault");
        expect(hub.API.getPlatform()).toBe("browser");
        const response = await hub.API.nativeFetch("https://example.invalid/");
        expect(await response.text()).toBe("ok");
        expect(nativeFetch).toHaveBeenCalledWith("https://example.invalid/", undefined);
        await hub.setting.loadSettings();
        expect(hub.setting.currentSettings().couchDB_DBNAME).toBe("browser-database");
        savedSettings.length = 0;
        await hub.setting.saveSettingData();
        expect(savedSettings).toHaveLength(1);

        hub.appLifecycle.scheduleRestart();
        hub.appLifecycle.performRestart();
        hub.appLifecycle.askRestart("restart now");
        expect(hub.appLifecycle.isReloadingScheduled()).toBe(true);
        expect(restartCalls).toEqual(["schedule", "perform", "ask:restart now"]);
    });
});
