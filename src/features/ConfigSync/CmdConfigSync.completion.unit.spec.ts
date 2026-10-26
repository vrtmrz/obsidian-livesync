import { afterEach, describe, expect, it, vi } from "vitest";

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
// The readiness helpers come from the real LiveSyncCommands, so only its log view dependency is replaced.
vi.mock("@/modules/features/ModuleLog.ts", () => ({
    MARK_DONE: "",
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
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { getDocData } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { ConfigSync } from "./CmdConfigSync";
import { createOptionalFileSyncDatabase } from "../../../test/fixtures/optionalFileSyncDatabase";

const path = ".obsidian/snippets/test.css" as FilePath;
const fixtures: Awaited<ReturnType<typeof createOptionalFileSyncDatabase>>[] = [];

async function createConfigSync(useV2 = false) {
    const fixture = await createOptionalFileSyncDatabase();
    fixtures.push(fixture);
    fixture.settings.usePluginSyncV2 = useV2;
    const files = new Map<string, { content: string; mtime: number }>([
        [path, { content: "body { color: red; }", mtime: 2000 }],
    ]);
    const storageAccess = {
        statHidden: vi.fn(async (file: string) => {
            const entry = files.get(file);
            return entry
                ? { type: "file" as const, ctime: 1000, mtime: entry.mtime, size: entry.content.length }
                : null;
        }),
        readHiddenFileBinary: vi.fn(async (file: string) => {
            const entry = files.get(file);
            if (!entry) throw new Error(`Missing fixture: ${file}`);
            return new TextEncoder().encode(entry.content).buffer;
        }),
    };
    const services = {
        ...fixture.services,
        appLifecycle: { isReady: () => false, isSuspended: () => true },
        database: { ...fixture.services.database, isDatabaseReady: vi.fn(() => true) },
        path: {
            ...fixture.services.path,
            isMarkedAsSameChanges: vi.fn(),
            markChangesAreSame: vi.fn(),
        },
    };
    const config = Object.create(ConfigSync.prototype) as ConfigSync;
    Object.assign(config, {
        core: { settings: fixture.settings, localDatabase: fixture.localDatabase, storageAccess, services },
        _log: vi.fn(),
        updatePluginList: vi.fn(async () => undefined),
        updatePluginListV2: vi.fn(async () => undefined),
        recentProcessedInternalFiles: [],
    });
    const databasePath = useV2 ? config.filenameWithUnifiedKey(path) : config.filenameToUnifiedKey(path);
    return { fixture, config, files, services, storageAccess, databasePath };
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const fixture of fixtures.splice(0)) await fixture.dispose();
});

describe("Customisation Sync optional save completion", () => {
    const flush = { whenFlushRequested: Promise.resolve() };

    it("waits for the database write while the application is suspended or still starting", async () => {
        const { fixture, config } = await createConfigSync();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const put = fixture.localDatabase.putDBEntry.bind(fixture.localDatabase);
        const spy = vi.spyOn(fixture.localDatabase, "putDBEntry").mockImplementation(async (...args) => {
            await gate;
            return await put(...args);
        });
        let completed = false;
        const result = config._processOptionalFileEventWithResult(path, flush).then((outcome) => {
            completed = true;
            return outcome;
        });
        await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
        expect(completed).toBe(false);
        release();
        await expect(result).resolves.toEqual({ kind: "completed" });
    });

    it.each([false, true])("confirms identical contents and stores a same-time edit (V2: %s)", async (useV2) => {
        const { fixture, config, databasePath, files } = await createConfigSync(useV2);
        await expect(config._processOptionalFileEventWithResult(path, flush)).resolves.toEqual({ kind: "completed" });
        const first = await fixture.database.get(databasePath);
        await config._processOptionalFileEventWithResult(path, flush);
        expect((await fixture.database.get(databasePath))._rev).toBe(first._rev);
        files.get(path)!.content = "body { color: tan; }";
        await config._processOptionalFileEventWithResult(path, flush);
        expect((await fixture.database.get(databasePath))._rev).not.toBe(first._rev);
    });

    it.each([
        { useV2: false, throws: false },
        { useV2: true, throws: false },
        { useV2: false, throws: true },
        { useV2: true, throws: true },
    ])("rejects a failed write and permits the unchanged notification to retry: %j", async ({ useV2, throws }) => {
        const { fixture, config, databasePath } = await createConfigSync(useV2);
        const failure = new Error("temporary write failure");
        const put = vi.spyOn(fixture.localDatabase, "putDBEntry");
        if (throws) put.mockRejectedValueOnce(failure);
        else put.mockResolvedValueOnce(false);
        const failed = config._processOptionalFileEventWithResult(path, flush);
        if (throws) await expect(failed).rejects.toBe(failure);
        else await expect(failed).rejects.toThrow("Could not save customisation");
        await expect(fixture.localDatabase.getDBEntry(databasePath)).resolves.toBe(false);
        await expect(config._processOptionalFileEventWithResult(path, flush)).resolves.toEqual({ kind: "completed" });
        expect(put).toHaveBeenCalledTimes(2);
        expect(await fixture.localDatabase.getDBEntry(databasePath)).not.toBe(false);
    });

    it.each([false, true])("confirms deletion and treats a repeated deletion as complete (V2: %s)", async (useV2) => {
        const { fixture, config, databasePath, files } = await createConfigSync(useV2);
        await config._processOptionalFileEventWithResult(path, flush);
        files.delete(path);
        const put = vi.spyOn(fixture.localDatabase, "putRaw");
        put.mockResolvedValueOnce({ ok: false, id: "failed", rev: "" });
        await expect(config._processOptionalFileEventWithResult(path, flush)).rejects.toThrow(
            "Could not delete customisation"
        );
        await expect(config._processOptionalFileEventWithResult(path, flush)).resolves.toEqual({ kind: "completed" });
        const deleted = await fixture.database.get(databasePath);
        expect("deleted" in deleted && deleted.deleted).toBe(true);
        await expect(config._processOptionalFileEventWithResult(path, flush)).resolves.toEqual({ kind: "completed" });
        expect((await fixture.database.get(databasePath))._rev).toBe(deleted._rev);
    });

    it("distinguishes a different owner and unmet prerequisites", async () => {
        const { config, services, storageAccess } = await createConfigSync();
        await expect(config._processOptionalFileEventWithResult("notes.md" as FilePath, flush)).resolves.toEqual({
            kind: "not-applicable",
        });
        services.database.isDatabaseReady.mockReturnValue(false);
        await expect(config._processOptionalFileEventWithResult(path, flush)).resolves.toEqual({
            kind: "veto",
            value: "database-not-ready",
        });
        services.database.isDatabaseReady.mockReturnValue(true);
        vi.spyOn(services.setting, "getDeviceAndVaultName").mockReturnValue("");
        await expect(config._processOptionalFileEventWithResult(path, flush)).resolves.toEqual({
            kind: "veto",
            value: "device-name-not-configured",
        });
        expect(storageAccess.readHiddenFileBinary).not.toHaveBeenCalled();
    });

    it("preserves every V2 file when neighbouring plug-in files arrive together", async () => {
        const { fixture, config, files } = await createConfigSync(true);
        const main = ".obsidian/plugins/example/main.js" as FilePath;
        const style = ".obsidian/plugins/example/styles.css" as FilePath;
        files.set(main, { content: "module.exports = {};", mtime: 3000 });
        files.set(style, { content: "body {}", mtime: 3000 });
        await Promise.all([
            config._processOptionalFileEventWithResult(main, flush),
            config._processOptionalFileEventWithResult(style, flush),
        ]);
        expect(await fixture.localDatabase.getDBEntry(config.filenameWithUnifiedKey(main))).not.toBe(false);
        expect(await fixture.localDatabase.getDBEntry(config.filenameWithUnifiedKey(style))).not.toBe(false);
    });

    it("does not acknowledge a database deletion which was not accepted", async () => {
        const { fixture, config, databasePath } = await createConfigSync();
        await config.storeCustomizationFiles(path);
        const original = await fixture.localDatabase.getDBEntry(databasePath);
        expect(original).not.toBe(false);
        vi.spyOn(fixture.localDatabase, "putRaw").mockResolvedValueOnce({ ok: false, id: "failed", rev: "" });
        await expect(config.deleteConfigOnDatabase(databasePath)).resolves.toBe(false);
        const unchanged = await fixture.localDatabase.getDBEntry(databasePath);
        expect(unchanged && getDocData(unchanged.data)).toBe(original && getDocData(original.data));
    });
});
