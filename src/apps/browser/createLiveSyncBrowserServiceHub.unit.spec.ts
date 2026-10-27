import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { MemoryValueStore } from "@vrtmrz/value-store";
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
        const deviceValues = new MemoryValueStore();
        const hub = createLiveSyncBrowserServiceHub({ context, deviceValues });

        expect(observeServiceContext(context, "moduleLocalDatabase.logWaitingForReady")).toEqual({
            translation: "webapp:moduleLocalDatabase.logWaitingForReady",
            receivedEvents: ["context-contract-event"],
        });
        const composition = observeServiceComposition(hub, context);
        expect(composition.hubUsesExpectedContext).toBe(true);
        expect(SERVICE_CONTEXT_MEMBERS.filter((member) => !composition.servicesUsingExpectedContext[member])).toEqual(
            []
        );
        expect(hub.setting.deviceValues).toBe(deviceValues);
        expect(hub.config).toBe(hub.setting.config);
    });

    it("binds browser identity, persistence, restart policy, and native Fetch while composing the hub", async () => {
        const deviceValues = new MemoryValueStore();
        const savedSettings: (typeof DEFAULT_SETTINGS)[] = [];
        const restartCalls: string[] = [];
        const nativeFetch = vi.fn(async () => new Response("ok"));
        const options: LiveSyncBrowserServiceHubOptions<ReturnType<typeof createServiceContext>> = {
            deviceValues,
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

        expect(hub.setting.deviceValues).toBe(deviceValues);
        expect(hub.config).toBe(hub.setting.config);
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

    it("keeps each browser composition bound to its own device value store", async () => {
        const firstValues = new MemoryValueStore();
        const secondValues = new MemoryValueStore();
        const firstHub = createLiveSyncBrowserServiceHub({
            deviceValues: firstValues,
            getSystemVaultName: () => "first-vault",
        });
        const secondHub = createLiveSyncBrowserServiceHub({
            deviceValues: secondValues,
            getSystemVaultName: () => "second-vault",
        });

        await firstHub.config.setValue("probe", "first");
        await secondHub.config.setValue("probe", "second");

        expect(firstHub.setting.deviceValues).toBe(firstValues);
        expect(secondHub.setting.deviceValues).toBe(secondValues);
        expect(firstHub.config).toBe(firstHub.setting.config);
        expect(secondHub.config).toBe(secondHub.setting.config);
        expect(firstHub.config).not.toBe(secondHub.config);
        await expect(firstHub.config.getValue("probe")).resolves.toBe("first");
        await expect(secondHub.config.getValue("probe")).resolves.toBe("second");
        await expect(firstValues.getValue("first-vault-probe")).resolves.toBe("first");
        await expect(secondValues.getValue("second-vault-probe")).resolves.toBe("second");
    });
});
