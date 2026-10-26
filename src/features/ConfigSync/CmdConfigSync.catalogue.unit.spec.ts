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

import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createOptionalFileSyncDatabase, optionalFileEntry } from "../../../test/fixtures/optionalFileSyncDatabase";
import { ConfigSync, PluginDataExDisplayV2, pluginManifests } from "./CmdConfigSync";

const filenames = ["main.js", "manifest.json", "styles.css"];
const content: Record<string, string> = {
    "main.js": "module.exports = class ExamplePlugin {};",
    "manifest.json": JSON.stringify({ id: "example", name: "Example", version: "1.0.0" }),
    "styles.css": ".example { color: red; }",
};
const fixtureOwners: Awaited<ReturnType<typeof createOptionalFileSyncDatabase>>[] = [];

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function catalogue() {
    const fixture = await createOptionalFileSyncDatabase();
    fixtureOwners.push(fixture);
    fixture.settings.syncOnlyRegEx = "\\.(?:md|png|pdf)$" as typeof fixture.settings.syncOnlyRegEx;
    const paths = filenames.map((name) => `ix:device/PLUGIN_MAIN/example%${name}` as FilePathWithPrefix);
    for (const [index, path] of paths.entries()) {
        const wireContent = `fixture-header\u200b\n\u200c${btoa(content[filenames[index]])}`;
        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(path, wireContent))).resolves.toMatchObject({
            ok: true,
        });
    }
    const gates = new Map(paths.map((path) => [path, deferred()]));
    const readEntry = fixture.localDatabase.getDBEntry.bind(fixture.localDatabase);
    vi.spyOn(fixture.localDatabase, "getDBEntry").mockImplementation(async (path, ...args) => {
        await gates.get(path)?.promise;
        return readEntry(path, ...args);
    });
    const written = new Map<string, string>();
    const configSync = Object.create(ConfigSync.prototype) as ConfigSync;
    Object.assign(configSync, {
        core: {
            localDatabase: fixture.localDatabase,
            settings: fixture.settings,
            services: fixture.services,
            storageAccess: {
                ensureDir: vi.fn(async () => true),
                readHiddenFileText: vi.fn(async (path: string) => written.get(path) ?? ""),
                writeHiddenFileAuto: vi.fn(async (path: string, data: string) => {
                    written.set(path, data);
                }),
            },
        },
        pluginList: [],
        pluginListGeneration: 0,
        loadedManifest_mTime: new Map(),
        updatingV2Count: 0,
        pluginScanProcessor: { clearQueue: vi.fn(), enqueue: vi.fn() },
        _log: vi.fn(),
        storeCustomisationFileV2: vi.fn(async () => true),
    });
    const updates: Promise<void>[] = [];
    const update = configSync.updatePluginListV2.bind(configSync);
    vi.spyOn(configSync, "updatePluginListV2").mockImplementation((...args) => {
        const promise = update(...args);
        updates.push(promise);
        return promise;
    });
    const release = (order = filenames) => {
        for (const name of order) gates.get(`ix:device/PLUGIN_MAIN/example%${name}` as FilePathWithPrefix)!.resolve();
    };
    return { ...fixture, configSync, updates, paths, release, written };
}

afterEach(async () => {
    vi.restoreAllMocks();
    pluginManifests.clear();
    for (const fixture of fixtureOwners.splice(0)) await fixture.dispose();
});

describe("issue #1271: rebuilding a multi-file Customisation Sync item", () => {
    it.each([
        { order: filenames },
        { order: [...filenames].reverse() },
        { order: ["manifest.json", "main.js", "styles.css"] },
    ])("retains all per-file documents when reads are released as $order", async ({ order }) => {
        const fixture = await catalogue();
        await fixture.configSync.reloadPluginList(false);
        fixture.release(order);
        await Promise.all(fixture.updates);

        const documents = await fixture.database.allDocs({ keys: fixture.paths });
        expect(documents.rows).toHaveLength(3);
        expect(fixture.configSync.pluginList).toHaveLength(1);
        expect(fixture.configSync.pluginList[0].files.map((file) => file.filename).sort()).toEqual(
            filenames.map((name) => `plugins/example/${name}`).sort()
        );
    });

    it("applies all three files after the first reload", async () => {
        const fixture = await catalogue();
        await fixture.configSync.reloadPluginList(false);
        fixture.release();
        await Promise.all(fixture.updates);

        await expect(
            fixture.configSync.applyDataV2(fixture.configSync.pluginList[0] as PluginDataExDisplayV2)
        ).resolves.toBe(true);
        expect([...fixture.written.keys()].sort()).toEqual(
            filenames.map((name) => `.obsidian/plugins/example/${name}`).sort()
        );
        for (const name of filenames)
            expect(fixture.written.get(`.obsidian/plugins/example/${name}`)).toBe(content[name]);
    });

    it("fills an existing row during a second enumeration", async () => {
        const fixture = await catalogue();
        await fixture.configSync.reloadPluginList(false);
        fixture.release();
        await Promise.all(fixture.updates);
        await fixture.configSync.updatePluginList(false);
        await Promise.all(fixture.updates);

        expect(fixture.configSync.pluginList[0].files.map((file) => file.filename).sort()).toEqual(
            filenames.map((name) => `plugins/example/${name}`).sort()
        );
    });

    it("retains all files when item updates run sequentially", async () => {
        const fixture = await catalogue();
        fixture.release();
        for (const path of fixture.paths) await fixture.configSync.updatePluginListV2(false, path);

        expect(fixture.configSync.pluginList[0].files.map((file) => file.filename).sort()).toEqual(
            filenames.map((name) => `plugins/example/${name}`).sort()
        );
    });

    it("updates a different item while another item's reads are pending", async () => {
        const fixture = await catalogue();
        const otherPath = "ix:device/PLUGIN_MAIN/other%main.js" as FilePathWithPrefix;
        await fixture.localDatabase.putDBEntry(
            optionalFileEntry(otherPath, `fixture-header\u200b\n\u200c${btoa(content["main.js"])}`)
        );
        const pending = fixture.paths.map((path) => fixture.configSync.updatePluginListV2(false, path));
        try {
            await fixture.configSync.updatePluginListV2(false, otherPath);
            expect(fixture.configSync.pluginList.map((entry) => entry.name)).toEqual(["other"]);
            expect(fixture.configSync.updatingV2Count).toBe(3);
        } finally {
            fixture.release();
            await Promise.all(pending);
        }
        expect(fixture.configSync.updatingV2Count).toBe(0);
    });

    it("continues updating an item after an earlier read fails", async () => {
        const fixture = await catalogue();
        fixture.release();
        vi.spyOn(fixture.configSync, "createPluginDataExFileV2").mockRejectedValueOnce(new Error("Read failed"));
        const failed = fixture.configSync.updatePluginListV2(false, fixture.paths[0]);
        const next = fixture.configSync.updatePluginListV2(false, fixture.paths[1]);

        await expect(failed).rejects.toThrow("Read failed");
        await next;
        expect(fixture.configSync.pluginList[0].files.map((file) => file.filename)).toEqual([
            "plugins/example/manifest.json",
        ]);
        expect(fixture.configSync.updatingV2Count).toBe(0);
    });

    it.each(["read", "file update"])("reload discards cached files while an earlier %s is pending", async (phase) => {
        const fixture = await catalogue();
        fixture.release();
        for (const path of fixture.paths) await fixture.configSync.updatePluginListV2(false, path);
        const earlierRead = deferred();
        const freshRead = deferred();
        const entered = deferred();
        const createFile = fixture.configSync.createPluginDataExFileV2.bind(fixture.configSync);
        let reads = 0;
        vi.spyOn(fixture.configSync, "createPluginDataExFileV2").mockImplementation(async (path) => {
            if (reads++ === 0) {
                if (phase === "read") {
                    entered.resolve();
                    await earlierRead.promise;
                }
            } else {
                await freshRead.promise;
            }
            return createFile(path);
        });
        if (phase === "file update") {
            const entry = fixture.configSync.pluginList[0] as PluginDataExDisplayV2;
            const setFile = entry.setFile.bind(entry);
            vi.spyOn(entry, "setFile").mockImplementationOnce(async (file) => {
                entered.resolve();
                await earlierRead.promise;
                await setFile(file);
            });
        }
        const pending = fixture.configSync.updatePluginListV2(false, fixture.paths[0]);
        try {
            await entered.promise;
            for (const path of fixture.paths.slice(1)) await fixture.database.remove(await fixture.database.get(path));
            await fixture.configSync.reloadPluginList(false);
            earlierRead.resolve();
            await pending;
        } finally {
            earlierRead.resolve();
            freshRead.resolve();
            await Promise.all(fixture.updates);
        }
        expect(fixture.configSync.pluginList[0].files.map((file) => file.filename)).toEqual([
            "plugins/example/main.js",
        ]);
    });

    it("clearing the disabled feature prevents pending updates from repopulating the list", async () => {
        const fixture = await catalogue();
        const pending = fixture.paths.map((path) => fixture.configSync.updatePluginListV2(false, path));
        fixture.settings.usePluginSync = false;
        await fixture.configSync.updatePluginList(false);
        fixture.release();
        await Promise.all(pending);

        expect(fixture.configSync.pluginList).toEqual([]);
        expect(fixture.configSync.updatingV2Count).toBe(0);
    });

    it("a superseded enumeration cannot reintroduce a deleted item", async () => {
        const fixture = await catalogue();
        const obsoletePath = "ix:device/PLUGIN_MAIN/obsolete%main.js" as FilePathWithPrefix;
        await fixture.localDatabase.putDBEntry(
            optionalFileEntry(obsoletePath, `fixture-header\u200b\n\u200c${btoa(content["main.js"])}`)
        );
        const enumerate = fixture.localDatabase.findEntries.bind(fixture.localDatabase);
        type EnumeratedEntry = ReturnType<typeof enumerate> extends AsyncGenerator<infer Entry> ? Entry : never;
        const obsoleteDocs: EnumeratedEntry[] = [];
        for await (const doc of enumerate(obsoletePath, `${obsoletePath}\u{10ffff}`, { include_docs: true })) {
            obsoleteDocs.push(doc);
        }
        const entered = deferred();
        const release = deferred();
        let scans = 0;
        vi.spyOn(fixture.localDatabase, "findEntries").mockImplementation((...args) => {
            if (scans++ !== 0) return enumerate(...args);
            return (async function* () {
                entered.resolve();
                await release.promise;
                yield* obsoleteDocs;
            })();
        });
        const pending = fixture.configSync.updatePluginList(false);
        try {
            await entered.promise;
            await fixture.database.remove(await fixture.database.get(obsoletePath));
            await fixture.configSync.reloadPluginList(false);
        } finally {
            release.resolve();
            fixture.release();
            await pending;
            await Promise.all(fixture.updates);
        }

        expect(fixture.configSync.pluginList.map((entry) => entry.name)).toEqual(["example"]);
        expect(fixture.configSync.pluginList[0].files).toHaveLength(3);
        expect(fixture.configSync.updatingV2Count).toBe(0);
    });
});
