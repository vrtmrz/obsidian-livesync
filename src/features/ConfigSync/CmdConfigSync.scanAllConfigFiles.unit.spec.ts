import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("./PluginDialogModal.ts", () => ({
    PluginDialogModal: class PluginDialogModal {},
}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class ConflictResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        core!: { services: unknown; localDatabase: unknown; settings: unknown };
        get localDatabase() {
            return this.core.localDatabase;
        }
        get services() {
            return this.core.services;
        }
        get settings() {
            return this.core.settings;
        }
    },
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
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "open-plugin-sync",
    eventHub: {
        onEvent: vi.fn(),
    },
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/features/HiddenFileCommon/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

vi.mock("octagonal-wheels/concurrency/scoped.iteration", { spy: true });

import {
    LOG_LEVEL_VERBOSE,
    MODE_AUTOMATIC,
    MODE_PAUSED,
    MODE_SELECTIVE,
    MODE_SHINY,
    type FilePath,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import * as iterationModule from "octagonal-wheels/concurrency/scoped.iteration";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { ConfigSync } from "./CmdConfigSync";

const term = "device";
const prefix = `ix:${term}/`;
const keyOf = (path: string) => prefix + path;
type Row = { _id: string; path: string };
const row = (name: string, path = name): Row => ({ _id: keyOf(name), path });

function setup(files: string[] = [], rows: Row[] = []) {
    const events: string[] = [];
    const findEntries = vi.fn(async function* () {
        yield* rows;
    });
    const allDocsRaw = vi.fn(async () => ({ rows: rows.map((doc) => ({ doc })) }));
    const scanInternalFiles = vi.fn(async () => files as FilePath[]);
    const storeCustomisationFileV2 = vi.fn(async (path: string, _term: string) => {
        events.push(`store:${path}`);
    });
    const deleteConfigOnDatabase = vi.fn(async (key: string) => {
        events.push(`delete:${key}`);
    });
    const storeCustomizationFiles = vi.fn(async (path: string) => {
        events.push(`store:${path}`);
    });
    const updatePluginList = vi.fn(async (_showMessage: boolean) => {});
    const log = vi.fn();
    const configSync = Object.create(ConfigSync.prototype) as ConfigSync;
    Object.assign(configSync, {
        core: {
            settings: { usePluginSyncV2: true, pluginSyncExtendedSetting: {} },
            localDatabase: { findEntries, allDocsRaw },
            services: {
                setting: { getDeviceAndVaultName: () => term },
                API: { getSystemConfigDir: () => ".obsidian" },
            },
        },
        scanInternalFiles,
        isTargetPath: (path: string) => path !== "ignored",
        filenameWithUnifiedKey: (path: string, _term: string) => keyOf(path),
        unifiedKeyPrefixOfTerminal: (_term: string) => prefix,
        storeCustomisationFileV2,
        storeCustomizationFiles,
        deleteConfigOnDatabase,
        getPath: (entry: Row) => entry.path,
        updatePluginList,
        _log: log,
    });
    return {
        configSync,
        events,
        findEntries,
        scanInternalFiles,
        storeCustomisationFileV2,
        storeCustomizationFiles,
        deleteConfigOnDatabase,
        updatePluginList,
        log,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe.each([false, true])("ConfigSync scan mode selection (V2: %s)", (useV2) => {
    const workspace = ".obsidian/workspace.json";
    const legacyWorkspace = `${prefix}CONFIG/workspace.json.md`;
    const v2Workspace = `${prefix}CONFIG/workspace.json%workspace.json`;

    function setupMode(
        mode?: number,
        localFiles = [workspace],
        registeredFiles = ["workspace.json"],
        settingKey = "CONFIG/workspace.json"
    ) {
        const rows: Row[] = [];
        const fixture = setup(localFiles, rows);
        Object.assign(fixture.configSync.core.settings, {
            usePluginSyncV2: useV2,
            pluginSyncExtendedSetting:
                mode === undefined ? {} : { [settingKey]: { key: settingKey, mode, files: registeredFiles } },
        });
        Object.assign(fixture.configSync, {
            isTargetPath: ConfigSync.prototype.isTargetPath,
            filenameWithUnifiedKey: ConfigSync.prototype.filenameWithUnifiedKey,
        });
        return { ...fixture, rows };
    }

    it.each([MODE_PAUSED, MODE_AUTOMATIC])("does not collect a new file registered with mode %s", async (mode) => {
        const fixture = setupMode(mode);

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.storeCustomizationFiles).not.toHaveBeenCalled();
        expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
        expect(fixture.deleteConfigOnDatabase).not.toHaveBeenCalled();
    });

    it.each([MODE_PAUSED, MODE_AUTOMATIC])("preserves existing documents for mode %s", async (mode) => {
        const fixture = setupMode(mode);
        fixture.rows.push({ _id: legacyWorkspace, path: legacyWorkspace }, { _id: v2Workspace, path: v2Workspace });

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.events).toEqual([]);
    });

    it.each([MODE_PAUSED, MODE_AUTOMATIC])(
        "preserves excluded documents when the local file is absent (mode %s)",
        async (mode) => {
            const fixture = setupMode(mode, []);
            fixture.rows.push({ _id: legacyWorkspace, path: legacyWorkspace }, { _id: v2Workspace, path: v2Workspace });

            await fixture.configSync.scanAllConfigFiles(false);

            expect(fixture.events).toEqual([]);
        }
    );

    it("retains case-insensitive exclusions without protecting unrelated missing files", async () => {
        const fixture = setupMode(MODE_PAUSED, [workspace], ["WORKSPACE.json"]);
        fixture.rows.push(
            { _id: legacyWorkspace, path: legacyWorkspace },
            { _id: `${prefix}CONFIG/stale.json.md`, path: `${prefix}CONFIG/stale.json.md` }
        );

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.events).toEqual([`delete:${prefix}CONFIG/stale.json.md`]);
    });

    it.each([undefined, MODE_SELECTIVE, MODE_SHINY])("continues to collect files with mode %s", async (mode) => {
        const fixture = setupMode(mode);

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.events).toEqual([`store:${workspace}`]);
    });

    it.each([{ registeredFiles: [] }, { registeredFiles: ["different.json"] }])(
        "excludes items by key even when the recorded file list is empty or outdated ($registeredFiles)",
        async ({ registeredFiles }) => {
            const fixture = setupMode(MODE_PAUSED, [workspace], registeredFiles);
            fixture.rows.push({ _id: legacyWorkspace, path: legacyWorkspace }, { _id: v2Workspace, path: v2Workspace });

            await fixture.configSync.scanAllConfigFiles(false);

            expect(fixture.events).toEqual([]);
        }
    );

    it("preserves an excluded plug-in group even when all its local files are absent", async () => {
        const fixture = setupMode(
            MODE_PAUSED,
            [],
            ["plugins/example/main.js", "plugins/example/manifest.json"],
            "PLUGIN_MAIN/example"
        );
        fixture.rows.push({ _id: `${prefix}PLUGIN_MAIN/example.md`, path: `${prefix}PLUGIN_MAIN/example.md` });

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.events).toEqual([]);
    });
});

describe.each([
    { usePluginSyncV2: false, usePluginEtc: false },
    { usePluginSyncV2: false, usePluginEtc: true },
    { usePluginSyncV2: true, usePluginEtc: false },
    { usePluginSyncV2: true, usePluginEtc: true },
])("ConfigSync saved PLUGIN_ETC retention ($usePluginSyncV2, $usePluginEtc)", (settings) => {
    it.each([
        { mode: MODE_PAUSED, present: true },
        { mode: MODE_PAUSED, present: false },
        { mode: MODE_AUTOMATIC, present: true },
        { mode: MODE_AUTOMATIC, present: false },
    ])("preserves the excluded snapshot (mode $mode, local file present: $present)", async ({ mode, present }) => {
        const path = ".obsidian/plugins/example/cache.json";
        const saved = `${prefix}PLUGIN_ETC/example%cache.json`;
        const stale = `${prefix}CONFIG/stale.json.md`;
        const fixture = setup(present ? [path] : [], [
            { _id: saved, path: saved },
            { _id: stale, path: stale },
        ]);
        Object.assign(fixture.configSync.core.settings, {
            ...settings,
            pluginSyncExtendedSetting: {
                "PLUGIN_ETC/example": {
                    key: "PLUGIN_ETC/example",
                    mode,
                    files: ["plugins/example/cache.json"],
                },
            },
        });
        Object.assign(fixture.configSync, {
            isTargetPath: ConfigSync.prototype.isTargetPath,
            filenameWithUnifiedKey: ConfigSync.prototype.filenameWithUnifiedKey,
        });

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.deleteConfigOnDatabase).toHaveBeenCalledExactlyOnceWith(stale);
        expect(fixture.storeCustomizationFiles).not.toHaveBeenCalled();
        expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
        expect(fixture.configSync.isTargetPath(path)).toBe(settings.usePluginSyncV2 && settings.usePluginEtc);
    });

    it("skips deleting a V1 candidate that switches to Ignore mid-scan", async () => {
        if (settings.usePluginSyncV2) return;
        const keepLocal = ".obsidian/snippets/keep.css";
        const stale = `${prefix}SNIPPET/stale.css.md`;
        const fixture = setup([keepLocal], [{ _id: stale, path: stale }]);
        const extendedSetting: Record<string, { key: string; mode: number; files: string[] }> = {};
        Object.assign(fixture.configSync.core.settings, {
            ...settings,
            pluginSyncExtendedSetting: extendedSetting,
        });
        Object.assign(fixture.configSync, {
            isTargetPath: ConfigSync.prototype.isTargetPath,
            filenameToUnifiedKey: ConfigSync.prototype.filenameToUnifiedKey,
        });
        fixture.storeCustomizationFiles.mockImplementationOnce(async () => {
            extendedSetting["SNIPPET/stale.css"] = {
                key: "SNIPPET/stale.css",
                mode: MODE_PAUSED,
                files: ["snippets/stale.css"],
            };
        });

        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.storeCustomizationFiles).toHaveBeenCalledExactlyOnceWith(keepLocal);
        expect(fixture.deleteConfigOnDatabase).not.toHaveBeenCalled();
    });
});

describe("ConfigSync V2 scan behaviour", () => {
    it("finishes existing database entries before storing extra files and retains target filtering", async () => {
        const fixture = setup(
            ["matched", "extra", "ignored"],
            [row("matched"), row("stale"), row("encoded", "encoded%path")]
        );
        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.events).toEqual(["store:matched", `delete:${keyOf("stale")}`, "store:extra"]);
        expect(fixture.storeCustomisationFileV2.mock.calls).toEqual([
            ["matched", term],
            ["extra", term],
        ]);
        expect(fixture.deleteConfigOnDatabase).toHaveBeenCalledExactlyOnceWith(keyOf("stale"));
        expect(fixture.findEntries).toHaveBeenCalledExactlyOnceWith(prefix, `${prefix}\u{10ffff}`, {
            include_docs: true,
        });
        expect(fixture.updatePluginList).toHaveBeenCalledExactlyOnceWith(false);
    });

    it("retains a V1 deletion candidate that switches to Automatic during a V2 scan", async () => {
        const stale = `${prefix}CONFIG/stale.json.md`;
        const fixture = setup();
        const waiting = promiseWithResolvers<void>();
        const resume = promiseWithResolvers<void>();
        fixture.findEntries.mockImplementation(async function* () {
            yield { _id: stale, path: stale };
            waiting.resolve();
            await resume.promise;
        });
        const scan = fixture.configSync.scanAllConfigFiles(false);
        try {
            await waiting.promise;
            Object.assign(fixture.configSync.core.settings.pluginSyncExtendedSetting, {
                "CONFIG/stale.json": { key: "CONFIG/stale.json", mode: MODE_AUTOMATIC, files: [] },
            });
        } finally {
            resume.resolve();
            await scan;
        }

        expect(fixture.deleteConfigOnDatabase).not.toHaveBeenCalled();
    });

    it("finishes database enumeration before dispatching database work", async () => {
        const fixture = setup();
        const enumerationPaused = promiseWithResolvers<void>();
        const continueEnumeration = promiseWithResolvers<void>();
        fixture.findEntries.mockImplementation(async function* () {
            yield row("stale");
            enumerationPaused.resolve();
            await continueEnumeration.promise;
        });

        const scan = fixture.configSync.scanAllConfigFiles(false);
        try {
            await enumerationPaused.promise;
            expect(fixture.deleteConfigOnDatabase).not.toHaveBeenCalled();
            expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
        } finally {
            continueEnumeration.resolve();
            await scan;
        }

        expect(fixture.deleteConfigOnDatabase).toHaveBeenCalledExactlyOnceWith(keyOf("stale"));
    });

    it("limits actual database operations to ten and completes that batch before the extra batch", async () => {
        const fixture = setup(
            ["extra"],
            Array.from({ length: 11 }, (_, index) => row(String(index)))
        );
        const gates = Array.from({ length: 11 }, () => promiseWithResolvers<void>());
        const tenStarted = promiseWithResolvers<void>();
        const lastStarted = promiseWithResolvers<void>();
        let active = 0;
        let maximum = 0;
        let started = 0;
        fixture.deleteConfigOnDatabase.mockImplementation(async (key) => {
            const index = Number(key.slice(prefix.length));
            active++;
            maximum = Math.max(maximum, active);
            started++;
            if (started === 10) tenStarted.resolve();
            if (index === 10) lastStarted.resolve();
            try {
                await gates[index].promise;
            } finally {
                active--;
            }
        });
        const scan = fixture.configSync.scanAllConfigFiles(false);
        try {
            await tenStarted.promise;
            expect(active).toBe(10);
            expect(started).toBe(10);
            expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
            gates[0].resolve();
            await lastStarted.promise;
            expect(active).toBe(10);
            expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
        } finally {
            gates.forEach((gate) => gate.resolve());
            await scan;
        }
        expect(maximum).toBe(10);
        expect(active).toBe(0);
        expect(fixture.deleteConfigOnDatabase).toHaveBeenCalledTimes(11);
        expect(fixture.storeCustomisationFileV2).toHaveBeenCalledExactlyOnceWith("extra", term);
    });

    it("logs a database processing error and continues through the extra batch", async () => {
        const fixture = setup(["extra"], [row("bad"), row("other")]);
        const error = new Error("delete");
        fixture.deleteConfigOnDatabase.mockRejectedValueOnce(error);
        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.deleteConfigOnDatabase).toHaveBeenCalledTimes(2);
        expect(fixture.log).toHaveBeenCalledWith(`scanAllConfigFiles - Error: ${keyOf("bad")}`, LOG_LEVEL_VERBOSE);
        expect(fixture.log).toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE);
        expect(fixture.storeCustomisationFileV2).toHaveBeenCalledExactlyOnceWith("extra", term);
        expect(fixture.updatePluginList).toHaveBeenCalledOnce();
    });

    it("retains a matched local file for the extra batch when its first store fails", async () => {
        const fixture = setup(["matched"], [row("matched")]);
        const error = new Error("first store");
        fixture.storeCustomisationFileV2.mockRejectedValueOnce(error);
        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.storeCustomisationFileV2.mock.calls).toEqual([
            ["matched", term],
            ["matched", term],
        ]);
        expect(fixture.log).toHaveBeenCalledWith(`scanAllConfigFiles - Error: ${keyOf("matched")}`, LOG_LEVEL_VERBOSE);
        expect(fixture.log).toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE);
        expect(fixture.events).toEqual(["store:matched"]);
        expect(fixture.updatePluginList).toHaveBeenCalledOnce();
    });

    it("logs an extra-file processing error and continues with the remaining files", async () => {
        const fixture = setup(["bad", "other"]);
        const error = new Error("store");
        fixture.storeCustomisationFileV2.mockRejectedValueOnce(error);
        await fixture.configSync.scanAllConfigFiles(false);

        expect(fixture.storeCustomisationFileV2.mock.calls).toEqual([
            ["bad", term],
            ["other", term],
        ]);
        expect(fixture.log).toHaveBeenCalledWith("scanAllConfigFiles - Error: bad", LOG_LEVEL_VERBOSE);
        expect(fixture.log).toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE);
        expect(fixture.updatePluginList).toHaveBeenCalledOnce();
    });
});

describe("ConfigSync scoped iteration composition", () => {
    it("uses bounded child scopes for both batches with the same shared values", async () => {
        const fixture = setup(["matched", "extra"], [row("matched"), row("stale")]);
        await fixture.configSync.scanAllConfigFiles(false);

        expect(iterationModule.forEachInScope).toHaveBeenCalledTimes(2);
        const [database, extra] = vi.mocked(iterationModule.forEachInScope).mock.calls;
        expect(database[0]).toBe(extra[0]);
        expect(database[0].value).toEqual({ term, localFileMap: new Map([[keyOf("extra"), "extra"]]) });
        expect(database[2]).toEqual({ concurrency: 10 });
        expect(extra[2]).toEqual({ concurrency: 10 });
        expect(fixture.events).toEqual(["store:matched", `delete:${keyOf("stale")}`, "store:extra"]);
    });

    it.each(["database", "extra"])("propagates a %s runner failure outside per-item recovery", async (batch) => {
        const fixture = setup(["extra"], [row("stale")]);
        const error = new Error("iteration");
        const actual = await vi.importActual<typeof import("octagonal-wheels/concurrency/scoped.iteration")>(
            "octagonal-wheels/concurrency/scoped.iteration"
        );
        if (batch === "extra") {
            vi.mocked(iterationModule.forEachInScope).mockImplementationOnce(actual.forEachInScope);
        }
        vi.mocked(iterationModule.forEachInScope).mockRejectedValueOnce(error);
        await expect(fixture.configSync.scanAllConfigFiles(false)).rejects.toBe(error);

        expect(fixture.deleteConfigOnDatabase).toHaveBeenCalledTimes(batch === "extra" ? 1 : 0);
        expect(fixture.storeCustomisationFileV2).not.toHaveBeenCalled();
        expect(fixture.log).not.toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE);
        expect(fixture.updatePluginList).not.toHaveBeenCalled();
    });
});
