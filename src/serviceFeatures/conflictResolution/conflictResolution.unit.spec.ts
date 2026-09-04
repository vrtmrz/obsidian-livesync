import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { InjectableConflictService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableConflictService";
import {
    AUTO_MERGED,
    DEFAULT_SETTINGS,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    MISSING_OR_ERROR,
    NOT_CONFLICTED,
    type FilePath,
    type FilePathWithPrefix,
    type MetaEntry,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_CONFLICT_CANCELLED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { NO_INTERACTION } from "@vrtmrz/livesync-commonlib/replication";
import type { ConflictResolutionHost } from "./index";
import { createConflictResolutionOperations, useConflictResolutionFeature } from "./index";
import type { ConflictResolutionOperationsDependencies } from "./operations";

type ConflictLeaf = {
    rev: string;
    data: string;
    ctime: number;
    mtime: number;
    deleted?: boolean;
};

type HarnessOptions = {
    files?: FilePathWithPrefix[];
    settings?: Partial<ObsidianLiveSyncSettings>;
    activeFile?: FilePathWithPrefix;
    compose?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
    const context = createServiceContext();
    const conflict = new InjectableConflictService(context);
    const settings = { ...DEFAULT_SETTINGS, ...options.settings };
    const tryAutoMerge = vi.fn();
    const databaseFileAccess = {
        fetchEntryMeta: vi.fn(),
        getConflictedRevs: vi.fn(async () => [] as string[]),
        storeContent: vi.fn(async () => true),
    };
    const fileHandler = {
        dbToStorage: vi.fn(async () => true),
        deleteRevisionFromDB: vi.fn(async () => true),
    };
    const addLog = vi.fn();
    const storageAccess = {
        getFileNames: vi.fn(async () => options.files ?? []),
    };
    const activeFile = vi.fn(() => options.activeFile);
    const services = {
        API: { addLog },
        appLifecycle: { isSuspended: vi.fn(() => false) },
        conflict,
        context,
        database: { localDatabase: { tryAutoMerge } },
        replication: { replicateUnattendedByEvent: vi.fn(async () => ({ status: "completed" as const })) },
        setting: { currentSettings: vi.fn(() => settings) },
        vault: { getActiveFilePath: activeFile },
    };
    const serviceModules = { databaseFileAccess, fileHandler, storageAccess };

    if (options.compose !== false) {
        useConflictResolutionFeature({ services, serviceModules } as unknown as ConflictResolutionHost);
    }

    return {
        addLog,
        conflict,
        context,
        databaseFileAccess,
        fileHandler,
        services,
        serviceModules,
        storageAccess,
        tryAutoMerge,
    };
}

function leaf(rev: string, data: string, mtime: number): ConflictLeaf {
    return { rev, data, mtime, ctime: mtime, deleted: false };
}

function metadata(path: FilePathWithPrefix, rev: string, mtime: number): MetaEntry {
    return {
        _id: "doc-id",
        _rev: rev,
        path,
        ctime: mtime,
        mtime,
        size: 0,
        children: [],
        type: "plain",
        eden: {},
    } as unknown as MetaEntry;
}

function createOperationsHarness() {
    const events = { emitEvent: vi.fn() };
    const tryAutoMerge = vi.fn();
    const databaseFileAccess = {
        fetchEntryMeta: vi.fn(),
        getConflictedRevs: vi.fn(async () => [] as string[]),
        storeContent: vi.fn(async () => true),
    };
    const fileHandler = {
        dbToStorage: vi.fn(async () => true),
        deleteRevisionFromDB: vi.fn(async () => true),
    };
    const resolveByDeletingRevision = vi.fn(async () => AUTO_MERGED);
    const queueCheckFor = vi.fn(async () => undefined);
    const resolveByUserInteraction = vi.fn(async () => false);
    const replicateUnattendedByEvent = vi.fn(async () => ({ status: "completed" as const }));
    const dependencies = {
        events,
        databaseFileAccess,
        fileHandler,
        localDatabase: () => ({ tryAutoMerge }),
        conflict: { queueCheckFor, resolveByDeletingRevision, resolveByUserInteraction },
        replication: { replicateUnattendedByEvent },
        appLifecycle: { isSuspended: vi.fn(() => false) },
        vault: { getActiveFilePath: vi.fn(() => undefined) },
        storageAccess: { getFileNames: vi.fn(async () => [] as FilePathWithPrefix[]) },
        currentSettings: vi.fn(() => ({
            disableMarkdownAutoMerge: false,
            resolveConflictsByNewerFile: false,
            syncAfterMerge: true,
            showMergeDialogOnlyOnActive: false,
        })),
        log: vi.fn(),
    } as unknown as ConflictResolutionOperationsDependencies;

    return {
        ...dependencies,
        dependencies,
        operations: createConflictResolutionOperations(dependencies),
        events,
        tryAutoMerge,
        databaseFileAccess,
        fileHandler,
        resolveByDeletingRevision,
        resolveByUserInteraction,
        queueCheckFor,
        replicateUnattendedByEvent,
    };
}

describe("conflict resolution serviceFeature", () => {
    it("keeps resolver operations on narrow collaborators and extension seams", async () => {
        const harness = createOperationsHarness();
        const path = "same.md" as FilePathWithPrefix;
        const leftLeaf = leaf("1-left", "Same content\n", 1000);
        const rightLeaf = leaf("1-right", "Same content\n", 2000);
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: leftLeaf.rev,
            rightRev: rightLeaf.rev,
            leftLeaf,
            rightLeaf,
        });

        const result = await harness.operations.checkConflictAndPerformAutoMerge(path);

        expect(result).toBe(AUTO_MERGED);
        expect(harness.resolveByDeletingRevision).toHaveBeenCalledWith(path, "1-left", "same");
        expect(harness.fileHandler.deleteRevisionFromDB).not.toHaveBeenCalled();
    });

    it("acquires the active local database for each resolution attempt", async () => {
        const harness = createOperationsHarness();
        const path = "database-reset.md" as FilePathWithPrefix;
        const firstTryAutoMerge = vi.fn(async () => ({ ok: NOT_CONFLICTED as typeof NOT_CONFLICTED }));
        const replacementTryAutoMerge = vi.fn(async () => ({ ok: NOT_CONFLICTED as typeof NOT_CONFLICTED }));
        let activeDatabase = { tryAutoMerge: firstTryAutoMerge };
        const dependencies = {
            ...harness.dependencies,
            localDatabase: () => activeDatabase,
        };
        const operations = createConflictResolutionOperations(dependencies);

        await operations.checkConflictAndPerformAutoMerge(path);
        activeDatabase = { tryAutoMerge: replacementTryAutoMerge };
        await operations.checkConflictAndPerformAutoMerge(path);

        expect(firstTryAutoMerge).toHaveBeenCalledOnce();
        expect(replacementTryAutoMerge).toHaveBeenCalledOnce();
    });

    it("returns a manual diff for independently created files with different content", async () => {
        const harness = createOperationsHarness();
        const path = "independently-created.md" as FilePathWithPrefix;
        const leftLeaf = leaf("1-left", "Left content\n", 1000);
        const rightLeaf = leaf("1-right", "Right content\n", 2000);
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: leftLeaf.rev,
            rightRev: rightLeaf.rev,
            leftLeaf,
            rightLeaf,
        });

        const result = await harness.operations.checkConflictAndPerformAutoMerge(path);

        expect(result).toMatchObject({ left: leftLeaf, right: rightLeaf });
        expect(result).toHaveProperty("diff");
        expect(harness.resolveByDeletingRevision).not.toHaveBeenCalled();
    });

    it("stores a sensible merge before resolving its conflict leaf", async () => {
        const harness = createOperationsHarness();
        const path = "sensible.md" as FilePathWithPrefix;
        harness.tryAutoMerge.mockResolvedValue({
            result: "Title\nLeft changed\nRight changed\n",
            conflictedRev: "2-right",
        });

        const result = await harness.operations.checkConflictAndPerformAutoMerge(path);

        expect(result).toBe(AUTO_MERGED);
        expect(harness.databaseFileAccess.storeContent).toHaveBeenCalledWith(
            path,
            "Title\nLeft changed\nRight changed\n"
        );
        expect(harness.resolveByDeletingRevision).toHaveBeenCalledWith(path, "2-right", "Sensible");
    });

    it("keeps the conflict leaf when sensible merged content cannot be stored", async () => {
        const harness = createOperationsHarness();
        const path = "failed-sensible.md" as FilePathWithPrefix;
        harness.tryAutoMerge.mockResolvedValue({
            result: "Merged content\n",
            conflictedRev: "2-right",
        });
        harness.databaseFileAccess.storeContent.mockResolvedValue(false);

        const result = await harness.operations.checkConflictAndPerformAutoMerge(path);

        expect(result).toBe(MISSING_OR_ERROR);
        expect(harness.resolveByDeletingRevision).not.toHaveBeenCalled();
    });

    it("stops before emitting or reflecting when conflict revision deletion fails", async () => {
        const harness = createOperationsHarness();
        const path = "failed-delete.md" as FilePathWithPrefix;
        harness.fileHandler.deleteRevisionFromDB.mockResolvedValue(false);

        const result = await harness.operations.resolveByDeletingRevision(path, "2-right", "UI Selected");

        expect(result).toBe(MISSING_OR_ERROR);
        expect(harness.events.emitEvent).not.toHaveBeenCalled();
        expect(harness.fileHandler.dbToStorage).not.toHaveBeenCalled();
    });

    it("rechecks a remaining manual pair after committing a sensible merge", async () => {
        const harness = createOperationsHarness();
        const path = "three-versions.md" as FilePathWithPrefix;
        const remainingManualPair = {
            leftRev: "3-merged",
            rightRev: "2-third",
            leftLeaf: leaf("3-merged", "Merged\n", 3),
            rightLeaf: leaf("2-third", "Overlapping\n", 2),
        };
        harness.tryAutoMerge
            .mockResolvedValueOnce({
                result: "Merged\n",
                conflictedRev: "2-second",
            })
            .mockResolvedValueOnce(remainingManualPair);

        await harness.operations.resolve(path);

        expect(harness.databaseFileAccess.storeContent).toHaveBeenCalledWith(path, "Merged\n");
        expect(harness.resolveByDeletingRevision).toHaveBeenCalledWith(path, "2-second", "Sensible");
        expect(harness.queueCheckFor).toHaveBeenCalledWith(path);
        expect(harness.resolveByUserInteraction).not.toHaveBeenCalled();

        await harness.operations.resolve(path);

        expect(harness.tryAutoMerge).toHaveBeenCalledTimes(2);
        expect(harness.resolveByUserInteraction).toHaveBeenCalledWith(
            path,
            expect.objectContaining({
                left: remainingManualPair.leftLeaf,
                right: remainingManualPair.rightLeaf,
            })
        );
    });

    it("requeues and replicates through collaborators after an automatic merge", async () => {
        const harness = createOperationsHarness();
        const path = "merged.md" as FilePathWithPrefix;
        harness.tryAutoMerge.mockResolvedValue({ ok: AUTO_MERGED });

        await harness.operations.resolve(path);

        expect(harness.replicateUnattendedByEvent).toHaveBeenCalledWith({
            trigger: "merge",
            interaction: NO_INTERACTION,
        });
        expect(harness.queueCheckFor).toHaveBeenCalledWith(path);
    });

    it("postpones a manual merge until its file is active when configured", async () => {
        const harness = createOperationsHarness();
        const path = "inactive.md" as FilePathWithPrefix;
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: "2-left",
            rightRev: "2-right",
            leftLeaf: leaf("2-left", "Left\n", 1),
            rightLeaf: leaf("2-right", "Right\n", 2),
        });
        const dependencies = {
            ...harness.dependencies,
            currentSettings: () => ({
                disableMarkdownAutoMerge: false,
                resolveConflictsByNewerFile: false,
                syncAfterMerge: false,
                showMergeDialogOnlyOnActive: true,
            }),
            vault: { getActiveFilePath: () => "other.md" as FilePath },
        };
        const operations = createConflictResolutionOperations(dependencies);

        await operations.resolve(path);

        expect(harness.resolveByUserInteraction).not.toHaveBeenCalled();
        expect(dependencies.log).toHaveBeenCalledWith(
            expect.stringContaining("Merging process has been postponed"),
            LOG_LEVEL_NOTICE
        );
    });

    it("cancels an active same-file dialogue before serialising a repeated resolution", async () => {
        const harness = createOperationsHarness();
        const path = "repeated.md" as FilePathWithPrefix;
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: "2-left",
            rightRev: "2-right",
            leftLeaf: leaf("2-left", "Left\n", 1),
            rightLeaf: leaf("2-right", "Right\n", 2),
        });
        let finishDialogue: ((result: boolean) => void) | undefined;
        harness.resolveByUserInteraction.mockImplementation(
            async () => await new Promise<boolean>((resolve) => (finishDialogue = resolve))
        );
        harness.events.emitEvent.mockImplementation((event, filename) => {
            if (event === EVENT_CONFLICT_CANCELLED && filename === path && finishDialogue) {
                const finish = finishDialogue;
                finishDialogue = undefined;
                finish(false);
            }
        });

        const first = harness.operations.resolve(path);
        await vi.waitFor(() => expect(harness.resolveByUserInteraction).toHaveBeenCalledOnce());
        const replacement = harness.operations.resolve(path);

        await vi.waitFor(() => expect(harness.resolveByUserInteraction).toHaveBeenCalledTimes(2));
        expect(harness.events.emitEvent).toHaveBeenCalledWith(EVENT_CONFLICT_CANCELLED, path);

        finishDialogue?.(false);
        await Promise.all([first, replacement]);
    });

    it("passes only the newest waiting same-file resolution to the interactive resolver", async () => {
        const harness = createOperationsHarness();
        const path = "repeated-three-times.md" as FilePathWithPrefix;
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: "2-left",
            rightRev: "2-right",
            leftLeaf: leaf("2-left", "Left\n", 1),
            rightLeaf: leaf("2-right", "Right\n", 2),
        });
        let finishFirstDialogue: ((result: boolean) => void) | undefined;
        harness.resolveByUserInteraction
            .mockImplementationOnce(
                async () => await new Promise<boolean>((resolve) => (finishFirstDialogue = resolve))
            )
            .mockResolvedValue(false);
        harness.events.emitEvent.mockImplementation((event, filename) => {
            if (event === EVENT_CONFLICT_CANCELLED && filename === path && finishFirstDialogue) {
                const finish = finishFirstDialogue;
                finishFirstDialogue = undefined;
                finish(false);
            }
        });

        const first = harness.operations.resolve(path);
        await vi.waitFor(() => expect(harness.resolveByUserInteraction).toHaveBeenCalledOnce());
        const superseded = harness.operations.resolve(path);
        const replacement = harness.operations.resolve(path);

        await Promise.all([first, superseded, replacement]);

        expect(harness.resolveByUserInteraction).toHaveBeenCalledTimes(2);
    });

    it("does not open a superseded dialogue after conflict inspection completes", async () => {
        const harness = createOperationsHarness();
        const path = "superseded-during-inspection.md" as FilePathWithPrefix;
        const manualConflict = {
            leftRev: "2-left",
            rightRev: "2-right",
            leftLeaf: leaf("2-left", "Left\n", 1),
            rightLeaf: leaf("2-right", "Right\n", 2),
        };
        let finishFirstInspection!: (result: typeof manualConflict) => void;
        harness.tryAutoMerge
            .mockImplementationOnce(
                async () => await new Promise<typeof manualConflict>((resolve) => (finishFirstInspection = resolve))
            )
            .mockResolvedValue(manualConflict);
        harness.resolveByUserInteraction.mockResolvedValue(false);

        const superseded = harness.operations.resolve(path);
        await vi.waitFor(() => expect(harness.tryAutoMerge).toHaveBeenCalledOnce());
        const replacement = harness.operations.resolve(path);
        finishFirstInspection(manualConflict);

        await Promise.all([superseded, replacement]);

        expect(harness.resolveByUserInteraction).toHaveBeenCalledOnce();
    });

    it("registers all conflict service operations during composition", () => {
        const harness = createHarness({ compose: false });
        const registrations = [
            vi.spyOn(harness.conflict.queueCheckForIfOpen, "setHandler"),
            vi.spyOn(harness.conflict.queueCheckFor, "setHandler"),
            vi.spyOn(harness.conflict.ensureAllProcessed, "setHandler"),
            vi.spyOn(harness.conflict.resolveByDeletingRevision, "setHandler"),
            vi.spyOn(harness.conflict.resolve, "setHandler"),
            vi.spyOn(harness.conflict.resolveByNewest, "setHandler"),
            vi.spyOn(harness.conflict.resolveAllConflictedFilesByNewerOnes, "setHandler"),
        ];

        useConflictResolutionFeature({
            services: harness.services,
            serviceModules: harness.serviceModules,
        } as unknown as ConflictResolutionHost);

        for (const registration of registrations) {
            expect(registration).toHaveBeenCalledOnce();
            expect(registration).toHaveBeenCalledWith(expect.any(Function));
        }
    });

    it("applies the active-file gate and deduplicates pending checks for one path", async () => {
        const path = "postponed.md" as FilePathWithPrefix;
        const harness = createHarness({
            activeFile: "other.md" as FilePathWithPrefix,
            settings: { checkConflictOnlyOnOpen: true },
        });
        harness.tryAutoMerge.mockResolvedValue({ ok: NOT_CONFLICTED });

        await harness.conflict.queueCheckForIfOpen(path);
        expect(harness.tryAutoMerge).not.toHaveBeenCalled();

        harness.services.vault.getActiveFilePath = vi.fn(() => path);
        await Promise.all([harness.conflict.queueCheckFor(path), harness.conflict.queueCheckFor(path)]);
        await harness.conflict.ensureAllProcessed();

        expect(harness.tryAutoMerge).toHaveBeenCalledOnce();
        expect(harness.tryAutoMerge).toHaveBeenCalledWith(path, true);
        expect(harness.addLog).toHaveBeenCalledWith(
            `${path} is conflicted, merging process has been postponed.`,
            LOG_LEVEL_NOTICE,
            ""
        );
    });

    it("limits concurrent conflict checks and reports queued and active work", async () => {
        const paths = Array.from({ length: 11 }, (_, index) => `concurrent-${index}.md` as FilePathWithPrefix);
        const harness = createHarness();
        const finishByPath = new Map<FilePathWithPrefix, () => void>();
        harness.tryAutoMerge.mockImplementation(
            async (path: FilePathWithPrefix) =>
                await new Promise<{ ok: typeof NOT_CONFLICTED }>((resolve) => {
                    finishByPath.set(path, () => resolve({ ok: NOT_CONFLICTED }));
                })
        );

        await Promise.all(paths.map(async (path) => await harness.conflict.queueCheckFor(path)));
        await vi.waitFor(() => expect(harness.tryAutoMerge).toHaveBeenCalledTimes(10));

        expect(harness.conflict.conflictProcessQueueCount.value).toBe(11);
        let allProcessed = false;
        const completion = harness.conflict.ensureAllProcessed().then((result) => {
            allProcessed = true;
            return result;
        });
        await Promise.resolve();
        expect(allProcessed).toBe(false);

        const finishFirst = finishByPath.get(paths[0]);
        finishByPath.delete(paths[0]);
        finishFirst?.();
        await vi.waitFor(() => expect(harness.tryAutoMerge).toHaveBeenCalledTimes(11));
        for (const finish of finishByPath.values()) finish();

        await expect(completion).resolves.toBe(true);
        expect(harness.conflict.conflictProcessQueueCount.value).toBe(0);
    });

    it("replaces an older same-path check while every resolver slot is occupied", async () => {
        const occupiedPaths = Array.from({ length: 10 }, (_, index) => `occupied-${index}.md` as FilePathWithPrefix);
        const repeatedPath = "waiting-replacement.md" as FilePathWithPrefix;
        const harness = createHarness();
        const finishers: Array<{ path: FilePathWithPrefix; finish: () => void }> = [];
        harness.tryAutoMerge.mockImplementation(
            async (path: FilePathWithPrefix) =>
                await new Promise<{ ok: typeof NOT_CONFLICTED }>((resolve) => {
                    finishers.push({ path, finish: () => resolve({ ok: NOT_CONFLICTED }) });
                })
        );

        await Promise.all(occupiedPaths.map(async (path) => await harness.conflict.queueCheckFor(path)));
        await vi.waitFor(() => expect(harness.tryAutoMerge).toHaveBeenCalledTimes(10));

        await harness.conflict.queueCheckFor(repeatedPath);
        await harness.conflict.queueCheckFor(repeatedPath);
        for (const { finish } of finishers.filter(({ path }) => path !== repeatedPath)) finish();

        await vi.waitFor(() => expect(harness.conflict.conflictProcessQueueCount.value).toBe(1));
        expect(harness.tryAutoMerge.mock.calls.filter(([path]) => path === repeatedPath)).toHaveLength(1);

        finishers.find(({ path }) => path === repeatedPath)?.finish();
        await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(true);
    });

    it("waits for a conflict check requeued by an automatic merge", async () => {
        const path = "requeued-automatic-merge.md" as FilePathWithPrefix;
        const harness = createHarness({ settings: { syncAfterMerge: false } });
        let finishFirst!: (result: { ok: typeof AUTO_MERGED }) => void;
        harness.tryAutoMerge
            .mockImplementationOnce(
                async () =>
                    await new Promise<{ ok: typeof AUTO_MERGED }>((resolve) => {
                        finishFirst = resolve;
                    })
            )
            .mockResolvedValueOnce({ ok: NOT_CONFLICTED });

        await harness.conflict.queueCheckFor(path);
        await vi.waitFor(() => expect(harness.tryAutoMerge).toHaveBeenCalledOnce());
        const completion = harness.conflict.ensureAllProcessed();

        finishFirst({ ok: AUTO_MERGED });

        await expect(completion).resolves.toBe(true);
        expect(harness.tryAutoMerge).toHaveBeenCalledTimes(2);
        expect(harness.conflict.conflictProcessQueueCount.value).toBe(0);
    });

    it("drains repeated manual resolutions for a file with more than two conflicting versions", async () => {
        const path = "requeued-manual-merge.md" as FilePathWithPrefix;
        const harness = createHarness({ settings: { syncAfterMerge: false } });
        const firstPair = {
            leftRev: "3-current",
            rightRev: "2-second",
            leftLeaf: leaf("3-current", "Current\n", 3),
            rightLeaf: leaf("2-second", "Second\n", 2),
        };
        const remainingPair = {
            leftRev: "4-merged",
            rightRev: "2-third",
            leftLeaf: leaf("4-merged", "Merged\n", 4),
            rightLeaf: leaf("2-third", "Third\n", 2),
        };
        harness.tryAutoMerge
            .mockResolvedValueOnce(firstPair)
            .mockResolvedValueOnce(remainingPair)
            .mockResolvedValueOnce({ ok: NOT_CONFLICTED });
        const resolvePair = vi.fn(async (filename: FilePathWithPrefix) => {
            await harness.conflict.queueCheckFor(filename);
            return false;
        });
        const unregister = harness.conflict.resolveByUserInteraction.addHandler(resolvePair);

        try {
            await harness.conflict.queueCheckFor(path);

            await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(true);
            expect(harness.tryAutoMerge).toHaveBeenCalledTimes(3);
            expect(resolvePair).toHaveBeenCalledTimes(2);
            expect(harness.conflict.conflictProcessQueueCount.value).toBe(0);
        } finally {
            unregister();
        }
    });

    it("honours optional conflict handlers before entering the check queue", async () => {
        const path = "optional.md" as FilePathWithPrefix;
        const harness = createHarness();
        harness.tryAutoMerge.mockResolvedValue({ ok: NOT_CONFLICTED });

        const unregisterResolved = harness.conflict.getOptionalConflictCheckMethod.addHandler(async () => true);
        await harness.conflict.queueCheckFor(path);
        await harness.conflict.ensureAllProcessed();
        expect(harness.tryAutoMerge).not.toHaveBeenCalled();
        unregisterResolved();

        const unregisterNewer = harness.conflict.getOptionalConflictCheckMethod.addHandler(async () => "newer");
        harness.databaseFileAccess.fetchEntryMeta.mockResolvedValue(false);
        await harness.conflict.queueCheckFor(path);
        expect(harness.databaseFileAccess.fetchEntryMeta).toHaveBeenCalledWith(path, undefined, true);
        unregisterNewer();
    });

    it("keeps unreadable conflict revisions available for explicit repair", async () => {
        const path = "missing-conflict-body.md" as FilePathWithPrefix;
        const harness = createHarness();
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: "3-current",
            rightRev: "2-unreadable",
            leftLeaf: leaf("3-current", "Readable current body\n", 3),
            rightLeaf: false,
        });

        await harness.conflict.resolve(path);

        expect(harness.fileHandler.deleteRevisionFromDB).not.toHaveBeenCalled();
        expect(harness.fileHandler.dbToStorage).not.toHaveBeenCalled();
        expect(harness.addLog).toHaveBeenCalledWith(
            `could not read conflicted revision 2-unreadable:${path}`,
            LOG_LEVEL_NOTICE,
            ""
        );
        expect(MISSING_OR_ERROR).toBeDefined();
    });

    it("resolves an identical pair, emits cancellation, and rechecks after merging", async () => {
        const path = "independently-created.md" as FilePathWithPrefix;
        const harness = createHarness({ settings: { syncAfterMerge: false } });
        const cancelled: FilePathWithPrefix[] = [];
        harness.context.events.onEvent(EVENT_CONFLICT_CANCELLED, (filename) => cancelled.push(filename));
        const leftLeaf = leaf("1-left", "Same content\n", 1000);
        const rightLeaf = leaf("1-right", "Same content\n", 2000);
        harness.tryAutoMerge
            .mockResolvedValueOnce({
                leftRev: leftLeaf.rev,
                rightRev: rightLeaf.rev,
                leftLeaf,
                rightLeaf,
            })
            .mockResolvedValueOnce({ ok: NOT_CONFLICTED });

        await harness.conflict.resolve(path);
        await harness.conflict.ensureAllProcessed();

        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenCalledWith(path, "1-left");
        expect(harness.fileHandler.dbToStorage).toHaveBeenCalledWith(path, path, true);
        expect(cancelled).toEqual([path, path]);
        expect(harness.tryAutoMerge).toHaveBeenCalledTimes(2);
        expect(AUTO_MERGED).toBeDefined();
    });

    it("uses deterministic revision ordering and suppresses notices during bulk resolution", async () => {
        const files = Array.from({ length: 11 }, (_, index) => `note-${index}.md` as FilePathWithPrefix);
        const harness = createHarness({ files });
        harness.databaseFileAccess.fetchEntryMeta.mockImplementation(async (path: FilePathWithPrefix, rev?: string) =>
            metadata(path, rev ?? "2-current", rev ? 1 : 2)
        );
        let conflictInspection = 0;
        harness.databaseFileAccess.getConflictedRevs.mockImplementation(async () =>
            conflictInspection++ % 2 === 0 ? ["1-old"] : []
        );

        await harness.conflict.resolveAllConflictedFilesByNewerOnes();

        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenCalledTimes(11);
        expect(harness.addLog).toHaveBeenCalledWith(
            "Check and Processing 10 / 11",
            LOG_LEVEL_NOTICE,
            "resolveAllConflictedFilesByNewerOnes"
        );
        expect(harness.addLog).toHaveBeenCalledWith(
            expect.stringContaining("has been merged automatically"),
            LOG_LEVEL_INFO,
            ""
        );
    });

    it("uses revision identifiers to break newest-resolution timestamp ties", async () => {
        const harness = createOperationsHarness();
        const path = "same-time.md" as FilePathWithPrefix;
        harness.databaseFileAccess.fetchEntryMeta.mockImplementation(
            async (filename: FilePathWithPrefix, revision?: string) => metadata(filename, revision ?? "2-3", 1000)
        );
        harness.databaseFileAccess.getConflictedRevs
            .mockResolvedValueOnce(["2-10", "2-2"])
            .mockResolvedValueOnce(["2-10"])
            .mockResolvedValueOnce([]);

        await harness.operations.resolveByNewest(path);

        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenNthCalledWith(1, path, "2-3");
        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenNthCalledWith(2, path, "2-10");
        expect(harness.dependencies.log).toHaveBeenLastCalledWith(
            `${path} has been merged automatically`,
            LOG_LEVEL_NOTICE
        );
    });
});
