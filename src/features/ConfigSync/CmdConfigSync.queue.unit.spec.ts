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
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {
        disable = vi.fn();
    },
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "open-plugin-sync",
    eventHub: { onEvent: vi.fn() },
}));
vi.mock("@/common/translation", () => ({ $msg: (message: string) => message }));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({ getObsidianCommunityPluginManager: vi.fn() }));

import { get } from "svelte/store";
import { getDocData } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import {
    DEFAULT_SETTINGS,
    type AnyEntry,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
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
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error(message);
}

function queueEntry(path: string, data: unknown = {}): AnyEntry {
    const documentPath = path as FilePathWithPrefix;
    return {
        _id: documentPath,
        path: documentPath,
        mtime: 2_000,
        data: [JSON.stringify(data)],
    } as unknown as AnyEntry;
}

function legacyCatalogueEntry(path: string, name: string, mtime = 2_000): AnyEntry {
    return queueEntry(path, {
        category: "PLUGIN_MAIN",
        name,
        term: "device",
        mtime,
        files: [
            {
                filename: `plugins/${name}/main.js`,
                data: [`legacy source for ${name}`],
                mtime,
                size: name.length,
                hash: `hash-${name}`,
            },
        ],
    });
}

function createQueueConfigSync(
    settings: typeof DEFAULT_SETTINGS,
    localDatabase: unknown,
    services: unknown = {
        API: { addLog: vi.fn(), addRibbonIcon: vi.fn() },
        path: { getPath: (entry: { path: string }) => entry.path },
        context: { notices: { hide: vi.fn() } },
    }
) {
    vi.spyOn(ConfigSync.prototype, "onBindFunction").mockImplementation(() => {});
    const configSync = new ConfigSync({
        settings,
        localDatabase,
        services,
    } as unknown as ConstructorParameters<typeof ConfigSync>[0]);
    queueOwners.push(configSync);
    return configSync;
}

afterEach(async () => {
    for (const configSync of queueOwners.splice(0)) {
        await configSync.pluginScanProcessor.stop();
    }
    vi.restoreAllMocks();
    pluginList.set([]);
    pluginIsEnumerating.set(false);
    vi.useRealTimers();
});

describe("ConfigSync legacy catalogue queue", () => {
    it("starts duplicate entries in FIFO order with ten concurrent items", async () => {
        const settings = { ...DEFAULT_SETTINGS, usePluginSync: true, usePluginSyncV2: true };
        const configSync = createQueueConfigSync(settings, {});
        const paths = [
            "ix:device/PLUGIN_MAIN/first.md",
            "ix:device/PLUGIN_MAIN/second.md",
            "ix:device/PLUGIN_MAIN/duplicate.md",
            "ix:device/PLUGIN_MAIN/third.md",
            "ix:device/PLUGIN_MAIN/duplicate.md",
            "ix:device/PLUGIN_MAIN/fourth.md",
            "ix:device/PLUGIN_MAIN/fifth.md",
            "ix:device/PLUGIN_MAIN/sixth.md",
            "ix:device/PLUGIN_MAIN/seventh.md",
            "ix:device/PLUGIN_MAIN/eighth.md",
            "ix:device/PLUGIN_MAIN/ninth.md",
            "ix:device/PLUGIN_MAIN/tenth.md",
        ];
        const gate = deferred();
        const started: string[] = [];
        let active = 0;
        let maximumActive = 0;
        vi.spyOn(configSync, "migrateV1ToV2").mockImplementation(async (_showMessage, entry) => {
            started.push(entry.path);
            active++;
            maximumActive = Math.max(maximumActive, active);
            await gate.promise;
            active--;
        });

        try {
            for (const path of paths)
                configSync.pluginScanProcessor.enqueue({ entry: queueEntry(path), generation: 0 });
            await waitForCondition(() => started.length === 10, "The first ten queue items did not start");

            expect(started).toEqual(paths.slice(0, 10));
            expect(maximumActive).toBe(10);

            gate.resolve();
            await expect(configSync.pluginScanProcessor.waitForIdle()).resolves.toBeUndefined();
            expect(started).toEqual(paths);
        } finally {
            gate.resolve();
        }
    });

    it("continues with queued items after a migration throws", async () => {
        const settings = { ...DEFAULT_SETTINGS, usePluginSync: true, usePluginSyncV2: true };
        const configSync = createQueueConfigSync(settings, {});
        const paths = Array.from({ length: 11 }, (_, index) => `ix:device/PLUGIN_MAIN/item-${index}.md`);
        const gate = deferred();
        const started: string[] = [];
        vi.spyOn(configSync, "migrateV1ToV2").mockImplementation(async (_showMessage, entry) => {
            started.push(entry.path);
            if (entry.path === paths[0]) throw new Error("migration failed");
            if (paths.slice(1, 10).includes(entry.path)) await gate.promise;
        });

        try {
            for (const path of paths)
                configSync.pluginScanProcessor.enqueue({ entry: queueEntry(path), generation: 0 });
            await waitForCondition(() => started.length === 10, "The first ten queue items did not start");
            await waitForCondition(() => started.length === 11, "The item after the failed migration did not start");

            gate.resolve();
            await expect(configSync.pluginScanProcessor.waitForIdle()).resolves.toBeUndefined();
            expect(started).toEqual(paths);
        } finally {
            gate.resolve();
        }
    });

    it("does not restore an old read result after reloading a newer catalogue", async () => {
        vi.useFakeTimers();
        const oldPath = "ix:device/PLUGIN_MAIN/old" as FilePathWithPrefix;
        const newerPath = "ix:device/PLUGIN_MAIN/newer" as FilePathWithPrefix;
        const oldEntry = legacyCatalogueEntry(oldPath, "old");
        const newerEntry = legacyCatalogueEntry(newerPath, "newer", 3_000);
        const oldRead = deferred();
        let scanCount = 0;
        let oldReadStarted = false;
        const localDatabase = {
            findEntries: vi.fn(async function* () {
                for (const entry of scanCount++ === 0 ? [oldEntry] : [newerEntry]) yield entry;
            }),
            getDBEntry: vi.fn(async (path: FilePathWithPrefix) => {
                if (path === oldPath) {
                    oldReadStarted = true;
                    await oldRead.promise;
                    return oldEntry;
                }
                return newerEntry;
            }),
        };
        const settings = { ...DEFAULT_SETTINGS, usePluginSync: true, usePluginSyncV2: false };
        const configSync = createQueueConfigSync(settings, localDatabase);

        try {
            await configSync.updatePluginList(false);
            await vi.advanceTimersByTimeAsync(100);
            await waitForCondition(() => oldReadStarted, "The old catalogue read did not start");

            await configSync.reloadPluginList(false);
            await vi.advanceTimersByTimeAsync(100);
            expect(configSync.pluginList.map((entry) => entry.name)).toEqual(["newer"]);

            oldRead.resolve();
            await expect(configSync.pluginScanProcessor.waitForIdle()).resolves.toBeUndefined();
            expect(configSync.pluginList.map((entry) => entry.name)).toEqual(["newer"]);
            expect(get(pluginList).map((entry) => entry.name)).toEqual(["newer"]);
        } finally {
            oldRead.resolve();
            await vi.advanceTimersByTimeAsync(100);
        }
    });

    it.each(["catalogue update", "settings application", "temporary suspension"] as const)(
        "does not restore an active legacy read after disabling through %s and re-enabling",
        async (route) => {
            vi.useFakeTimers();
            const oldPath = "ix:device/PLUGIN_MAIN/old" as FilePathWithPrefix;
            const oldEntry = legacyCatalogueEntry(oldPath, "old");
            const oldRead = deferred();
            let oldReadStarted = false;
            let scanCount = 0;
            const localDatabase = {
                findEntries: vi.fn(async function* () {
                    if (scanCount++ === 0) yield oldEntry;
                }),
                getDBEntry: vi.fn(async () => {
                    oldReadStarted = true;
                    await oldRead.promise;
                    return oldEntry;
                }),
            };
            const settings = { ...DEFAULT_SETTINGS, usePluginSync: true, usePluginSyncV2: false };
            const configSync = createQueueConfigSync(settings, localDatabase);

            try {
                await configSync.updatePluginList(false);
                await vi.advanceTimersByTimeAsync(100);
                await waitForCondition(() => oldReadStarted, "The active legacy read did not start");

                settings.usePluginSync = false;
                if (route === "catalogue update") {
                    await configSync.updatePluginList(false);
                } else if (route === "settings application") {
                    await configSync._everyRealizeSettingSyncMode();
                } else {
                    await (
                        configSync as unknown as { _allSuspendExtraSync(): Promise<boolean> }
                    )._allSuspendExtraSync();
                }
                settings.usePluginSync = true;
                await configSync.updatePluginList(false);

                oldRead.resolve();
                await expect(configSync.pluginScanProcessor.waitForIdle()).resolves.toBeUndefined();
                expect(configSync.pluginList).toEqual([]);
                expect(get(pluginList)).toEqual([]);
            } finally {
                oldRead.resolve();
                await vi.advanceTimersByTimeAsync(100);
            }
        }
    );

    it("stops admission on unload and joins a read without changing the replacement instance's list", async () => {
        vi.useFakeTimers();
        const entry = legacyCatalogueEntry("ix:device/PLUGIN_MAIN/old", "old");
        const read = deferred();
        const localDatabase = {
            findEntries: vi.fn(async function* () {
                yield entry;
            }),
            getDBEntry: vi.fn(async () => {
                await read.promise;
                return entry;
            }),
        };
        const settings = { ...DEFAULT_SETTINGS, usePluginSync: true, usePluginSyncV2: false };
        const configSync = createQueueConfigSync(settings, localDatabase);
        try {
            await configSync.updatePluginList(false);
            await vi.advanceTimersByTimeAsync(100);
            expect(localDatabase.getDBEntry).toHaveBeenCalledOnce();
            let stopped = false;
            const done = configSync.onunload().then(() => {
                stopped = true;
            });
            const replacement = { name: "replacement" } as (typeof configSync.pluginList)[number];
            pluginList.set([replacement]);
            await configSync.updatePluginList(false);
            await configSync.reloadPluginList(false);
            await vi.advanceTimersByTimeAsync(100);
            expect(localDatabase.findEntries).toHaveBeenCalledOnce();
            expect(stopped).toBe(false);
            expect(configSync.pluginScanProcessor.remaining).toBe(1);
            read.resolve();
            await done;
            expect(configSync.pluginList).toEqual([]);
            expect(get(pluginList)).toEqual([replacement]);
            expect(configSync.pluginScanProcessor.remaining).toBe(0);
        } finally {
            read.resolve();
            await vi.advanceTimersByTimeAsync(100);
        }
    });

    it("cancels unstarted legacy reads when the first ten are blocked and the module is disabled", async () => {
        const paths = Array.from({ length: 12 }, (_, index) => `ix:device/PLUGIN_MAIN/item-${index}`);
        const entries = paths.map((path, index) => legacyCatalogueEntry(path, `item-${index}`));
        const gates = entries.slice(0, 10).map(() => deferred());
        const started: string[] = [];
        const localDatabase = {
            findEntries: vi.fn(async function* () {
                for (const entry of entries) yield entry;
            }),
            getDBEntry: vi.fn(async (path: FilePathWithPrefix) => {
                const index = paths.indexOf(path);
                started.push(path);
                if (index >= 0 && index < gates.length) await gates[index].promise;
                return entries[index];
            }),
        };
        const settings = { ...DEFAULT_SETTINGS, usePluginSync: true, usePluginSyncV2: false };
        const configSync = createQueueConfigSync(settings, localDatabase);

        try {
            await configSync.updatePluginList(false);
            await waitForCondition(() => started.length === 10, "The first ten legacy reads did not start");

            settings.usePluginSync = false;
            await configSync.updatePluginList(false);
            for (const gate of gates) gate.resolve();
            await expect(configSync.pluginScanProcessor.waitForIdle()).resolves.toBeUndefined();

            expect(started).toEqual(paths.slice(0, 10));
        } finally {
            for (const gate of gates) gate.resolve();
        }
    });

    it("finishes a started V1-to-V2 migration but does not start pending migrations after disable", async () => {
        const fixture = await createOptionalFileSyncDatabase();
        const v1Path = "ix:device/PLUGIN_MAIN/migrate.md" as FilePathWithPrefix;
        const v2Path = "ix:device/PLUGIN_MAIN/migrate%main.js" as FilePathWithPrefix;
        const source = "module.exports = 'migrated';";
        const data = {
            category: "PLUGIN_MAIN",
            name: "migrate",
            term: "device",
            mtime: 2_000,
            files: [
                {
                    filename: "plugins/migrate/main.js",
                    data: [source],
                    mtime: 2_000,
                    size: source.length,
                    hash: "migration-source-hash",
                },
            ],
        };
        const settings = fixture.settings;
        const configSync = createQueueConfigSync(settings, fixture.localDatabase, {
            ...fixture.services,
            API: { ...fixture.services.API, addRibbonIcon: vi.fn() },
        });
        const pendingGate = deferred();
        const putGate = deferred();
        const migrationFinished = deferred();
        const started: string[] = [];
        let v2PutStarted = false;

        try {
            await expect(
                fixture.localDatabase.putDBEntry(optionalFileEntry(v1Path, JSON.stringify(data)))
            ).resolves.toMatchObject({ ok: true });

            const loadedLegacy = {
                ...optionalFileEntry(v1Path, JSON.stringify(data)),
                data: [JSON.stringify(data)],
            } as unknown as Awaited<ReturnType<typeof fixture.localDatabase.getDBEntry>>;
            let migrationRead = false;
            const read = fixture.localDatabase.getDBEntry.bind(fixture.localDatabase);
            vi.spyOn(fixture.localDatabase, "getDBEntry").mockImplementation(async (path, ...args) => {
                if (path === v1Path && !migrationRead) {
                    migrationRead = true;
                    return loadedLegacy;
                }
                return await read(path, ...args);
            });
            const migrate = configSync.migrateV1ToV2.bind(configSync);
            vi.spyOn(configSync, "migrateV1ToV2").mockImplementation(async (showMessage, entry) => {
                started.push(entry.path);
                if (entry.path === v1Path) {
                    try {
                        await migrate(showMessage, entry);
                    } finally {
                        migrationFinished.resolve();
                    }
                    return;
                }
                await pendingGate.promise;
            });
            const put = fixture.localDatabase.putDBEntry.bind(fixture.localDatabase);
            vi.spyOn(fixture.localDatabase, "putDBEntry").mockImplementation(async (...args) => {
                if ((args[0] as { path?: string }).path === v2Path) {
                    v2PutStarted = true;
                    await putGate.promise;
                }
                return await put(...args);
            });

            const paths = [
                v1Path,
                ...Array.from(
                    { length: 10 },
                    (_, index) => `ix:device/PLUGIN_MAIN/pending-${index}.md` as FilePathWithPrefix
                ),
            ];
            for (const path of paths)
                configSync.pluginScanProcessor.enqueue({ entry: queueEntry(path), generation: 0 });
            await waitForCondition(
                () => started.length === 10,
                `The first ten migrations did not start: ${started.join(", ")}`
            );
            await waitForCondition(() => v2PutStarted, "The migration did not reach its write");

            settings.usePluginSync = false;
            await configSync.updatePluginList(false);
            putGate.resolve();
            await migrationFinished.promise;
            expect.soft(started).toEqual(paths.slice(0, 10));

            pendingGate.resolve();
            await expect(configSync.pluginScanProcessor.waitForIdle()).resolves.toBeUndefined();
            expect.soft(started).toEqual(paths.slice(0, 10));

            const migrated = await fixture.localDatabase.getDBEntry(v2Path, undefined, false, false);
            expect(migrated).not.toBe(false);
            if (migrated !== false) expect(getDocData(migrated.data)).toContain(source);
            await expect(fixture.localDatabase.getDBEntry(v1Path)).resolves.toBe(false);
        } finally {
            putGate.resolve();
            pendingGate.resolve();
            await configSync.pluginScanProcessor.waitForIdle();
            await fixture.dispose();
        }
    });

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
            await expect(configSync.pluginScanProcessor.waitForIdle()).resolves.toBeUndefined();
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
            await configSync?.pluginScanProcessor.stop();
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

            expect(configSync.pluginScanProcessor.remaining).toBe(1);
            expect(configSync.pluginList).toEqual([]);
            expect(get(pluginIsEnumerating)).toBe(false);

            await vi.advanceTimersByTimeAsync(99);
            expect(loadHasStarted).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            expect(loadHasStarted).toBe(true);
            expect(configSync.pluginScanProcessor.remaining).toBe(1);
            const drain = configSync.pluginScanProcessor.waitForIdle();
            void drain.then(() => {
                drained = true;
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
