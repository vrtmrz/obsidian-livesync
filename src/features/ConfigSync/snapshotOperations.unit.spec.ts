import { describe, expect, it, vi } from "vitest";

const asyncHarness = vi.hoisted(() => ({
    fireAndForget: vi.fn((operation: () => unknown) => {
        void operation();
    }),
}));

vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/compat/common/utils")>();
    return {
        ...actual,
        fireAndForget: asyncHarness.fireAndForget,
    };
});

import type { FilePath, FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SnapshotPersistenceResult } from "./snapshotPersistence.ts";
import { SnapshotOperations, type SnapshotOperationsDependencies } from "./snapshotOperations.ts";

const CONFIG_PATH = ".obsidian/app.json" as FilePath;
const V1_PATH = "ix:device-b/CONFIG/app.json.md" as FilePathWithPrefix;
const V2_PATH = "ix:device-a/CONFIG/app.json%app.json" as FilePathWithPrefix;

function createOperations(usePluginSyncV2: boolean) {
    const events: string[] = [];
    type PersistenceResult = SnapshotPersistenceResult<true>;
    const storeCustomisationFileV2 = vi.fn(
        async (_path: FilePath, _term: string, _force?: boolean): Promise<PersistenceResult> => ({
            value: true,
            status: "saved",
            refreshes: [],
        })
    );
    const storeCustomizationFiles = vi.fn(
        async (_path: FilePath, _term: string): Promise<PersistenceResult> => ({
            value: true,
            status: "saved",
            refreshes: [],
        })
    );
    const deleteConfigOnDatabase = vi.fn(
        async (_path: FilePathWithPrefix, _force?: boolean): Promise<PersistenceResult> => ({
            value: true,
            status: "deleted",
            refreshes: [],
        })
    );
    const updatePluginList = vi.fn(async () => {
        events.push("refresh-v1");
    });
    const updatePluginListV2 = vi.fn(async () => {
        events.push("refresh-v2");
    });
    const dependencies: SnapshotOperationsDependencies = {
        getSettings: () => ({ usePluginSyncV2 }),
        getDeviceAndVaultName: () => "device-a",
        log: vi.fn(),
        snapshotPersistence: {
            storeCustomisationFileV2,
            storeCustomizationFiles,
            deleteConfigOnDatabase,
        },
        catalogueOperations: { updatePluginList, updatePluginListV2 },
    };
    return {
        operations: new SnapshotOperations(dependencies),
        events,
        persistence: { storeCustomisationFileV2, storeCustomizationFiles, deleteConfigOnDatabase },
        catalogue: { updatePluginList, updatePluginListV2 },
    };
}

describe("Snapshot Operations", () => {
    it("selects V1 persistence with an override term and awaits its refresh", async () => {
        const fixture = createOperations(false);
        fixture.persistence.storeCustomizationFiles.mockImplementation(async (_path: FilePath, term: string) => {
            fixture.events.push(`persist:${term}`);
            return {
                value: true,
                status: "saved",
                refreshes: [{ mode: "v1", timing: "await", path: V1_PATH }],
            };
        });

        await expect(fixture.operations.storeCustomizationFiles(CONFIG_PATH, "device-b")).resolves.toBe(true);

        expect(fixture.persistence.storeCustomizationFiles).toHaveBeenCalledWith(CONFIG_PATH, "device-b");
        expect(fixture.events).toEqual(["persist:device-b", "refresh-v1"]);
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledWith(false, V1_PATH);
    });

    it("selects V2 persistence with the current term and does not await its refresh", async () => {
        const fixture = createOperations(true);
        let releaseRefresh!: () => void;
        const refresh = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
        });
        fixture.persistence.storeCustomisationFileV2.mockImplementation(async (_path: FilePath, term: string) => {
            fixture.events.push(`persist:${term}`);
            return {
                value: true,
                status: "saved",
                refreshes: [{ mode: "v2", timing: "fire-and-forget", path: V2_PATH }],
            };
        });
        fixture.catalogue.updatePluginListV2.mockImplementation(async () => {
            fixture.events.push("refresh-v2-start");
            await refresh;
            fixture.events.push("refresh-v2-end");
        });

        await expect(fixture.operations.storeCustomizationFiles(CONFIG_PATH)).resolves.toBe(true);

        expect(fixture.events).toEqual(["persist:device-a", "refresh-v2-start"]);
        releaseRefresh();
        await refresh;
        expect(fixture.events).toEqual(["persist:device-a", "refresh-v2-start", "refresh-v2-end"]);
    });

    it("returns the persistence result after applying deletion refreshes", async () => {
        const fixture = createOperations(false);
        fixture.persistence.deleteConfigOnDatabase.mockImplementation(async () => ({
            value: true,
            status: "deleted",
            refreshes: [{ mode: "v1", timing: "await", path: V1_PATH }],
        }));

        await expect(fixture.operations.deleteConfigOnDatabase(V1_PATH)).resolves.toBe(true);

        expect(fixture.persistence.deleteConfigOnDatabase).toHaveBeenCalledWith(V1_PATH, false);
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledWith(false, V1_PATH);
    });
});
