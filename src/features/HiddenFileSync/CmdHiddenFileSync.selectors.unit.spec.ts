import { afterEach, describe, expect, it, vi } from "vitest";
import * as locks from "octagonal-wheels/concurrency/lock";
import { promiseWithResolvers } from "octagonal-wheels/promises";

vi.mock("octagonal-wheels/concurrency/lock", { spy: true });
vi.mock("@/deps.ts", () => ({}));
const jsonResolveModalState = vi.hoisted(() => ({
    callbacks: [] as Array<(keep?: string, result?: string) => Promise<void> | void>,
}));

vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {
        constructor(
            _app: unknown,
            _filename: string,
            _docs: unknown[],
            cb: (keep?: string, result?: string) => Promise<void> | void
        ) {
            jsonResolveModalState.callbacks.push(cb);
        }
        open() {}
    },
}));
vi.mock("@/modules/features/ModuleLog.ts", () => ({ MARK_DONE: "" }));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({ configureHiddenFileSyncMode: vi.fn() }));

import {
    MODE_AUTOMATIC,
    MODE_PAUSED,
    MODE_SELECTIVE,
    MODE_SHINY,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
    type ObsidianLiveSyncSettings,
    type PluginSyncSettingEntry,
    type UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { readContent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { createOptionalFileSyncDatabase, optionalFileEntry } from "../../../test/fixtures/optionalFileSyncDatabase";
import { HiddenFileSync } from "./CmdHiddenFileSync";

const hiddenPath = ".obsidian/plugins/example/main.js" as FilePath;
const prefixedPath = `i:${hiddenPath}`;
const body = "module.exports = class ExamplePlugin {};";
const allowList = "\\.(?:md|png|pdf)$";
const fixtureOwners: Awaited<ReturnType<typeof createOptionalFileSyncDatabase>>[] = [];

function metadata(path: FilePathWithPrefix, revision: string) {
    return {
        _id: String(path) as DocumentID,
        _rev: revision,
        path,
        ctime: 1000,
        mtime: 2000,
        size: 2,
        type: "plain",
        children: [],
        eden: {},
    } satisfies MetaEntry;
}

async function hiddenFiles() {
    const fixture = await createOptionalFileSyncDatabase();
    fixtureOwners.push(fixture);
    fixture.settings.usePluginSync = false;
    const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
    Object.assign(hiddenFileSync, {
        core: {
            settings: fixture.settings,
            localDatabase: fixture.localDatabase,
            services: {
                ...fixture.services,
                vault: { isIgnoredByIgnoreFile: vi.fn(async () => false) },
            },
        },
        cacheFileRegExps: new Map(),
    });
    return { ...fixture, hiddenFileSync };
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const fixture of fixtureOwners.splice(0)) await fixture.dispose();
});

describe("Hidden File Sync customisation exclusions", () => {
    async function configuredFiles(mode = MODE_PAUSED) {
        const fixture = await hiddenFiles();
        Object.assign(fixture.settings, {
            usePluginSync: true,
            syncInternalFilesTargetPatterns: "",
            syncInternalFilesIgnorePatterns: "",
            pluginSyncExtendedSetting: {
                "SNIPPET/MyStyle.css": { key: "SNIPPET/MyStyle.css", mode, files: ["snippets/MyStyle.css"] },
            },
        });
        return fixture;
    }

    describe.each([MODE_PAUSED, MODE_SELECTIVE, MODE_SHINY])("excluded mode %s", (mode) => {
        it.each(["MyStyle.css", "mystyle.css", "MYSTYLE.CSS"])("excludes the registered file %s", async (name) => {
            const fixture = await configuredFiles(mode);

            await expect(fixture.hiddenFileSync.isTargetFile(`.obsidian/snippets/${name}` as FilePath)).resolves.toBe(
                false
            );
        });
    });

    it("excludes unconfigured Customisation Sync files (default Selective)", async () => {
        const fixture = await configuredFiles();

        await expect(fixture.hiddenFileSync.isTargetFile(".obsidian/snippets/Other.css" as FilePath)).resolves.toBe(
            false
        );
        await expect(fixture.hiddenFileSync.isTargetFile(".obsidian/plugins/demo/data.json" as FilePath)).resolves.toBe(
            false
        );
    });

    it("continues to select a file registered with mode MODE_AUTOMATIC", async () => {
        const fixture = await configuredFiles(MODE_AUTOMATIC);

        await expect(fixture.hiddenFileSync.isTargetFile(".obsidian/snippets/MyStyle.css" as FilePath)).resolves.toBe(
            true
        );
    });

    it("releases the exclusion when Customisation Sync is disabled", async () => {
        const fixture = await configuredFiles();
        await expect(fixture.hiddenFileSync.isTargetFile(".obsidian/snippets/MyStyle.css" as FilePath)).resolves.toBe(
            false
        );
        fixture.settings.usePluginSync = false;

        await expect(fixture.hiddenFileSync.isTargetFile(".obsidian/snippets/MyStyle.css" as FilePath)).resolves.toBe(
            true
        );
    });

    it("traverses parent folders and preserves unrelated files and their original case", async () => {
        const fixture = await configuredFiles();
        fixture.settings.usePluginEtc = false;
        const tree: Record<string, { files: string[]; folders: string[] }> = {
            "": { files: [], folders: [".obsidian"] },
            ".obsidian": { files: [], folders: [".obsidian/snippets", ".obsidian/plugins", ".obsidian/themes"] },
            ".obsidian/snippets": {
                files: [
                    ".obsidian/snippets/MyStyle.css",
                    ".obsidian/snippets/Other.css",
                    ".obsidian/snippets/Notes.txt",
                ],
                folders: [],
            },
            ".obsidian/plugins": { files: [], folders: [".obsidian/plugins/demo"] },
            ".obsidian/plugins/demo": {
                files: [".obsidian/plugins/demo/data.json"],
                folders: [".obsidian/plugins/demo/subdir"],
            },
            ".obsidian/plugins/demo/subdir": {
                files: [".obsidian/plugins/demo/subdir/Cache.bin"],
                folders: [],
            },
            ".obsidian/themes": { files: [], folders: [".obsidian/themes/Minimal"] },
            ".obsidian/themes/Minimal": {
                files: [".obsidian/themes/Minimal/theme.css"],
                folders: [".obsidian/themes/Minimal/assets"],
            },
            ".obsidian/themes/Minimal/assets": {
                files: [".obsidian/themes/Minimal/assets/Font.woff2"],
                folders: [],
            },
        };
        const list = vi.fn(async (path: string) => tree[path]);
        Object.assign(fixture.services.context, {
            app: { vault: { getRoot: () => ({ path: "" }), adapter: { list } } },
        });

        await expect(fixture.hiddenFileSync.scanInternalFileNames()).resolves.toEqual([
            ".obsidian/snippets/Notes.txt",
            ".obsidian/plugins/demo/subdir/Cache.bin",
            ".obsidian/themes/Minimal/assets/Font.woff2",
        ]);
        expect(list.mock.calls.map(([path]) => path)).toEqual([
            "",
            ".obsidian",
            ".obsidian/snippets",
            ".obsidian/plugins",
            ".obsidian/plugins/demo",
            ".obsidian/plugins/demo/subdir",
            ".obsidian/themes",
            ".obsidian/themes/Minimal",
            ".obsidian/themes/Minimal/assets",
        ]);
    });
});

describe("issue #1272: Hidden File Sync with normal-file selectors", () => {
    it("stores a selected hidden file while the normal-file allow-list is set", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(true);

        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(prefixedPath, body))).resolves.toMatchObject({
            ok: true,
        });
        const stored = await fixture.localDatabase.getDBEntry(prefixedPath as FilePath);
        expect(stored).not.toBe(false);
        if (stored) expect(await readContent(stored)).toBe(body);
    });

    it("reads existing hidden-file content while the normal-file allow-list is set", async () => {
        const fixture = await hiddenFiles();
        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(prefixedPath, body))).resolves.toMatchObject({
            ok: true,
        });
        const meta = await fixture.localDatabase.getDBEntryMeta(prefixedPath as FilePath);
        if (!meta) throw new Error("The seeded hidden-file Metadata is unavailable");
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(true);

        const entry = await fixture.localDatabase.getDBEntryFromMeta(meta);
        expect(entry).not.toBe(false);
        if (entry) expect(await readContent(entry)).toBe(body);
    });

    it("stores and reads the same hidden file when the normal-file allow-list is empty", async () => {
        const fixture = await hiddenFiles();
        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(prefixedPath, body))).resolves.toMatchObject({
            ok: true,
        });
        const entry = await fixture.localDatabase.getDBEntry(prefixedPath as FilePath);
        expect(entry).not.toBe(false);
        if (entry) expect(await readContent(entry)).toBe(body);
    });

    it("continues to apply the normal-file allow-list to ordinary files", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        expect(fixture.localDatabase.isTargetFile("notes/example.md" as FilePath)).toBe(true);
        expect(fixture.localDatabase.isTargetFile("notes/example.js" as FilePath)).toBe(false);
        expect(fixture.localDatabase.isTargetFile("i:.obsidian/example.md" as FilePath)).toBe(true);
    });

    it("keeps Customisation Sync documents usable with the same normal-file allow-list", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        const path = "ix:device/PLUGIN_MAIN/example%main.js" as FilePath;
        await expect(fixture.localDatabase.putDBEntry(optionalFileEntry(path, body))).resolves.toMatchObject({
            ok: true,
        });
        const entry = await fixture.localDatabase.getDBEntry(path);
        expect(entry).not.toBe(false);
        if (entry) expect(await readContent(entry)).toBe(body);
    });

    it("keeps Hidden File Sync target and ignore patterns effective", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncInternalFilesTargetPatterns =
            "^\\.obsidian/plugins/" as typeof fixture.settings.syncInternalFilesTargetPatterns;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(true);
        await expect(fixture.hiddenFileSync.isTargetFile(".obsidian/snippets/example.css" as FilePath)).resolves.toBe(
            false
        );
        fixture.settings.syncInternalFilesIgnorePatterns =
            "main\\.js$" as typeof fixture.settings.syncInternalFilesIgnorePatterns;
        await expect(fixture.hiddenFileSync.isTargetFile(hiddenPath)).resolves.toBe(false);
    });

    it("compatibility: applies the normal-file ignore-list to hidden documents", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncOnlyRegEx = allowList as typeof fixture.settings.syncOnlyRegEx;
        fixture.settings.syncIgnoreRegEx = "^\\.obsidian/" as typeof fixture.settings.syncIgnoreRegEx;
        expect(fixture.localDatabase.isTargetFile(prefixedPath as FilePath)).toBe(false);
    });

    it("rejects hidden documents when Hidden File Sync is disabled", async () => {
        const fixture = await hiddenFiles();
        fixture.settings.syncInternalFiles = false;
        expect(fixture.localDatabase.isTargetFile(prefixedPath as FilePath)).toBe(false);
    });
});

describe("issue #825: incoming i: reflection, conflict guards, and Automatic patterns", () => {
    async function bothEnabled(extendedSetting: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] = {}) {
        const fixture = await hiddenFiles();
        Object.assign(fixture.settings, {
            syncInternalFiles: true,
            usePluginSync: true,
            usePluginSyncV2: true,
            syncInternalFilesTargetPatterns: "",
            syncInternalFilesIgnorePatterns: "",
            pluginSyncExtendedSetting: extendedSetting,
        });
        fixture.hiddenFileSync._log = vi.fn();
        return fixture;
    }

    it.each<{ label: string; setting: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] }>([
        { label: "default Selective (no entry)", setting: {} },
        {
            label: "Flagged Selective (MODE_SHINY)",
            setting: { "SNIPPET/MyStyle.css": { key: "SNIPPET/MyStyle.css", mode: MODE_SHINY, files: [] } },
        },
        {
            label: "Ignore (MODE_PAUSED)",
            setting: { "SNIPPET/MyStyle.css": { key: "SNIPPET/MyStyle.css", mode: MODE_PAUSED, files: [] } },
        },
    ])("retains incoming i: in DB without writing to Vault for $label", async ({ setting }) => {
        const fixture = await bothEnabled(setting);
        const path = "i:.obsidian/snippets/MyStyle.css" as FilePathWithPrefix;
        const incoming = "body { color: blue; }";
        const saved = await fixture.localDatabase.putDBEntry(optionalFileEntry(path, incoming));
        if (!saved) throw new Error("The incoming database revision could not be seeded");
        const doc = await fixture.localDatabase.getDBEntry(path, { rev: saved.rev });
        if (!doc) throw new Error("The incoming database revision could not be read");
        const vaultPath = ".obsidian/snippets/MyStyle.css";
        const original = "body { color: red; }";
        const vault = new Map([[vaultPath, original]]);
        const writeFile = vi.fn(async (file: string, content: string) => {
            vault.set(file, content);
        });
        const deleteFile = vi.fn(async (file: string) => vault.delete(file));
        Object.assign(fixture.hiddenFileSync.core, {
            storageAccess: { writeHiddenFileAuto: writeFile, removeHidden: deleteFile },
        });
        const queueConflictCheck = vi.spyOn(fixture.hiddenFileSync, "queueConflictCheck");

        await expect(fixture.hiddenFileSync._anyProcessOptionalSyncFiles(doc)).resolves.toBe(true);
        const retained = await fixture.localDatabase.getDBEntry(path);
        expect(retained && retained._rev).toBe(saved.rev);
        expect(retained && readContent(retained)).toBe(incoming);
        expect(vault.get(vaultPath)).toBe(original);
        expect(writeFile).not.toHaveBeenCalled();
        expect(deleteFile).not.toHaveBeenCalled();
        expect(queueConflictCheck).not.toHaveBeenCalled();
    });

    it("does not queue conflict resolution for Selective, Flagged Selective, or Ignore items", async () => {
        const fixture = await bothEnabled({
            "SNIPPET/Flagged.css": { key: "SNIPPET/Flagged.css", mode: MODE_SHINY, files: [] },
            "SNIPPET/Ignored.css": { key: "SNIPPET/Ignored.css", mode: MODE_PAUSED, files: [] },
            "SNIPPET/Auto.css": { key: "SNIPPET/Auto.css", mode: MODE_AUTOMATIC, files: [] },
        });
        const queueConflictCheck = vi.fn();
        fixture.hiddenFileSync.queueConflictCheck = queueConflictCheck;

        await expect(
            fixture.hiddenFileSync._anyGetOptionalConflictCheckMethod(
                "i:.obsidian/snippets/DefaultSelective.css" as FilePathWithPrefix
            )
        ).resolves.toBe(true);
        await expect(
            fixture.hiddenFileSync._anyGetOptionalConflictCheckMethod(
                "i:.obsidian/snippets/Flagged.css" as FilePathWithPrefix
            )
        ).resolves.toBe(true);
        await expect(
            fixture.hiddenFileSync._anyGetOptionalConflictCheckMethod(
                "i:.obsidian/snippets/Ignored.css" as FilePathWithPrefix
            )
        ).resolves.toBe(true);
        expect(queueConflictCheck).not.toHaveBeenCalled();

        await expect(
            fixture.hiddenFileSync._anyGetOptionalConflictCheckMethod(
                "i:.obsidian/snippets/Auto.css" as FilePathWithPrefix
            )
        ).resolves.toBe(true);
        expect(queueConflictCheck).toHaveBeenCalledExactlyOnceWith("i:.obsidian/snippets/Auto.css");
    });

    it("aborts resolveByNewerEntry without touching revisions when ownership leaves Hidden File Sync", async () => {
        const fixture = await bothEnabled();
        const path = "i:.obsidian/snippets/DefaultSelective.css" as FilePathWithPrefix;
        const id = path as unknown as DocumentID;
        const removeRevision = vi.spyOn(fixture.localDatabase, "removeRevision");
        vi.spyOn(fixture.localDatabase, "getRaw").mockResolvedValue(metadata(path, "2-b"));
        const finishConflictCheck = vi.fn();
        fixture.hiddenFileSync.finishConflictCheck = finishConflictCheck;

        await fixture.hiddenFileSync.resolveByNewerEntry(
            id,
            path,
            { ...metadata(path, "2-a"), mtime: 1000 },
            "2-a",
            "2-b"
        );

        expect(removeRevision).not.toHaveBeenCalled();
        expect(finishConflictCheck).toHaveBeenCalledWith(path);
    });

    it("keeps Automatic items subject to Hidden File Sync target and ignore patterns and disabled flag", async () => {
        const fixture = await bothEnabled({
            "SNIPPET/Auto.css": { key: "SNIPPET/Auto.css", mode: MODE_AUTOMATIC, files: ["snippets/Auto.css"] },
        });
        fixture.settings.syncInternalFilesIgnorePatterns =
            "Auto\\.css$" as typeof fixture.settings.syncInternalFilesIgnorePatterns;

        await expect(
            fixture.hiddenFileSync.isAutomaticHiddenTarget(".obsidian/snippets/Auto.css" as FilePath)
        ).resolves.toBe(false);

        fixture.settings.syncInternalFilesIgnorePatterns =
            "" as typeof fixture.settings.syncInternalFilesIgnorePatterns;
        await expect(
            fixture.hiddenFileSync.isAutomaticHiddenTarget(".obsidian/snippets/Auto.css" as FilePath)
        ).resolves.toBe(true);

        fixture.settings.syncInternalFiles = false;
        await expect(
            fixture.hiddenFileSync.isAutomaticHiddenTarget(".obsidian/snippets/Auto.css" as FilePath)
        ).resolves.toBe(false);
    });

    it("skips Vault extraction when ownership switches to Ignore while waiting for serializedForEvent", async () => {
        const extendedSetting: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] = {
            "CONFIG/app.json": { key: "CONFIG/app.json", mode: MODE_AUTOMATIC, files: ["app.json"] },
        };
        const fixture = await bothEnabled(extendedSetting);
        const extract = vi.fn(async () => true);
        fixture.hiddenFileSync.extractInternalFileFromDatabase = extract;
        fixture.hiddenFileSync.serializedForEvent = async (_path, proc) => {
            extendedSetting["CONFIG/app.json"].mode = MODE_PAUSED;
            return await proc();
        };

        await expect(
            fixture.hiddenFileSync.trackDatabaseFileModification(".obsidian/app.json" as FilePath, "[Test]")
        ).resolves.toBe(true);
        expect(extract).not.toHaveBeenCalled();
    });

    it("aborts JSON conflict confirmation when ownership leaves Hidden File Sync after the dialog opens", async () => {
        const extendedSetting: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] = {
            "CONFIG/app.json": { key: "CONFIG/app.json", mode: MODE_AUTOMATIC, files: ["app.json"] },
        };
        const fixture = await bothEnabled(extendedSetting);
        jsonResolveModalState.callbacks.length = 0;
        const deleteDBEntry = vi.spyOn(fixture.localDatabase, "deleteDBEntry");
        const extract = vi.fn(async () => true);
        const writeFile = vi.fn(async () => ({ type: "file" as const, ctime: 1000, mtime: 2000, size: 2 }));
        fixture.hiddenFileSync.extractInternalFileFromDatabase = extract;
        fixture.hiddenFileSync.writeFile = writeFile;

        const docA = {
            _id: "i:.obsidian/app.json",
            _rev: "2-a",
            path: "i:.obsidian/app.json",
            data: "{}",
        } as unknown as LoadedEntry;
        const docB = {
            _id: "i:.obsidian/app.json",
            _rev: "2-b",
            path: "i:.obsidian/app.json",
            data: "{\"a\":1}",
        } as unknown as LoadedEntry;

        const mergePromise = fixture.hiddenFileSync.showJSONMergeDialogAndMerge(docA, docB);
        expect(jsonResolveModalState.callbacks).toHaveLength(1);

        extendedSetting["CONFIG/app.json"].mode = MODE_SELECTIVE;
        await jsonResolveModalState.callbacks[0]("2-a");

        await expect(mergePromise).resolves.toBe(false);
        expect(deleteDBEntry).not.toHaveBeenCalled();
        expect(writeFile).not.toHaveBeenCalled();
        expect(extract).not.toHaveBeenCalled();
    });

    it.each(["upload", "deletion"])("skips automatic DB %s after ownership changes while waiting for the lock", async (kind) => {
        const name = "app.json";
        const path = `.obsidian/${name}` as FilePath;
        const prefixed = `i:${path}` as FilePathWithPrefix;
        const selection: PluginSyncSettingEntry = { key: `CONFIG/${name}`, mode: MODE_AUTOMATIC, files: [name] };
        const fixture = await bothEnabled({ [selection.key]: selection });
        await fixture.localDatabase.putDBEntry(optionalFileEntry(prefixed, "{}"));
        const before = await fixture.database.get(prefixed);
        const putEntry = vi.spyOn(fixture.localDatabase, "putDBEntry");
        const putRaw = vi.spyOn(fixture.localDatabase, "putRaw");
        fixture.hiddenFileSync.updateLastProcessed = vi.fn();
        fixture.hiddenFileSync.updateLastProcessedDeletion = vi.fn();

        const lock = vi.mocked(locks.withLock);
        lock.mockClear();
        const entered = promiseWithResolvers<void>();
        const release = promiseWithResolvers<void>();
        const key = `file-${prefixed}`;
        const holder = locks.withLock(key, async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;
        const file: UXFileInfo = {
            name,
            path,
            stat: { type: "file", ctime: 1000, mtime: 3000, size: 7 },
            body: new Blob(['{"a":1}']),
        };
        const operation = kind === "upload"
            ? fixture.hiddenFileSync.storeInternalFileToDatabase(file)
            : fixture.hiddenFileSync.deleteInternalFileOnDatabase(path);
        try {
            await vi.waitFor(() => expect(lock.mock.calls.filter(([lockKey]) => lockKey === key)).toHaveLength(2));
            selection.mode = MODE_SELECTIVE;
        } finally {
            release.resolve();
            await holder;
        }
        await expect(operation).resolves.toBe(false);
        await expect(fixture.database.get(prefixed)).resolves.toEqual(before);
        expect(putEntry).not.toHaveBeenCalled();
        expect(putRaw).not.toHaveBeenCalled();
    });

    it("skips Vault reflection if ownership changes while reading incoming content", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const prefixed = `i:${path}` as FilePathWithPrefix;
        const selection: PluginSyncSettingEntry = { key: "CONFIG/app.json", mode: MODE_AUTOMATIC, files: ["app.json"] };
        const fixture = await bothEnabled({ [selection.key]: selection });
        await fixture.localDatabase.putDBEntry(optionalFileEntry(prefixed, '{"incoming":true}'));
        const entry = await fixture.localDatabase.getDBEntryMeta(prefixed);
        if (!entry) throw new Error("No incoming Metadata found");
        const read = fixture.localDatabase.getDBEntryFromMeta.bind(fixture.localDatabase);
        const entered = promiseWithResolvers<void>();
        const release = promiseWithResolvers<void>();
        vi.spyOn(fixture.localDatabase, "getDBEntryFromMeta").mockImplementationOnce(async (...args) => {
            entered.resolve();
            await release.promise;
            return read(...args);
        });
        const write = vi.fn(async () => false as const);
        fixture.hiddenFileSync.__writeFile = write;
        const operation = fixture.hiddenFileSync.extractInternalFileFromDatabase(path, true, entry, false);
        try {
            await entered.promise;
            selection.mode = MODE_SELECTIVE;
        } finally {
            release.resolve();
        }

        const result = await operation;
        expect(write).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it("leaves the JSON conflict unresolved if ownership changes during Vault preparation", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const prefixed = `i:${path}` as FilePathWithPrefix;
        const selection: PluginSyncSettingEntry = { key: "CONFIG/app.json", mode: MODE_AUTOMATIC, files: ["app.json"] };
        const fixture = await bothEnabled({ [selection.key]: selection });
        jsonResolveModalState.callbacks.length = 0;
        const entered = promiseWithResolvers<void>();
        const release = promiseWithResolvers<void>();
        const write = vi.fn(async () => ({ type: "file" as const, ctime: 1000, mtime: 2000, size: 7 }));
        Object.assign(fixture.hiddenFileSync.core, {
            storageAccess: {
                isExistsIncludeHidden: async () => {
                    entered.resolve();
                    await release.promise;
                    return true;
                },
            },
        });
        fixture.hiddenFileSync.writeFile = write;
        fixture.hiddenFileSync.storeInternalFileToDatabase = vi.fn(async () => true);
        fixture.hiddenFileSync.triggerEvent = vi.fn(async () => {});
        const deleteEntry = vi.spyOn(fixture.localDatabase, "deleteDBEntry").mockResolvedValue(false);
        const first: LoadedEntry = { ...metadata(prefixed, "2-a"), datatype: "plain", data: ["{}"] };
        const second: LoadedEntry = { ...metadata(prefixed, "2-b"), datatype: "plain", data: ['{"a":1}'] };
        const result = fixture.hiddenFileSync.showJSONMergeDialogAndMerge(first, second);
        const confirm = jsonResolveModalState.callbacks[0](undefined, '{"a":1}');
        try {
            await entered.promise;
            selection.mode = MODE_SELECTIVE;
        } finally {
            release.resolve();
            await confirm;
        }

        await expect(result).resolves.toBe(false);
        expect(write).not.toHaveBeenCalled();
        expect(deleteEntry).not.toHaveBeenCalled();
    });

    it("skips Vault deletion when ownership switches to Ignore while waiting for the inner file lock", async () => {
        const extendedSetting: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] = {
            "CONFIG/app.json": { key: "CONFIG/app.json", mode: MODE_AUTOMATIC, files: ["app.json"] },
        };
        const fixture = await bothEnabled(extendedSetting);
        const deleteFile = vi.fn(async () => "OK" as const);
        const writeFile = vi.fn(async () => false as const);
        fixture.hiddenFileSync.__deleteFile = deleteFile;
        fixture.hiddenFileSync.__writeFile = writeFile;

        let lockEntered!: () => void;
        const lockReady = new Promise<void>((resolve) => {
            lockEntered = resolve;
        });
        let releaseLock!: () => void;
        const lockGate = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });

        const holder = locks.withLock("file-i:.obsidian/app.json", async () => {
            lockEntered();
            await lockGate;
        });
        await lockReady;

        const deletedMeta = {
            _id: "i:.obsidian/app.json" as DocumentID,
            _rev: "2-del",
            path: "i:.obsidian/app.json" as FilePathWithPrefix,
            deleted: true,
            mtime: 3000,
        } as unknown as MetaEntry;

        const extraction = fixture.hiddenFileSync.extractInternalFileFromDatabase(
            ".obsidian/app.json" as FilePath,
            false,
            deletedMeta
        );
        await Promise.resolve();
        extendedSetting["CONFIG/app.json"].mode = MODE_PAUSED;
        releaseLock();
        await holder;

        await expect(extraction).resolves.toBeUndefined();
        expect(deleteFile).not.toHaveBeenCalled();
        expect(writeFile).not.toHaveBeenCalled();
    });
});
