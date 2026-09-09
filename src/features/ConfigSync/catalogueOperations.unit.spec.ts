import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
    processors: [] as Array<{
        clearQueue: ReturnType<typeof vi.fn>;
        enqueue: ReturnType<typeof vi.fn>;
        terminate: ReturnType<typeof vi.fn>;
        startPipeline: ReturnType<typeof vi.fn>;
        process: (entries: AnyEntry[]) => Promise<AnyEntry[]>;
    }>,
    reactiveSources: [] as Array<{
        value: number;
        onChanged: ReturnType<typeof vi.fn>;
        offChanged: ReturnType<typeof vi.fn>;
    }>,
}));

vi.mock("@/deps.ts", () => ({
    parseYaml: vi.fn(),
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
}));
vi.mock("@/common/utils.ts", () => ({
    fireAndForget: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("octagonal-wheels/concurrency/processor", () => ({
    QueueProcessor: class QueueProcessor {
        clearQueue = vi.fn();
        enqueue = vi.fn();
        terminate = vi.fn();
        startPipeline = vi.fn(() => this);

        process: (entries: AnyEntry[]) => Promise<AnyEntry[]>;

        constructor(process: (entries: AnyEntry[]) => Promise<AnyEntry[]>) {
            this.process = process;
            testState.processors.push(this);
        }
    },
}));
vi.mock("octagonal-wheels/dataobject/reactive", () => ({
    reactiveSource: vi.fn((value: number) => {
        const source = {
            value,
            onChanged: vi.fn(),
            offChanged: vi.fn(),
        };
        testState.reactiveSources.push(source);
        return source;
    }),
}));

import { scheduleTask } from "@/common/utils.ts";
import type {
    AnyEntry,
    DocumentID,
    FilePathWithPrefix,
    LoadedEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import { createCustomisationSyncCodec } from "./customisationSyncCodec.ts";
import { CatalogueOperations, type CatalogueOperationsDependencies } from "./catalogueOperations.ts";
import type { SnapshotPersistenceResult } from "./snapshotPersistence.ts";

const codec = createCustomisationSyncCodec({
    digestHash,
    parseYaml: () => undefined,
});
const v2Path = "ix:device-a/PLUGIN_DATA/example%data.json" as FilePathWithPrefix;
const v1Path = "ix:device-a/CONFIG/app.json.md" as FilePathWithPrefix;

function loadedEntry(): LoadedEntry {
    const data = `${codec.dummyHead}${codec.dummyEnd}${btoa("example data")}`;
    return {
        _id: "entry-id",
        _rev: "1-a",
        path: v2Path,
        type: "plain",
        datatype: "plain",
        data,
        ctime: 10,
        mtime: 20,
        size: data.length,
        children: [],
        eden: {},
    } as unknown as LoadedEntry;
}

function createOperations() {
    const settings = { usePluginSync: true, usePluginSyncV2: true };
    const database = {
        findEntries: vi.fn(async function* () {
            // No refresh entries are needed by the focused V2 test.
        }),
        getDBEntry: vi.fn(async () => loadedEntry()),
        putDBEntry: vi.fn(async () => ({ ok: true, id: "entry-id", rev: "2-b" })),
    };
    const deleteConfigOnDatabase = vi.fn(
        async (): Promise<SnapshotPersistenceResult<boolean>> => ({
            value: true,
            status: "missing",
            refreshes: [],
        })
    );
    const snapshotPersistence = {
        deleteConfigOnDatabase,
    };
    const dependencies: CatalogueOperationsDependencies = {
        getSettings: () => settings,
        getLocalDatabase: () => database,
        path: {
            getPath: (entry) => entry.path,
            path2id: async (path) => path as unknown as DocumentID,
        },
        log: vi.fn(),
        snapshotPersistence,
        publishScanCount: vi.fn(),
    };
    return {
        database,
        dependencies,
        settings,
        operations: new CatalogueOperations(dependencies),
        snapshotPersistence,
    };
}

describe("Customisation Sync catalogue operations", () => {
    beforeEach(() => {
        testState.processors.length = 0;
        testState.reactiveSources.length = 0;
        vi.clearAllMocks();
    });

    it("owns and releases the active shared scan processor and its progress subscription", () => {
        const { dependencies, operations } = createOperations();
        operations.enumerationActive.set(true);

        operations.dispose();

        expect(testState.processors).toHaveLength(1);
        expect(testState.processors[0].terminate).toHaveBeenCalledOnce();
        expect(testState.reactiveSources[0].offChanged).toHaveBeenCalledOnce();
        expect(get(operations.enumerationActive)).toBe(false);
        expect(dependencies.publishScanCount).toHaveBeenCalledWith(0);
    });

    it("chooses loading or migration when queued work starts", async () => {
        const { operations, settings } = createOperations();
        const migrate = vi
            .spyOn(
                operations as unknown as { migrateV1ToV2: (showMessage: boolean, entry: AnyEntry) => Promise<void> },
                "migrateV1ToV2"
            )
            .mockResolvedValue(undefined);
        const entry = { path: v1Path, deleted: false } as AnyEntry;

        settings.usePluginSyncV2 = false;
        await testState.processors[0].process([entry]);
        expect(migrate).not.toHaveBeenCalled();

        settings.usePluginSyncV2 = true;
        await testState.processors[0].process([entry]);
        expect(migrate).toHaveBeenCalledOnce();
        operations.dispose();
    });

    it("keeps V2 row publication delayed behind the process-global refresh task", async () => {
        const { operations } = createOperations();

        await operations.updatePluginListV2(false, v2Path);

        expect(get(operations.catalogue)).toEqual([]);
        expect(scheduleTask).toHaveBeenCalledWith("updatePluginListV2", 100, expect.any(Function));

        const publish = vi.mocked(scheduleTask).mock.calls[0]?.[2] as (() => void) | undefined;
        publish?.();

        expect(get(operations.catalogue)).toHaveLength(1);
        expect(get(operations.catalogue)[0]).toMatchObject({
            documentPath: "ix:device-a/PLUGIN_DATA/example.md",
            files: [{ filename: "plugins/example/data.json" }],
        });
        operations.dispose();
    });

    it("uses the persistence deletion outcome and explicitly awaits migration refresh", async () => {
        const { database, operations, snapshotPersistence } = createOperations();
        const loadedV1 = {
            ...loadedEntry(),
            path: v1Path,
            data: codec.serialize({
                category: "CONFIG",
                name: "app.json",
                term: "device-a",
                files: [{ filename: "app.json", data: [btoa("config")], mtime: 10, size: 6 }],
                mtime: 10,
            }),
        } as LoadedEntry;
        database.getDBEntry.mockResolvedValue(loadedV1);
        snapshotPersistence.deleteConfigOnDatabase.mockResolvedValue({
            value: true,
            status: "deleted",
            refreshes: [{ mode: "v1", timing: "await", path: v1Path }],
        });
        const refresh = vi.spyOn(operations, "updatePluginList").mockResolvedValue(undefined);

        await (
            operations as unknown as {
                migrateV1ToV2(showMessage: boolean, entry: LoadedEntry): Promise<void>;
            }
        ).migrateV1ToV2(false, { path: v1Path, deleted: false } as LoadedEntry);

        expect(database.putDBEntry).toHaveBeenCalledOnce();
        expect(snapshotPersistence.deleteConfigOnDatabase).toHaveBeenCalledWith(v1Path);
        expect(refresh).toHaveBeenCalledWith(false, v1Path);
        operations.dispose();
    });
});
