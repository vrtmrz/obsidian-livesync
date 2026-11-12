import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { parseFilePath } from "@vrtmrz/livesync-commonlib/storage";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { toVaultRelativePath, type CLIPathFilterOptions } from "@/apps/cli/cliPathFilter";
import { StorageEventManagerCLI } from "@/apps/cli/managers/StorageEventManagerCLI";
import type { NodeFile, NodeFolder } from "@/apps/cli/adapters/NodeTypes";
import { IgnoreRules } from "./IgnoreRules";
import { initialiseServiceModulesCLI } from "./CLIServiceModules";

type StorageEventDeliveryObserver = {
    watchVaultCreate(file: NodeFile | NodeFolder): void;
};

function lifecycleEvent() {
    const handlers: Array<() => Promise<boolean>> = [];
    return {
        addHandler: (handler: () => Promise<boolean>) => handlers.push(handler),
        async run() {
            for (const handler of handlers) {
                await handler();
            }
        },
    };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        await cleanup();
    }
    vi.restoreAllMocks();
});

async function composition(options: (root: string) => CLIPathFilterOptions = () => ({})) {
    const fixture = await mkdtemp(join(tmpdir(), "livesync-shared-watch-policy-"));
    const root = join(fixture, ".parent", ".vault");
    await mkdir(root, { recursive: true });
    cleanups.push(() => rm(fixture, { recursive: true, force: true }));
    await mkdir(join(root, ".livesync"));
    await writeFile(join(root, ".livesync", "ignore"), "REPORT.MD\nprivate/\n");
    const ignoreRules = new IgnoreRules(root);
    await ignoreRules.load();
    const settings = { ...DEFAULT_SETTINGS, pathNormalizationVersion: 0, handleFilenameCaseSensitive: false };
    const appLifecycle = {
        onLoaded: lifecycleEvent(),
        onFirstInitialise: lifecycleEvent(),
        onBeforeUnload: lifecycleEvent(),
        onUnload: lifecycleEvent(),
    };
    const unusedEvent = { addHandler: vi.fn() };
    const services = {
        context: { databasePath: join(fixture, "db"), events: {} },
        API: { addLog: vi.fn() },
        setting: { currentSettings: () => settings, suspendAllSync: unusedEvent },
        vault: { isStorageInsensitive: () => false, getVaultName: () => "test-vault" },
        fileProcessing: { commitPendingFileEvents: unusedEvent, processFileEvent: unusedEvent },
        appLifecycle,
        database: { onDatabaseReset: unusedEvent },
        replication: { processSynchroniseResult: unusedEvent },
        keyValueDB: { openSimpleStore: () => ({}) },
        path: {},
    } as unknown as InjectableServiceHub<ServiceContext>;
    const created: string[] = [];
    // Observe the inherited protected callback at the Node delivery boundary.
    const delivery = StorageEventManagerCLI.prototype as unknown as StorageEventDeliveryObserver;
    vi.spyOn(delivery, "watchVaultCreate").mockImplementation((file) => {
        created.push(file.path);
    });
    const modules = initialiseServiceModulesCLI(
        root,
        { services } as LiveSyncBaseCore<ServiceContext, never>,
        services,
        ignoreRules,
        true,
        options(root)
    );
    cleanups.unshift(() => appLifecycle.onUnload.run());
    return {
        root,
        modules,
        created,
        async start() {
            await appLifecycle.onLoaded.run();
            await modules.storageAccess.restoreState();
            await appLifecycle.onFirstInitialise.run();
        },
    };
}

async function createFiles(root: string, paths: readonly string[]) {
    for (const path of paths) {
        const target = join(root, path);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, path);
    }
}

describe("CLI shared watcher policy composition", () => {
    it("delivers opted-in ordinary database-like directories through the shared source", async () => {
        const { root, start, created } = await composition(() => ({ includeDbLikeDirs: true }));
        await start();
        await createFiles(root, ["archive-livesync-v2/note.md", "archive-livesync-v2-mrview-user/note.md"]);
        await expect
            .poll(() => created, { timeout: 5_000 })
            .toEqual(
                expect.arrayContaining(["archive-livesync-v2/note.md", "archive-livesync-v2-mrview-user/note.md"])
            );
    }, 15_000);

    it.each(["", "state"])(
        "protects configured database entries at '%s' while retaining ignored names as collision candidates",
        async (databaseRoot) => {
            const { root, start, created, modules } = await composition((root) => ({
                includeDbLikeDirs: true,
                databaseRoot: toVaultRelativePath(root, join(root, databaseRoot)),
            }));
            const prefix = databaseRoot === "" ? "" : databaseRoot + "/";
            const protectedPaths = [
                prefix + "current-livesync-v2/CURRENT",
                prefix + "previous-livesync-v2/CURRENT",
                prefix + "current-livesync-v2-mrview-index/CURRENT",
            ];
            for (const path of protectedPaths) {
                await mkdir(join(root, path, ".."), { recursive: true });
            }
            await start();
            await createFiles(root, [
                ...protectedPaths,
                "report.md",
                "REPORT.MD",
                "private/note.md",
                ".hidden.md",
                "visible.md",
            ]);
            await expect.poll(() => created, { timeout: 5_000 }).toContain("visible.md");
            await delay(700);
            expect(created.filter((path) => path.endsWith("/CURRENT"))).toEqual([]);
            expect(created).not.toContain("REPORT.MD");
            expect(created).not.toContain("private/note.md");
            expect(created).not.toContain(".hidden.md");
            expect(await modules.storageAccess.getFileNames({ fresh: true })).toEqual(
                expect.arrayContaining([...protectedPaths, "report.md", "REPORT.MD", "private/note.md", ".hidden.md"])
            );
            const candidates = await modules.storageAccess.findPathIdentityCandidates(parseFilePath("report.md"), {
                pathNormalizationVersion: 0,
                handleFilenameCaseSensitive: false,
            });
            expect([...candidates].sort()).toEqual(["REPORT.MD", "report.md"]);
        }
    );

    it("excludes PouchDB view-directory names by default without narrowing name coverage", async () => {
        const { root, start, created, modules } = await composition();
        await start();
        const viewPath = "archive-livesync-v2-mrview-index/CURRENT";
        await createFiles(root, [viewPath, "visible.md"]);
        await expect.poll(() => created, { timeout: 5_000 }).toContain("visible.md");
        await delay(700);
        expect(created).not.toContain(viewPath);
        expect(await modules.storageAccess.getFileNames({ fresh: true })).toContain(viewPath);
    });
});
