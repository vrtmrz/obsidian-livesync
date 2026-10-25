import { afterEach, describe, expect, it, vi } from "vitest";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({ JsonResolveModal: class JsonResolveModal {} }));
vi.mock("@/modules/features/ModuleLog.ts", () => ({ MARK_DONE: "" }));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({ configureHiddenFileSyncMode: vi.fn() }));

import type { FilePath, UXStat } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { readContent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { HiddenFileSync } from "./CmdHiddenFileSync";
import { createOptionalFileSyncDatabase, optionalFileEntry } from "../../../test/fixtures/optionalFileSyncDatabase";

const path = ".obsidian/plugins/example/main.js" as FilePath;
const content = "module.exports = class ExamplePlugin {};";
const fixtureOwners: Awaited<ReturnType<typeof createOptionalFileSyncDatabase>>[] = [];

async function getText(entry: Parameters<typeof readContent>[0]) {
    const value = await readContent(entry);
    return typeof value === "string" ? value : new TextDecoder().decode(value);
}

async function createHiddenFileSync() {
    const fixture = await createOptionalFileSyncDatabase();
    fixtureOwners.push(fixture);
    fixture.settings.usePluginSync = false;
    fixture.settings.syncInternalFilesTargetPatterns = "" as typeof fixture.settings.syncInternalFilesTargetPatterns;
    fixture.settings.syncInternalFilesIgnorePatterns = "" as typeof fixture.settings.syncInternalFilesIgnorePatterns;
    let fileContent = content;
    let stat: UXStat | null = {
        ctime: 1_000,
        mtime: 2_000,
        size: fileContent.length,
        type: "file",
    };
    const values = new Map<string, unknown>();
    const kvDB = {
        get: vi.fn(async <T>(key: string) => values.get(key) as T | undefined),
        set: vi.fn(async <T>(key: string, value: T) => {
            values.set(key, value);
        }),
    };
    const storageAccess = {
        statHidden: vi.fn(async () => stat),
        readHiddenFileAuto: vi.fn(async () => fileContent),
        writeHiddenFileAuto: vi.fn(async () => undefined),
        removeHidden: vi.fn(async () => true),
        isExistsIncludeHidden: vi.fn(async () => true),
        ensureDir: vi.fn(async () => undefined),
        triggerHiddenFile: vi.fn(async () => undefined),
        setFile(nextContent: string | null, mtime = 2_000) {
            fileContent = nextContent ?? "";
            stat = nextContent === null ? null : { ctime: 1_000, mtime, size: fileContent.length, type: "file" };
        },
    };
    const databaseService = { isDatabaseReady: vi.fn(() => true) };
    const appLifecycle = { isReady: vi.fn(() => false), isSuspended: vi.fn(() => true) };
    const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
    Object.assign(hiddenFileSync, {
        core: {
            settings: fixture.settings,
            localDatabase: fixture.localDatabase,
            kvDB,
            storageAccess,
            services: {
                ...fixture.services,
                database: databaseService,
                appLifecycle,
                path: {
                    ...fixture.services.path,
                    markChangesAreSame: vi.fn(),
                    unmarkChanges: vi.fn(),
                },
                vault: { isIgnoredByIgnoreFile: vi.fn(async () => false) },
            },
        },
        cacheFileRegExps: new Map(),
        cacheCustomisationSyncIgnoredFiles: new Map(),
        _fileInfoLastProcessed: new Map(),
        _databaseInfoLastProcessed: new Map(),
        _fileInfoLastKnown: new Map(),
        semaphore: Semaphore(10),
        _log: vi.fn(),
    });
    return { fixture, hiddenFileSync, storageAccess, kvDB, databaseService, appLifecycle };
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const fixture of fixtureOwners.splice(0)) await fixture.dispose();
});

describe("Hidden File Sync optional save outcomes", () => {
    it("retries a failed database write when the storage fingerprint is unchanged", async () => {
        const { fixture, hiddenFileSync } = await createHiddenFileSync();
        await expect(hiddenFileSync.isTargetFile(path)).resolves.toBe(true);
        vi.spyOn(fixture.localDatabase, "putDBEntry").mockRejectedValueOnce(new Error("temporary database failure"));

        await expect(hiddenFileSync.trackStorageFileModification(path)).resolves.toBe(false);
        await expect(hiddenFileSync.trackStorageFileModification(path)).resolves.toBe(true);

        expect(fixture.localDatabase.putDBEntry).toHaveBeenCalledTimes(2);
        const saved = await fixture.localDatabase.getDBEntry(`i:${path}` as FilePath);
        expect(saved).not.toBe(false);
    });

    it("rejects a failed strict write and retries the same fingerprint without delaying readiness", async () => {
        const { fixture, hiddenFileSync, appLifecycle } = await createHiddenFileSync();
        const putDBEntry = vi
            .spyOn(fixture.localDatabase, "putDBEntry")
            .mockRejectedValueOnce(new Error("temporary database failure"));

        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).rejects.toThrow(
            "temporary database failure"
        );
        expect(hiddenFileSync.getLastProcessedFileKey(path)).toBeUndefined();

        await expect(
            hiddenFileSync._processOptionalFileEventWithResult(path, {
                whenFlushRequested: new Promise<void>(() => undefined),
            })
        ).resolves.toMatchObject({
            kind: "completed",
        });
        expect(putDBEntry).toHaveBeenCalledTimes(2);
        const saved = await fixture.localDatabase.getDBEntry(`i:${path}` as FilePath);
        expect(saved).not.toBe(false);
        if (saved) expect(await getText(saved)).toBe(content);
        expect(appLifecycle.isReady()).toBe(false);
        expect(appLifecycle.isSuspended()).toBe(true);
    });

    it("rejects a false database-write result and can store a later edit after a same-content event", async () => {
        const { fixture, hiddenFileSync, storageAccess } = await createHiddenFileSync();
        const putDBEntry = vi
            .spyOn(fixture.localDatabase, "putDBEntry")
            .mockImplementationOnce(async () => false as never);

        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).rejects.toThrow(
            `Failed to store hidden file in the database: ${path}`
        );
        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "completed",
        });
        const first = await fixture.localDatabase.getDBEntry(`i:${path}` as FilePath);
        expect(first).not.toBe(false);
        if (first) {
            const firstRevision = first._rev;
            hiddenFileSync._fileInfoLastProcessed.delete(path);
            await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
                kind: "completed",
            });
            const unchanged = await fixture.localDatabase.getDBEntry(`i:${path}` as FilePath);
            expect(unchanged).not.toBe(false);
            if (unchanged) expect(unchanged._rev).toBe(firstRevision);
        }

        storageAccess.setFile("module.exports = class UpdatedExamplePlugin {};", 3_000);
        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "completed",
        });
        const updated = await fixture.localDatabase.getDBEntry(`i:${path}` as FilePath);
        expect(updated).not.toBe(false);
        if (updated) expect(await getText(updated)).toBe("module.exports = class UpdatedExamplePlugin {};");
        expect(putDBEntry).toHaveBeenCalledTimes(3);
    });

    it("vetoes when the physical database is unavailable and ignores disabled or filtered events", async () => {
        const { fixture, hiddenFileSync, databaseService } = await createHiddenFileSync();

        databaseService.isDatabaseReady.mockReturnValue(false);
        await expect(
            hiddenFileSync._processOptionalFileEventWithResult(path, {
                whenFlushRequested: new Promise<void>(() => undefined),
            })
        ).resolves.toMatchObject({ kind: "veto", value: expect.any(String) });
        databaseService.isDatabaseReady.mockReturnValue(true);

        fixture.settings.syncInternalFiles = false;
        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "not-applicable",
        });
        fixture.settings.syncInternalFiles = true;
        fixture.settings.syncInternalFilesTargetPatterns =
            "^\\.obsidian/snippets/" as typeof fixture.settings.syncInternalFilesTargetPatterns;
        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "not-applicable",
        });
    });

    it("treats an absent replayed deletion as complete and leaves cache initialisation intact", async () => {
        const { hiddenFileSync, storageAccess, kvDB } = await createHiddenFileSync();
        storageAccess.setFile(null);

        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "completed",
        });
        expect(hiddenFileSync.getLastProcessedFileKey(path)).toBe("0-0");
        const lifecycle = hiddenFileSync as unknown as {
            _everyOnDatabaseInitialized(showNotice: boolean): Promise<boolean>;
        };
        hiddenFileSync.core.settings.syncInternalFiles = false;
        await lifecycle._everyOnDatabaseInitialized(false);
        expect(kvDB.get).toHaveBeenCalledTimes(3);
        expect(hiddenFileSync.getLastProcessedFileKey(path)).toBe("0-0");
    });

    it("rejects actual deletion failures and completes duplicate deletions without another write", async () => {
        const { fixture, hiddenFileSync, storageAccess } = await createHiddenFileSync();
        await fixture.localDatabase.putDBEntry(optionalFileEntry(`i:${path}`, content));
        storageAccess.setFile(null);
        const putRaw = vi
            .spyOn(fixture.localDatabase, "putRaw")
            .mockRejectedValueOnce(new Error("temporary deletion failure"));

        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).rejects.toThrow(
            "temporary deletion failure"
        );
        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "completed",
        });
        hiddenFileSync.resetLastProcessedFile([path]);
        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "completed",
        });
        expect(putRaw).toHaveBeenCalledTimes(2);
    });

    it("recreates an empty hidden file when its database entry is logically deleted", async () => {
        const { fixture, hiddenFileSync, storageAccess } = await createHiddenFileSync();
        await fixture.localDatabase.putDBEntry(optionalFileEntry(`i:${path}`, ""));
        await expect(hiddenFileSync.deleteInternalFileOnDatabase(path)).resolves.toBe(true);
        const deletedBase = await fixture.localDatabase.getDBEntry(
            `i:${path}` as FilePath,
            undefined,
            false,
            true,
            true
        );
        expect(deletedBase).not.toBe(false);
        if (deletedBase) expect(deletedBase.deleted).toBe(true);
        if (!deletedBase) throw new Error("The logically deleted test entry could not be loaded");
        vi.spyOn(fixture.localDatabase, "getDBEntry").mockResolvedValueOnce(deletedBase);

        storageAccess.setFile("", 4_000);
        const putDBEntry = vi.spyOn(fixture.localDatabase, "putDBEntry");

        await expect(hiddenFileSync._processOptionalFileEventWithResult(path)).resolves.toMatchObject({
            kind: "completed",
        });

        expect(putDBEntry).toHaveBeenCalledTimes(1);
        const recreated = await fixture.localDatabase.getDBEntry(`i:${path}` as FilePath);
        expect(recreated).not.toBe(false);
        if (recreated) {
            expect(recreated.deleted).not.toBe(true);
            expect(await getText(recreated)).toBe("");
        }
    });
});
