import { App } from "obsidian";
import ObsidianLiveSyncPlugin from "@/main";
import { DEFAULT_SETTINGS, type ObsidianLiveSyncSettings } from "@/lib/src/common/types";
import { LOG_LEVEL_VERBOSE, Logger, setGlobalLogFunction } from "@lib/common/logger";
import { SettingCache } from "./obsidian-mock";
import { delay, promiseWithResolvers } from "octagonal-wheels/promises";
import { EVENT_LAYOUT_READY, eventHub } from "@/common/events";
import { EVENT_PLATFORM_UNLOADED } from "@/lib/src/PlatformAPIs/base/APIBase";
import { serialized } from "octagonal-wheels/concurrency/lock_v2";

export type LiveSyncHarness = {
    app: App;
    plugin: ObsidianLiveSyncPlugin;
    dispose: () => Promise<void>;
    disposalPromise: Promise<void>;
    isDisposed: () => boolean;
};
function overrideLogFunction(vaultName: string) {
    setGlobalLogFunction((msg, level, key) => {
        if (level && level < LOG_LEVEL_VERBOSE) {
            return;
        }
        if (msg instanceof Error) {
            console.error(msg.stack);
        } else {
            console.log(
                `[${vaultName}] :: [${key ?? "Global"}][${level ?? 1}]: ${msg instanceof Error ? msg.stack : msg}`
            );
        }
    });
}

export async function generateHarness(
    paramVaultName?: string,
    settings?: Partial<ObsidianLiveSyncSettings>
): Promise<LiveSyncHarness> {
    // return await serialized("harness-generation-lock", async () => {
    // Dispose previous harness to avoid multiple harness running at the same time
    // if (previousHarness && !previousHarness.isDisposed()) {
    //     console.log(`Previous harness detected, waiting for disposal...`);
    //     await previousHarness.disposalPromise;
    //     previousHarness = null;
    //     await delay(100);
    // }
    const vaultName = paramVaultName ?? "TestVault" + Date.now();
    const setting = {
        ...DEFAULT_SETTINGS,
        ...settings,
    };
    overrideLogFunction(vaultName);
    //@ts-ignore Mocked in harness
    const app = new App(vaultName);
    // setting and vault name
    SettingCache.set(app, setting);
    SettingCache.set(app.vault, vaultName);

    //@ts-ignore
    const manifest_version = `${MANIFEST_VERSION || "0.0.0-harness"}`;
    overrideLogFunction(vaultName);
    const manifest = {
        id: "obsidian-livesync",
        name: "Self-hosted LiveSync (Harnessed)",
        version: manifest_version,
        minAppVersion: "0.15.0",
        description: "Testing",
        author: "vrtmrz",
        authorUrl: "",
        isDesktopOnly: false,
    };

    const plugin = new ObsidianLiveSyncPlugin(app, manifest);
    overrideLogFunction(vaultName);
    // Initial load
    await plugin.onload();
    let isDisposed = false;
    const waitPromise = promiseWithResolvers<void>();
    eventHub.once(EVENT_PLATFORM_UNLOADED, async () => {
        await delay(100);
        isDisposed = true;
        waitPromise.resolve();
    });
    eventHub.once(EVENT_LAYOUT_READY, () => {
        plugin.app.vault.trigger("layout-ready");
    });
    const harness: LiveSyncHarness = {
        app,
        plugin,
        dispose: async () => {
            await plugin.onunload();
            return waitPromise.promise;
        },
        disposalPromise: waitPromise.promise,
        isDisposed: () => isDisposed,
    };
    await delay(100);
    console.log(`Harness for vault '${vaultName}' is ready.`);
    // previousHarness = harness;
    return harness;
}
export async function waitForReady(harness: LiveSyncHarness): Promise<void> {
    for (let i = 0; i < 10; i++) {
        if (harness.plugin.services.appLifecycle.isReady()) {
            console.log("App Lifecycle is ready");
            return;
        }
        await delay(100);
    }
    throw new Error(`Initialisation Timed out!`);
}

export async function waitForIdle(harness: LiveSyncHarness): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await delay(25);
        const processing =
            harness.plugin.databaseQueueCount.value +
            harness.plugin.processingFileEventCount.value +
            harness.plugin.pendingFileEventCount.value +
            harness.plugin.totalQueued.value +
            harness.plugin.batched.value +
            harness.plugin.processing.value +
            harness.plugin.storageApplyingCount.value;

        if (processing === 0) {
            console.log(`Idle after ${i} loops`);
            return;
        }
    }
}
export async function waitForClosed(harness: LiveSyncHarness): Promise<void> {
    await delay(100);
    for (let i = 0; i < 10; i++) {
        if (harness.plugin.services.appLifecycle.hasUnloaded()) {
            console.log("App Lifecycle has unloaded");
            return;
        }
        await delay(100);
    }
}
