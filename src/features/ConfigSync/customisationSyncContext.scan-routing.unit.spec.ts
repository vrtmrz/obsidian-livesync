import { describe, expect, it, vi } from "vitest";
import type { FilePath, FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
    PERIODIC_PLUGIN_SWEEP: 60,
}));
vi.mock("@/common/utils.ts", () => ({
    cancelTask: vi.fn(),
    EVEN: Symbol("even"),
    isCustomisationSyncMetadata: vi.fn(),
    isPluginMetadata: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {},
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

import { CustomisationSyncContext } from "./customisationSyncContext.ts";
import { createCustomisationSyncTestDependencies } from "./customisationSyncContext.unit.fixture.ts";

const PATH = ".obsidian/plugins/example/data.json" as FilePath;
const V1_PATH = "ix:device-a/PLUGIN_DATA/example.md" as FilePathWithPrefix;
const V2_PATH = "ix:device-a/PLUGIN_DATA/example%data.json" as FilePathWithPrefix;

function asyncEntries(entries: object[]) {
    return {
        async *[Symbol.asyncIterator]() {
            yield* entries;
        },
    };
}

function createConfigSync(options: {
    useV2: boolean;
    localFiles?: FilePath[];
    databasePaths?: FilePathWithPrefix[];
    ownsLocalFile?: boolean;
    ownsLocalDocument?: boolean;
}) {
    const storeCustomizationFiles = vi.fn(async () => true);
    const storeCustomisationFileV2 = vi.fn(async () => true);
    const deleteConfigOnDatabase = vi.fn(async () => true);
    const ownsLocalFile = vi.fn(() => options.ownsLocalFile ?? true);
    const ownsLocalDocument = vi.fn(() => options.ownsLocalDocument ?? true);
    const databaseEntries = (options.databasePaths ?? []).map((path) => ({ _id: path, path }));
    const localDatabase = {
        findEntries: vi.fn(() => asyncEntries(databaseEntries)),
        allDocsRaw: vi.fn(async () => ({
            rows: databaseEntries.map((doc) => ({ doc: { ...doc, deleted: false } })),
        })),
    };
    const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
    Object.assign(configSync, {
        dependencies: createCustomisationSyncTestDependencies({
            getConfigDir: () => ".obsidian",
            getSettings: () => ({
                usePluginSync: true,
                usePluginSyncV2: options.useV2,
                usePluginEtc: true,
                pluginSyncExtendedSetting: {},
                autoSweepPlugins: false,
                autoSweepPluginsPeriodic: false,
                watchInternalFileChanges: false,
                notifyPluginOrSettingUpdated: false,
            }),
            getLocalDatabase: () => localDatabase as never,
            ownsLocalFile,
            ownsLocalDocument,
        }),
        scanInternalFiles: vi.fn(async () => options.localFiles ?? []),
        filenameToUnifiedKey: vi.fn(() => V1_PATH),
        filenameWithUnifiedKey: vi.fn(() => V2_PATH),
        unifiedKeyPrefixOfTerminal: vi.fn(() => "ix:device-a/"),
        getPath: vi.fn((entry: { path: FilePathWithPrefix }) => entry.path),
        storeCustomizationFiles,
        storeCustomisationFileV2,
        deleteConfigOnDatabase,
        updatePluginList: vi.fn(async () => undefined),
        _log: vi.fn(),
    });
    return {
        configSync,
        deleteConfigOnDatabase,
        ownsLocalDocument,
        ownsLocalFile,
        storeCustomisationFileV2,
        storeCustomizationFiles,
    };
}

describe("Customisation Sync scan ownership", () => {
    it.each([
        ["V1", false],
        ["V2", true],
    ] as const)("does not store a %s local file assigned to another owner", async (_label, useV2) => {
        const fixture = createConfigSync({ useV2, localFiles: [PATH], ownsLocalFile: false });

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.ownsLocalFile).toHaveBeenCalledWith(PATH);
        expect(fixture.storeCustomizationFiles).not.toHaveBeenCalled();
        expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
    });

    it("does not create a deletion for an existing V1 document which is no longer locally owned", async () => {
        const fixture = createConfigSync({
            useV2: false,
            databasePaths: [V1_PATH],
            ownsLocalDocument: false,
        });

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.ownsLocalDocument).toHaveBeenCalledWith(V1_PATH);
        expect(fixture.deleteConfigOnDatabase).not.toHaveBeenCalled();
    });
});
