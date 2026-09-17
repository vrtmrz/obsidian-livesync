import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
}));
vi.mock("@/common/utils.ts", () => ({
    EVEN: Symbol("even"),
    cancelTask: vi.fn(),
    fireAndForget: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
    PERIODIC_PLUGIN_SWEEP: 60,
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));
vi.mock("@/features/optionalFileSyncFileTree.ts", () => ({
    collectOptionalFileSyncFiles: vi.fn(),
}));

import type { FilePath, FilePathWithPrefix, LoadedEntry, UXStat } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVEN } from "@vrtmrz/livesync-commonlib/compat/common/models/shared.const.symbols";
import { createCustomisationSyncCodec } from "./customisationSyncCodec.ts";
import { SnapshotPersistence, type SnapshotPersistenceDependencies } from "./snapshotPersistence.ts";

const CONFIG_PATH = ".obsidian/app.json" as FilePath;
const V1_PATH = "ix:device-a/CONFIG/app.json.md" as FilePathWithPrefix;
const V2_PATH = "ix:device-a/CONFIG/app.json%app.json" as FilePathWithPrefix;
const codec = createCustomisationSyncCodec({
    digestHash: (source) => source.join(""),
    parseYaml: () => undefined,
});

function loadedV2Entry(source: string, mtime = 10): LoadedEntry {
    const data = `${codec.dummyHead}${codec.dummyEnd}${btoa(source)}`;
    return {
        _id: "entry-id",
        _rev: "1-a",
        path: V2_PATH,
        type: "plain",
        datatype: "plain",
        data,
        ctime: mtime,
        mtime,
        size: data.length,
        children: [],
        eden: {},
    } as unknown as LoadedEntry;
}

function createPersistence(
    options: {
        category?: "CONFIG" | "PLUGIN_MAIN";
        old?: false | LoadedEntry;
        stat?: UXStat | null;
        content?: string;
        currentTerm?: string;
    } = {}
) {
    const currentTerm = options.currentTerm ?? "device-a";
    const statHidden = vi.fn(
        async (_path: string): Promise<UXStat | null> =>
            options.stat === undefined ? { type: "file", ctime: 10, mtime: 10, size: 5 } : options.stat
    );
    const readHiddenFileBinary = vi.fn(
        async (_path: string) => new TextEncoder().encode(options.content ?? "hello").buffer
    );
    const getDBEntryMeta = vi.fn(async () => options.old ?? false);
    const getDBEntryFromMeta = vi.fn(async (entry: LoadedEntry) => entry);
    const putDBEntry = vi.fn(async () => ({ ok: true, id: "entry-id", rev: "2-b" }));
    const putRaw = vi.fn(async () => ({ ok: true, id: "entry-id", rev: "2-b" }));
    const filenameToUnifiedKey = vi.fn(
        (_path: string, term?: string) =>
            `ix:${term ?? currentTerm}/${options.category ?? "CONFIG"}/app.json.md` as FilePathWithPrefix
    );
    const filenameWithUnifiedKey = vi.fn(
        (_path: string, term?: string) =>
            `ix:${term ?? currentTerm}/${options.category ?? "CONFIG"}/app.json%app.json` as FilePathWithPrefix
    );
    const dependencies: SnapshotPersistenceDependencies = {
        getLocalDatabase: () => ({ getDBEntryMeta, getDBEntryFromMeta, putDBEntry, putRaw }),
        storageAccess: { statHidden, readHiddenFileBinary },
        path: {
            getFileCategory: () => options.category ?? "CONFIG",
            filenameToUnifiedKey,
            filenameWithUnifiedKey,
            path2id: vi.fn(async (path) => path),
            isMarkedAsSameChanges: vi.fn(),
            markChangesAreSame: vi.fn(),
        },
        log: vi.fn(),
        getConfigDir: () => ".obsidian",
    };
    return {
        database: { getDBEntryMeta, getDBEntryFromMeta, putDBEntry, putRaw },
        dependencies,
        filenameToUnifiedKey,
        filenameWithUnifiedKey,
        persistence: new SnapshotPersistence(dependencies),
        readHiddenFileBinary,
        statHidden,
    };
}

describe("Customisation Sync snapshot persistence", () => {
    it("persists a V2 file and returns a fire-and-forget catalogue refresh", async () => {
        const fixture = createPersistence();

        const mutation = await fixture.persistence.storeCustomisationFileV2(CONFIG_PATH, "device-a");

        expect(mutation).toMatchObject({
            value: { ok: true, id: "entry-id", rev: "2-b" },
            status: "saved",
            refreshes: [{ mode: "v2", timing: "fire-and-forget", path: V2_PATH }],
        });
        expect(fixture.database.putDBEntry).toHaveBeenCalledOnce();
        expect(fixture.filenameWithUnifiedKey).toHaveBeenNthCalledWith(1, CONFIG_PATH, "device-a");
        expect(fixture.filenameWithUnifiedKey).toHaveBeenNthCalledWith(2, CONFIG_PATH);
    });

    it("aggregates the V1 plug-in file set and returns an awaited refresh", async () => {
        const fixture = createPersistence({ category: "PLUGIN_MAIN" });

        const mutation = await fixture.persistence.storeCustomizationFiles(
            ".obsidian/plugins/example/main.js" as FilePath,
            "device-a"
        );

        expect(mutation).toMatchObject({
            value: { ok: true },
            status: "saved",
            refreshes: [{ mode: "v1", timing: "await", path: "ix:device-a/PLUGIN_MAIN/app.json.md" }],
        });
        expect(fixture.readHiddenFileBinary).toHaveBeenCalledTimes(3);
        expect(fixture.database.putDBEntry).toHaveBeenCalledOnce();
    });

    it("keeps the inherited duplicate V1 refresh on the empty-file deletion path", async () => {
        const old = {
            ...loadedV2Entry("old"),
            path: V1_PATH,
            datatype: "newnote",
            type: "newnote",
            deleted: false,
        } as LoadedEntry;
        const fixture = createPersistence({ old, stat: null });

        const mutation = await fixture.persistence.storeCustomizationFiles(CONFIG_PATH, "device-a");

        expect(mutation.value).toBeUndefined();
        expect(mutation.status).toBe("deleted");
        expect(mutation.refreshes).toEqual([
            { mode: "v1", timing: "await", path: V1_PATH },
            { mode: "v1", timing: "await", path: V1_PATH },
        ]);
        expect(fixture.database.putRaw).toHaveBeenCalledOnce();
    });

    it.each([
        ["missing", false, "missing"],
        ["already deleted", { ...loadedV2Entry("old"), deleted: true } as LoadedEntry, "already-deleted"],
    ] as const)("treats an absent or %s document as a successful no-op", async (_label, old, status) => {
        const fixture = createPersistence({ old, stat: null });

        const mutation = await fixture.persistence.deleteConfigOnDatabase(V1_PATH);

        expect(mutation).toMatchObject({ value: true, status, refreshes: [] });
        expect(fixture.database.putRaw).not.toHaveBeenCalled();
    });

    it("returns an awaited refresh only when deletion writes a live document", async () => {
        const old = {
            ...loadedV2Entry("old"),
            path: V1_PATH,
            deleted: false,
        } as LoadedEntry;
        const fixture = createPersistence({ old });

        const mutation = await fixture.persistence.deleteConfigOnDatabase(V1_PATH);

        expect(mutation).toMatchObject({
            value: true,
            status: "deleted",
            refreshes: [{ mode: "v1", timing: "await", path: V1_PATH }],
        });
        expect(fixture.database.putRaw).toHaveBeenCalledOnce();
    });

    it("preserves the V2 marker and same-content skips", async () => {
        const markerFixture = createPersistence({ old: loadedV2Entry("old") });
        const marker = markerFixture.dependencies.path.isMarkedAsSameChanges as ReturnType<typeof vi.fn>;
        marker.mockReturnValue(EVEN);
        await expect(
            markerFixture.persistence.storeCustomisationFileV2(CONFIG_PATH, "device-a")
        ).resolves.toMatchObject({
            value: undefined,
            status: "skipped",
            refreshes: [],
        });
        expect(markerFixture.database.putDBEntry).not.toHaveBeenCalled();

        const sameContentFixture = createPersistence({ old: loadedV2Entry("hello") });
        await expect(
            sameContentFixture.persistence.storeCustomisationFileV2(CONFIG_PATH, "device-a")
        ).resolves.toMatchObject({
            value: true,
            status: "skipped",
            refreshes: [],
        });
        expect(sameContentFixture.database.putDBEntry).not.toHaveBeenCalled();
    });
});
