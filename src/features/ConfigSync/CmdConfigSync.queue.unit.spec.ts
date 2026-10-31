import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: (path: string) => path,
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("./PluginDialogModal.ts", () => ({ PluginDialogModal: class PluginDialogModal {} }));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({ JsonResolveModal: class JsonResolveModal {} }));
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class ConflictResolveModal {},
}));
vi.mock("@/modules/features/ModuleLog.ts", () => ({ MARK_DONE: "" }));
vi.mock("@/common/utils.ts", () => ({
    cancelTask: vi.fn(),
    EVEN: Symbol("even"),
    isCustomisationSyncMetadata: vi.fn(),
    isPluginMetadata: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({ PeriodicProcessor: class PeriodicProcessor {} }));
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "open-plugin-sync",
    eventHub: { onEvent: vi.fn() },
}));
vi.mock("@/common/translation", () => ({ $msg: (message: string) => message }));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({ getObsidianCommunityPluginManager: vi.fn() }));

import { get } from "svelte/store";
import { DEFAULT_SETTINGS, type FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createOptionalFileSyncDatabase, optionalFileEntry } from "../../../test/fixtures/optionalFileSyncDatabase";
import { ConfigSync, pluginIsEnumerating, pluginList } from "./CmdConfigSync";

const queueOwners: ConfigSync[] = [];

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean, message: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error(message);
}

afterEach(() => {
    for (const configSync of queueOwners.splice(0)) {
        configSync.pluginScanProcessor.terminateAll();
        configSync.pluginScanProcessorV2.terminateAll();
    }
    vi.restoreAllMocks();
    pluginList.set([]);
    pluginIsEnumerating.set(false);
    vi.useRealTimers();
});

describe("ConfigSync legacy catalogue queue", () => {
    it("loads legacy catalogue contents through the database with native timers", async () => {
        const fixture = await createOptionalFileSyncDatabase();
        const path = "ix:device/PLUGIN_MAIN/native-timers" as FilePathWithPrefix;
        const data = {
            category: "PLUGIN_MAIN",
            name: "native-timers",
            term: "device",
            mtime: 2_000,
            files: [{ filename: "main.js", data: ["stored content"], mtime: 2_000, size: 14, hash: "stored-hash" }],
        };
        let configSync: ConfigSync | undefined;
        try {
            fixture.settings.usePluginSyncV2 = false;
            await expect(
                fixture.localDatabase.putDBEntry(optionalFileEntry(path, JSON.stringify(data)))
            ).resolves.toMatchObject({ ok: true });
            vi.spyOn(ConfigSync.prototype, "onBindFunction").mockImplementation(() => {});
            configSync = new ConfigSync({
                settings: fixture.settings,
                localDatabase: fixture.localDatabase,
                services: {
                    ...fixture.services,
                    API: { ...fixture.services.API, addRibbonIcon: vi.fn() },
                },
            } as unknown as ConstructorParameters<typeof ConfigSync>[0]);
            queueOwners.push(configSync);
            await configSync.updatePluginList(false);
            expect(await configSync.pluginScanProcessor.waitForAllProcessed(2_000)).toBe(true);
            expect(configSync.pluginList).toEqual([
                {
                    ...data,
                    documentPath: path,
                    files: [{ ...data.files[0], data: ["stored-hash"] }],
                },
            ]);
            expect(get(pluginList)).toEqual(configSync.pluginList);
            expect(configSync.pluginScanProcessor.remaining).toBe(0);
        } finally {
            configSync?.pluginScanProcessor.terminateAll();
            configSync?.pluginScanProcessorV2.terminateAll();
            await fixture.dispose();
        }
    });

    it("returns after enumeration, then loads a queued legacy catalogue item after its configured delay", async () => {
        vi.useFakeTimers();
        pluginList.set([]);
        pluginIsEnumerating.set(false);

        const path = "ix:device/PLUGIN_MAIN/example" as FilePathWithPrefix;
        const catalogueData = {
            category: "PLUGIN_MAIN",
            name: "example",
            term: "device",
            mtime: 2_000,
            files: [
                { filename: "main.js", data: ["legacy plugin source"], mtime: 2_000, size: 20, hash: "legacy-hash" },
            ],
        };
        const entry = { _id: path, path, mtime: 2_000, data: [JSON.stringify(catalogueData)] };
        const readGate = deferred();
        let loadHasStarted = false;
        const localDatabase = {
            findEntries: vi.fn(async function* () {
                yield entry;
            }),
            getDBEntry: vi.fn(async () => {
                loadHasStarted = true;
                await readGate.promise;
                return entry;
            }),
        };
        vi.spyOn(ConfigSync.prototype, "onBindFunction").mockImplementation(() => {});
        const configSync = new ConfigSync({
            settings: { ...DEFAULT_SETTINGS, usePluginSync: true, usePluginSyncV2: false },
            localDatabase,
            services: {
                API: { addLog: vi.fn(), addRibbonIcon: vi.fn() },
                path: { getPath: (document: { path: string }) => document.path },
            },
        } as unknown as ConstructorParameters<typeof ConfigSync>[0]);
        queueOwners.push(configSync);

        let drained = false;
        try {
            await configSync.updatePluginList(false);

            expect(configSync.pluginScanProcessor.delay).toBe(100);
            expect(configSync.pluginScanProcessor.remaining).toBe(1);
            expect(configSync.pluginList).toEqual([]);
            expect(get(pluginIsEnumerating)).toBe(false);

            await vi.advanceTimersByTimeAsync(99);
            expect(loadHasStarted).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            expect(loadHasStarted).toBe(true);
            expect(configSync.pluginScanProcessor.remaining).toBe(1);
            const drain = configSync.pluginScanProcessor.waitForAllProcessed();
            void drain.then((result) => {
                drained = result;
            });

            readGate.resolve();
            await vi.advanceTimersByTimeAsync(1_000);
            await waitForCondition(() => drained, "The legacy catalogue queue did not drain");

            expect(configSync.pluginList).toEqual([
                {
                    ...catalogueData,
                    documentPath: path,
                    files: [{ ...catalogueData.files[0], data: ["legacy-hash"] }],
                },
            ]);
            expect(get(pluginList)).toEqual(configSync.pluginList);
            expect(configSync.pluginScanProcessor.remaining).toBe(0);
            expect(get(pluginIsEnumerating)).toBe(false);
        } finally {
            readGate.resolve();
            await vi.advanceTimersByTimeAsync(1_000);
        }
    });
});
