import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { InjectableConflictService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableConflictService";
import {
    AUTO_MERGED,
    DEFAULT_SETTINGS,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    MISSING_OR_ERROR,
    NOT_CONFLICTED,
    type FilePath,
    type FilePathWithPrefix,
    type MetaEntry,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_CONFLICT_CANCELLED, EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { NO_INTERACTION } from "@vrtmrz/livesync-commonlib/replication";
import type { IAPIService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import {
    createInstanceLogFunction,
    MARK_LOG_SEPARATOR,
    type LogFunction,
} from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
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
    const unloadHandlers: Array<() => Promise<boolean>> = [];
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
        appLifecycle: {
            isSuspended: vi.fn(() => false),
            onUnload: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    unloadHandlers.push(handler);
                }),
            },
        },
        conflict,
        context,
        database: { localDatabase: { tryAutoMerge } },
        replication: { replicateUnattendedByEvent: vi.fn(async () => ({ status: "completed" as const })) },
        setting: { currentSettings: vi.fn(() => settings) },
        vault: { getActiveFilePath: activeFile },
    };
    const serviceModules = { databaseFileAccess, fileHandler, storageAccess };
    const log = createInstanceLogFunction("SF:ConflictResolution", services.API as unknown as IAPIService);

    if (options.compose !== false) {
        useConflictResolutionFeature({ services, serviceModules, log } as unknown as ConflictResolutionHost);
    }

    return {
        addLog,
        log,
        conflict,
        context,
        databaseFileAccess,
        fileHandler,
        services,
        serviceModules,
        storageAccess,
        tryAutoMerge,
        unload: async () => {
            for (const handler of unloadHandlers) await handler();
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
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
    it("declares a borrowed logger and only the services used by conflict resolution", () => {
        expectTypeOf<keyof ConflictResolutionHost["services"]>().toEqualTypeOf<
            "context" | "appLifecycle" | "conflict" | "database" | "replication" | "setting" | "vault"
        >();
        expectTypeOf<ConflictResolutionHost["log"]>().toEqualTypeOf<LogFunction>();
    });

    it("uses the injected logger for the checker and resolver without an API service", async () => {
        const harness = createHarness({
            compose: false,
            settings: { checkConflictOnlyOnOpen: true },
            activeFile: "active.md" as FilePathWithPrefix,
        });
        const { API, ...services } = harness.services;
        const log = vi.fn<LogFunction>();
        useConflictResolutionFeature({
            services,
            serviceModules: harness.serviceModules,
            log,
        } as unknown as ConflictResolutionHost);
        harness.databaseFileAccess.fetchEntryMeta.mockResolvedValue(false);

        await harness.conflict.queueCheckForIfOpen("other.md" as FilePathWithPrefix);
        await harness.conflict.resolveByNewest("missing.md" as FilePathWithPrefix);

        expect(log).toHaveBeenNthCalledWith(
            1,
            "other.md is conflicted, merging process has been postponed.",
            LOG_LEVEL_NOTICE
        );
        expect(log).toHaveBeenNthCalledWith(2, "Could not get current revision of missing.md");
        expect(API.addLog).not.toHaveBeenCalled();
    });

    it("keeps separately selected loggers isolated when legacy API services are shared", async () => {
        const first = createHarness({ compose: false });
        const second = createHarness({ compose: false });
        const firstLog = vi.fn<LogFunction>();
        const secondLog = vi.fn<LogFunction>();
        const sharedAPI = first.services.API;
        useConflictResolutionFeature({
            services: first.services,
            serviceModules: first.serviceModules,
            log: firstLog,
        } as unknown as ConflictResolutionHost);
        useConflictResolutionFeature({
            services: { ...second.services, API: sharedAPI },
            serviceModules: second.serviceModules,
            log: secondLog,
        } as unknown as ConflictResolutionHost);
        first.databaseFileAccess.fetchEntryMeta.mockResolvedValue(false);
        second.databaseFileAccess.fetchEntryMeta.mockResolvedValue(false);

        await first.conflict.resolveByNewest("first.md" as FilePathWithPrefix);
        await second.conflict.resolveByNewest("second.md" as FilePathWithPrefix);

        expect(firstLog).toHaveBeenCalledExactlyOnceWith("Could not get current revision of first.md");
        expect(secondLog).toHaveBeenCalledExactlyOnceWith("Could not get current revision of second.md");
        expect(sharedAPI.addLog).not.toHaveBeenCalled();
    });

    it("retains the prefix, level, and key selected by the host logger", async () => {
        const harness = createHarness({ compose: false });
        const { API, ...services } = harness.services;
        useConflictResolutionFeature({
            services,
            serviceModules: harness.serviceModules,
            log: harness.log,
        } as unknown as ConflictResolutionHost);

        await harness.conflict.resolveByDeletingRevision("same.md" as FilePathWithPrefix, "1-old", "same");
        await harness.conflict.resolveAllConflictedFilesByNewerOnes();

        expect(API.addLog).toHaveBeenCalledWith(
            `[SF:ConflictResolution]${MARK_LOG_SEPARATOR} same.md has been merged automatically`,
            LOG_LEVEL_INFO,
            ""
        );
        expect(API.addLog).toHaveBeenLastCalledWith("Done!", LOG_LEVEL_NOTICE, "resolveAllConflictedFilesByNewerOnes");
    });

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

    it("deletes the older conflict leaf when matching current content is newer", async () => {
        const harness = createOperationsHarness();
        const path = "same-newer-current.md" as FilePathWithPrefix;
        const leftLeaf = leaf("2-left", "Same content\n", 3000);
        const rightLeaf = leaf("1-right", "Same content\n", 2000);
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: leftLeaf.rev,
            rightRev: rightLeaf.rev,
            leftLeaf,
            rightLeaf,
        });

        const result = await harness.operations.checkConflictAndPerformAutoMerge(path);

        expect(result).toBe(AUTO_MERGED);
        expect(harness.resolveByDeletingRevision).toHaveBeenCalledWith(path, "1-right", "same");
    });

    it.each([
        {
            description: "binary content",
            path: "different.png" as FilePathWithPrefix,
            resolveConflictsByNewerFile: false,
            expectedSubtitle: "binary",
        },
        {
            description: "the newer-file policy",
            path: "different.md" as FilePathWithPrefix,
            resolveConflictsByNewerFile: true,
            expectedSubtitle: "alwaysNewer",
        },
    ])(
        "retains automatic resolution for $description",
        async ({ path, resolveConflictsByNewerFile, expectedSubtitle }) => {
            const harness = createOperationsHarness();
            const leftLeaf = leaf("1-left", "Left content\n", 1000);
            const rightLeaf = leaf("2-right", "Right content\n", 2000);
            harness.tryAutoMerge.mockResolvedValue({
                leftRev: leftLeaf.rev,
                rightRev: rightLeaf.rev,
                leftLeaf,
                rightLeaf,
            });
            const operations = createConflictResolutionOperations({
                ...harness.dependencies,
                currentSettings: () => ({
                    disableMarkdownAutoMerge: false,
                    resolveConflictsByNewerFile,
                    syncAfterMerge: false,
                    showMergeDialogOnlyOnActive: false,
                }),
            });

            const result = await operations.checkConflictAndPerformAutoMerge(path);

            expect(result).toBe(AUTO_MERGED);
            expect(harness.resolveByDeletingRevision).toHaveBeenCalledWith(path, "1-left", expectedSubtitle);
        }
    );

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

    it("returns a safe error and logs when reflecting the resolved revision fails", async () => {
        const harness = createOperationsHarness();
        const path = "failed-reflection.md" as FilePathWithPrefix;
        harness.fileHandler.dbToStorage.mockResolvedValue(false);

        const result = await harness.operations.resolveByDeletingRevision(path, "2-right", "UI Selected");

        expect(result).toBe(MISSING_OR_ERROR);
        expect(harness.fileHandler.dbToStorage).toHaveBeenCalledWith(path, path, true);
        expect(harness.dependencies.log).toHaveBeenCalledWith(
            `Could not write the resolved content to the storage: ${path}`,
            LOG_LEVEL_NOTICE
        );
    });

    it.each([
        ["plugin metadata", "ps:plugin-metadata" as FilePathWithPrefix],
        ["customisation metadata", "ix:customisation-metadata" as FilePathWithPrefix],
    ])("does not reflect %s into the Vault after deleting its revision", async (_description, path) => {
        const harness = createOperationsHarness();

        const result = await harness.operations.resolveByDeletingRevision(path, "2-right", "UI Selected");

        expect(result).toBe(AUTO_MERGED);
        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenCalledWith(path, "2-right");
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

    it("opens a manual merge when the active-only setting matches the current file", async () => {
        const harness = createOperationsHarness();
        const path = "active.md" as FilePathWithPrefix;
        const activePath = "active.md" as FilePath;
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: "2-left",
            rightRev: "2-right",
            leftLeaf: leaf("2-left", "Left\n", 1),
            rightLeaf: leaf("2-right", "Right\n", 2),
        });
        const operations = createConflictResolutionOperations({
            ...harness.dependencies,
            currentSettings: () => ({
                disableMarkdownAutoMerge: false,
                resolveConflictsByNewerFile: false,
                syncAfterMerge: false,
                showMergeDialogOnlyOnActive: true,
            }),
            vault: { getActiveFilePath: () => activePath },
        });

        await operations.resolve(path);

        expect(harness.resolveByUserInteraction).toHaveBeenCalledWith(
            path,
            expect.objectContaining({ left: expect.anything(), right: expect.anything() })
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
            log: harness.log,
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

    it.each([
        ["the active-file gate is disabled", { checkConflictOnlyOnOpen: false }, "other.md" as FilePathWithPrefix],
        ["the requested path is active", { checkConflictOnlyOnOpen: true }, "active.md" as FilePathWithPrefix],
    ])("reaches the resolver when %s", async (_description, settings, activeFile) => {
        const path = "active.md" as FilePathWithPrefix;
        const harness = createHarness({ settings, activeFile });
        harness.tryAutoMerge.mockResolvedValue({ ok: NOT_CONFLICTED });

        await harness.conflict.queueCheckForIfOpen(path);
        await harness.conflict.ensureAllProcessed();

        expect(harness.tryAutoMerge).toHaveBeenCalledOnce();
        expect(harness.tryAutoMerge).toHaveBeenCalledWith(path, true);
    });

    it("replaces an active same-file dialogue when a later check enters the queue", async () => {
        const path = "queued-dialogue-replacement.md" as FilePathWithPrefix;
        const harness = createHarness({ settings: { syncAfterMerge: false } });
        harness.tryAutoMerge.mockResolvedValue({
            rightRev: "2-conflict",
            leftLeaf: leaf("2-current", "Current\n", 2),
            rightLeaf: leaf("2-conflict", "Conflict\n", 3),
        });
        let finishFirst: (() => void) | undefined;
        const resolveByUserInteraction = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        finishFirst = () => resolve(false);
                    })
            )
            .mockResolvedValue(false);
        harness.conflict.resolveByUserInteraction.addHandler(resolveByUserInteraction);
        const subscription = new AbortController();
        harness.context.events.onEvent(
            EVENT_CONFLICT_CANCELLED,
            (filename) => {
                if (filename === path) finishFirst?.();
            },
            { signal: subscription.signal }
        );

        try {
            await harness.conflict.queueCheckFor(path);
            await vi.waitFor(() => expect(resolveByUserInteraction).toHaveBeenCalledOnce());

            await harness.conflict.queueCheckFor(path);

            await vi.waitFor(() => expect(resolveByUserInteraction).toHaveBeenCalledTimes(2));
            await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(true);
            expect(harness.conflict.conflictProcessQueueCount.value).toBe(0);
        } finally {
            subscription.abort();
            finishFirst?.();
            await harness.conflict.ensureAllProcessed();
        }
    });

    it("does not open an outdated dialogue when a later check is queued during inspection", async () => {
        const path = "queued-during-inspection.md" as FilePathWithPrefix;
        const harness = createHarness();
        const manualConflict = {
            rightRev: "2-conflict",
            leftLeaf: leaf("2-current", "Current\n", 2),
            rightLeaf: leaf("2-conflict", "Conflict\n", 3),
        };
        let finishInspection!: (result: typeof manualConflict) => void;
        harness.tryAutoMerge
            .mockImplementationOnce(
                () =>
                    new Promise<typeof manualConflict>((resolve) => {
                        finishInspection = resolve;
                    })
            )
            .mockResolvedValueOnce({ ok: NOT_CONFLICTED });
        const resolveByUserInteraction = vi.fn(async () => false);
        harness.conflict.resolveByUserInteraction.addHandler(resolveByUserInteraction);

        try {
            await harness.conflict.queueCheckFor(path);
            await vi.waitFor(() => expect(harness.tryAutoMerge).toHaveBeenCalledOnce());

            await harness.conflict.queueCheckFor(path);
            finishInspection(manualConflict);
            await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(true);

            expect(resolveByUserInteraction).not.toHaveBeenCalled();
            expect(harness.tryAutoMerge).toHaveBeenCalledTimes(2);
        } finally {
            finishInspection?.(manualConflict);
            await harness.conflict.ensureAllProcessed();
        }
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

    it("continues checking accepted and later paths after one resolver rejects", async () => {
        const harness = createHarness();
        const failure = new Error("Conflict check failed");
        const resolve = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
        harness.conflict.resolve.setHandler(resolve, true);
        const first = "failed.md" as FilePathWithPrefix;
        const second = "accepted.md" as FilePathWithPrefix;
        const later = "later.md" as FilePathWithPrefix;

        await Promise.all([harness.conflict.queueCheckFor(first), harness.conflict.queueCheckFor(second)]);
        await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(true);
        await harness.conflict.queueCheckFor(later);
        await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(true);

        expect(resolve.mock.calls.map(([path]) => path)).toEqual([first, second, later]);
        expect(harness.addLog).toHaveBeenCalledWith(
            `[SF:ConflictResolution]${MARK_LOG_SEPARATOR} Conflict check failed: ${first}`,
            LOG_LEVEL_INFO,
            ""
        );
        expect(harness.addLog).toHaveBeenCalledWith(failure, LOG_LEVEL_VERBOSE, "");
        expect(harness.conflict.conflictProcessQueueCount.value).toBe(0);
    });

    it("reports queue cancellation and logs a resolver rejection after unload", async () => {
        const path = "queued-rejection-after-unload.md" as FilePathWithPrefix;
        const harness = createHarness();
        const started = deferred<void>();
        const pendingResolve = deferred<void>();
        const resolve = vi.fn(async () => {
            started.resolve(undefined);
            await pendingResolve.promise;
        });
        harness.conflict.resolve.setHandler(resolve, true);

        await harness.conflict.queueCheckFor(path);
        await started.promise;
        const completion = harness.conflict.ensureAllProcessed().then(
            (result) => ({ status: "resolved" as const, result }),
            (error: unknown) => ({ status: "rejected" as const, error })
        );

        await harness.unload();
        await harness.unload();
        const failure = new Error("Resolver rejected after unload");
        pendingResolve.reject(failure);

        await expect(completion).resolves.toEqual({ status: "resolved", result: false });
        expect(resolve).toHaveBeenCalledOnce();
        expect(harness.addLog).toHaveBeenCalledWith(failure, LOG_LEVEL_VERBOSE, "");
    });

    it("allows an active inspection to complete normally after unload", async () => {
        const path = "not-conflicted-after-unload.md" as FilePathWithPrefix;
        const harness = createHarness();
        const queueCheckFor = vi.spyOn(harness.conflict, "queueCheckFor");
        const started = deferred<void>();
        const pendingMergeCheck = deferred<{ ok: typeof NOT_CONFLICTED }>();
        harness.tryAutoMerge.mockImplementation(async () => {
            started.resolve(undefined);
            return await pendingMergeCheck.promise;
        });
        const emitEvent = vi.spyOn(harness.context.events, "emitEvent");
        const operation = harness.conflict.resolve(path);
        const completion = operation.then(
            () => ({ status: "resolved" as const }),
            (error: unknown) => ({ status: "rejected" as const, error })
        );
        await started.promise;
        expect(harness.tryAutoMerge).toHaveBeenCalledWith(path, true);

        harness.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        pendingMergeCheck.resolve({ ok: NOT_CONFLICTED });

        await expect(completion).resolves.toEqual({ status: "resolved" });
        expect(emitEvent).toHaveBeenCalledWith(EVENT_CONFLICT_CANCELLED, path);
        expect(queueCheckFor).not.toHaveBeenCalled();
        expect(harness.addLog).toHaveBeenCalled();
    });

    it("continues an accepted auto-merge when storage completes after unload", async () => {
        const path = "stored-merge-after-unload.md" as FilePathWithPrefix;
        const harness = createHarness({ settings: { syncAfterMerge: false } });
        const queueCheckFor = vi.spyOn(harness.conflict, "queueCheckFor");
        const started = deferred<void>();
        const pendingStore = deferred<boolean>();
        harness.tryAutoMerge.mockResolvedValue({ result: "Merged content\n", conflictedRev: "2-conflict" });
        harness.databaseFileAccess.storeContent.mockImplementation(async () => {
            started.resolve(undefined);
            return await pendingStore.promise;
        });
        const emitEvent = vi.spyOn(harness.context.events, "emitEvent");
        const operation = harness.conflict.resolve(path);
        const completion = operation.then(
            () => ({ status: "resolved" as const }),
            (error: unknown) => ({ status: "rejected" as const, error })
        );
        await started.promise;
        expect(harness.databaseFileAccess.storeContent).toHaveBeenCalledWith(path, "Merged content\n");

        await harness.unload();
        pendingStore.resolve(true);

        await expect(completion).resolves.toEqual({ status: "resolved" });
        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenCalledWith(path, "2-conflict");
        expect(harness.fileHandler.dbToStorage).toHaveBeenCalled();
        expect(queueCheckFor).toHaveBeenCalledWith(path);
        expect(emitEvent).toHaveBeenCalledWith(EVENT_CONFLICT_CANCELLED, path);
        expect(harness.addLog).toHaveBeenCalled();
        await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(false);
    });

    it("reflects a revision deletion which succeeds after the unload event", async () => {
        const path = "deleted-after-unload.md" as FilePathWithPrefix;
        const harness = createHarness();
        const started = deferred<void>();
        const pendingDelete = deferred<boolean>();
        harness.fileHandler.deleteRevisionFromDB.mockImplementation(async () => {
            started.resolve(undefined);
            return await pendingDelete.promise;
        });
        const emitEvent = vi.spyOn(harness.context.events, "emitEvent");
        const operation = harness.conflict.resolveByDeletingRevision(path, "2-conflict", "UI Selected");
        const completion = operation.then(
            (result) => ({ status: "resolved" as const, result }),
            (error: unknown) => ({ status: "rejected" as const, error })
        );
        await started.promise;
        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenCalledWith(path, "2-conflict");

        harness.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        pendingDelete.resolve(true);

        await expect(completion).resolves.toEqual({ status: "resolved", result: AUTO_MERGED });
        expect(harness.databaseFileAccess.getConflictedRevs).toHaveBeenCalledWith(path);
        expect(harness.fileHandler.dbToStorage).toHaveBeenCalledWith(path, path, true);
        expect(emitEvent).toHaveBeenCalledWith(EVENT_CONFLICT_CANCELLED, path);
        expect(harness.addLog).toHaveBeenCalled();
    });

    it("lets active replication finish while rejecting its next conflict check", async () => {
        const path = "replication-after-unload.md" as FilePathWithPrefix;
        const harness = createHarness({ settings: { syncAfterMerge: true } });
        const queueCheckFor = vi.spyOn(harness.conflict, "queueCheckFor");
        const started = deferred<void>();
        const pendingReplication = deferred<{ status: "completed" }>();
        harness.tryAutoMerge.mockResolvedValue({ ok: AUTO_MERGED });
        harness.services.replication.replicateUnattendedByEvent.mockImplementation(async () => {
            started.resolve(undefined);
            return await pendingReplication.promise;
        });
        const operation = harness.conflict.resolve(path);
        const completion = operation.then(
            () => ({ status: "resolved" as const }),
            (error: unknown) => ({ status: "rejected" as const, error })
        );
        await started.promise;
        expect(harness.services.replication.replicateUnattendedByEvent).toHaveBeenCalledWith({
            trigger: "merge",
            interaction: NO_INTERACTION,
        });

        await harness.unload();
        pendingReplication.resolve({ status: "completed" });

        await expect(completion).resolves.toEqual({ status: "resolved" });
        expect(queueCheckFor).toHaveBeenCalledWith(path);
        expect(harness.tryAutoMerge).toHaveBeenCalledOnce();
        await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(false);
        expect(harness.addLog).toHaveBeenCalled();
    });

    it("does not start resolveByNewest when an optional conflict check returns newer after unload", async () => {
        const path = "optional-newer-after-unload.md" as FilePathWithPrefix;
        const harness = createHarness();
        const started = deferred<void>();
        const pendingOptionalCheck = deferred<"newer" | undefined>();
        const optionalCheck = vi.fn(async () => {
            started.resolve(undefined);
            return await pendingOptionalCheck.promise;
        });
        const resolveByNewest = vi.fn(async () => true);
        const unregisterOptionalCheck = harness.conflict.getOptionalConflictCheckMethod.addHandler(optionalCheck);
        harness.conflict.resolveByNewest.setHandler(resolveByNewest, true);
        const operation = harness.conflict.queueCheckFor(path);
        const completion = operation.then(
            () => ({ status: "resolved" as const }),
            (error: unknown) => ({ status: "rejected" as const, error })
        );
        try {
            await started.promise;
            expect(optionalCheck).toHaveBeenCalledWith(path);

            await harness.unload();
            harness.addLog.mockImplementation(() => {
                throw new Error("Handler addLog not assigned");
            });
            pendingOptionalCheck.resolve("newer");

            await expect(completion).resolves.toEqual({ status: "resolved" });
            expect(resolveByNewest).not.toHaveBeenCalled();
            expect(harness.addLog).not.toHaveBeenCalled();
        } finally {
            unregisterOptionalCheck();
        }
    });

    it.each(["lifecycle", "event"] as const)(
        "stops admission and preserves ordinary database failures after %s disposal",
        async (trigger) => {
            const path = "operation-after-unload.md" as FilePathWithPrefix;
            const harness = createHarness();
            const optionalCheck = vi.fn(async () => "newer" as const);
            const unregisterOptionalCheck = harness.conflict.getOptionalConflictCheckMethod.addHandler(optionalCheck);
            const publicOperations = [
                vi.spyOn(harness.conflict, "queueCheckForIfOpen"),
                vi.spyOn(harness.conflict, "queueCheckFor"),
                vi.spyOn(harness.conflict, "resolve"),
                vi.spyOn(harness.conflict, "resolveByDeletingRevision"),
                vi.spyOn(harness.conflict, "resolveByNewest"),
                vi.spyOn(harness.conflict, "resolveAllConflictedFilesByNewerOnes"),
            ];
            const emitEvent = vi.spyOn(harness.context.events, "emitEvent");

            if (trigger === "lifecycle") {
                await harness.unload();
            } else {
                harness.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
            }
            const failure = new Error("database closed");
            harness.tryAutoMerge.mockRejectedValue(failure);
            harness.databaseFileAccess.fetchEntryMeta.mockResolvedValue(false);
            harness.fileHandler.deleteRevisionFromDB.mockResolvedValue(false);

            try {
                const results = await Promise.allSettled([
                    harness.conflict.queueCheckForIfOpen(path),
                    harness.conflict.queueCheckFor(path),
                    harness.conflict.resolve(path),
                    harness.conflict.resolveByDeletingRevision(path, "2-conflict", "UI Selected"),
                    harness.conflict.resolveByNewest(path),
                    harness.conflict.resolveAllConflictedFilesByNewerOnes(),
                ]);

                expect(results).toEqual([
                    { status: "fulfilled", value: undefined },
                    { status: "fulfilled", value: undefined },
                    { status: "rejected", reason: failure },
                    { status: "fulfilled", value: MISSING_OR_ERROR },
                    { status: "fulfilled", value: false },
                    { status: "fulfilled", value: undefined },
                ]);
                await expect(harness.conflict.ensureAllProcessed()).resolves.toBe(false);
                for (const operation of publicOperations) expect(operation).toHaveBeenCalledOnce();
                expect(optionalCheck).not.toHaveBeenCalled();
                expect(harness.tryAutoMerge).toHaveBeenCalledOnce();
                expect(harness.databaseFileAccess.fetchEntryMeta).toHaveBeenCalledOnce();
                expect(harness.databaseFileAccess.getConflictedRevs).not.toHaveBeenCalled();
                expect(harness.databaseFileAccess.storeContent).not.toHaveBeenCalled();
                expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenCalledOnce();
                expect(harness.fileHandler.dbToStorage).not.toHaveBeenCalled();
                expect(harness.storageAccess.getFileNames).toHaveBeenCalledOnce();
                expect(harness.services.replication.replicateUnattendedByEvent).not.toHaveBeenCalled();
                expect(emitEvent).not.toHaveBeenCalledWith(EVENT_CONFLICT_CANCELLED, path);
                expect(harness.addLog).toHaveBeenCalled();
            } finally {
                unregisterOptionalCheck();
            }
        }
    );

    it("cancels unstarted checks after active checks settle during unload", async () => {
        const paths = Array.from({ length: 11 }, (_, index) => `unload-concurrent-${index}.md` as FilePathWithPrefix);
        const harness = createHarness();
        const tenStarted = deferred<void>();
        const releaseResolvers = deferred<void>();
        const resolve = vi.fn(async (_path: FilePathWithPrefix) => {
            if (resolve.mock.calls.length === 10) tenStarted.resolve(undefined);
            await releaseResolvers.promise;
        });
        harness.conflict.resolve.setHandler(resolve, true);

        await Promise.all(paths.map(async (path) => await harness.conflict.queueCheckFor(path)));
        await tenStarted.promise;
        expect(harness.conflict.conflictProcessQueueCount.value).toBe(11);

        const completion = harness.conflict.ensureAllProcessed();
        harness.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        releaseResolvers.resolve(undefined);

        await expect(completion).resolves.toBe(false);
        expect(resolve).toHaveBeenCalledTimes(10);
        expect(harness.conflict.conflictProcessQueueCount.value).toBe(1);
    });

    it("reports an unavailable database when an active bulk scan completes after unload", async () => {
        const path = "bulk-resolution-after-unload.md" as FilePathWithPrefix;
        const harness = createHarness();
        const namesStarted = deferred<void>();
        const pendingNames = deferred<FilePathWithPrefix[]>();
        harness.storageAccess.getFileNames.mockImplementation(async () => {
            namesStarted.resolve(undefined);
            return await pendingNames.promise;
        });

        const operation = harness.conflict.resolveAllConflictedFilesByNewerOnes();
        await namesStarted.promise;
        expect(harness.addLog).toHaveBeenCalled();
        harness.addLog.mockClear();

        await harness.unload();
        harness.databaseFileAccess.fetchEntryMeta.mockResolvedValue(false);
        pendingNames.resolve([path]);

        await expect(operation).resolves.toBeUndefined();
        expect(harness.databaseFileAccess.fetchEntryMeta).toHaveBeenCalledWith(path, undefined, true);
        expect(harness.databaseFileAccess.getConflictedRevs).not.toHaveBeenCalled();
        expect(harness.fileHandler.deleteRevisionFromDB).not.toHaveBeenCalled();
        expect(harness.fileHandler.dbToStorage).not.toHaveBeenCalled();
        expect(
            harness.addLog.mock.calls.some(([message]) => String(message).includes("Could not get current revision"))
        ).toBe(true);
    });

    it("keeps a replacement queue independent of repeated shutdown of the previous queue", async () => {
        const first = createHarness();
        const second = createHarness();
        first.tryAutoMerge.mockResolvedValue({ ok: NOT_CONFLICTED });
        second.tryAutoMerge.mockResolvedValue({ ok: NOT_CONFLICTED });

        first.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        await first.unload();
        await first.unload();
        await first.conflict.queueCheckFor("retired.md" as FilePathWithPrefix);
        await second.conflict.queueCheckFor("active.md" as FilePathWithPrefix);

        await expect(first.conflict.ensureAllProcessed()).resolves.toBe(false);
        await expect(second.conflict.ensureAllProcessed()).resolves.toBe(true);
        expect(first.tryAutoMerge).not.toHaveBeenCalled();
        expect(second.tryAutoMerge).toHaveBeenCalledExactlyOnceWith("active.md", true);
    });

    it("reports a storage failure after shutdown without treating the queue as completed", async () => {
        const harness = createHarness();
        const started = deferred<void>();
        const pendingStore = deferred<boolean>();
        const failure = new Error("database is closed");
        harness.tryAutoMerge.mockResolvedValue({ result: "Merged content", conflictedRev: "2-conflict" });
        harness.databaseFileAccess.storeContent.mockImplementation(() => {
            started.resolve(undefined);
            return pendingStore.promise;
        });

        await harness.conflict.queueCheckFor("closed-database.md" as FilePathWithPrefix);
        await started.promise;
        const completion = harness.conflict.ensureAllProcessed();
        await harness.unload();
        pendingStore.reject(failure);

        await expect(completion).resolves.toBe(false);
        expect(harness.fileHandler.deleteRevisionFromDB).not.toHaveBeenCalled();
        expect(harness.fileHandler.dbToStorage).not.toHaveBeenCalled();
        expect(harness.addLog).toHaveBeenCalledWith(failure, LOG_LEVEL_VERBOSE, "");
    });

    it("drains requeued automatic checks when every resolver slot is occupied", async () => {
        const harness = createHarness({ settings: { syncAfterMerge: false } });
        const paths = Array.from({ length: 10 }, (_, index) => `requeue-${index}.md` as FilePathWithPrefix);
        const firstChecks = new Set<FilePathWithPrefix>();
        const finishers: Array<() => void> = [];
        harness.tryAutoMerge.mockImplementation(async (path: FilePathWithPrefix) => {
            if (firstChecks.has(path)) return { ok: NOT_CONFLICTED };
            firstChecks.add(path);
            await new Promise<void>((resolve) => {
                finishers.push(resolve);
            });
            return { ok: AUTO_MERGED };
        });

        await Promise.all(paths.map((path) => harness.conflict.queueCheckFor(path)));
        await vi.waitFor(() => expect(finishers).toHaveLength(10));
        const completion = harness.conflict.ensureAllProcessed();
        for (const finish of finishers) finish();

        await expect(completion).resolves.toBe(true);
        for (const path of paths) {
            expect(harness.tryAutoMerge.mock.calls.filter(([checked]) => checked === path)).toHaveLength(2);
        }
        expect(harness.conflict.conflictProcessQueueCount.value).toBe(0);
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

    it("preserves revisions and returns a safe error when the current leaf is unreadable", async () => {
        const harness = createOperationsHarness();
        const path = "unreadable-current.md" as FilePathWithPrefix;
        harness.tryAutoMerge.mockResolvedValue({
            leftRev: "3-current",
            rightRev: "2-conflict",
            leftLeaf: false,
            rightLeaf: leaf("2-conflict", "Conflict body\n", 2),
        });

        const result = await harness.operations.checkConflictAndPerformAutoMerge(path);

        expect(result).toBe(MISSING_OR_ERROR);
        expect(harness.fileHandler.deleteRevisionFromDB).not.toHaveBeenCalled();
        expect(harness.fileHandler.dbToStorage).not.toHaveBeenCalled();
        expect(harness.dependencies.log).toHaveBeenCalledWith(
            `could not get current revisions:${path}`,
            LOG_LEVEL_NOTICE
        );
    });

    it("resolves an identical pair, emits cancellation, and rechecks after merging", async () => {
        const path = "independently-created.md" as FilePathWithPrefix;
        const harness = createHarness({ settings: { syncAfterMerge: false } });
        const cancelled: Array<{ filename: FilePathWithPrefix; checks: number }> = [];
        harness.context.events.onEvent(EVENT_CONFLICT_CANCELLED, (filename) => {
            cancelled.push({ filename, checks: harness.tryAutoMerge.mock.calls.length });
        });
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
        // A queued recheck may also cancel its finishing resolver. Keep both
        // merge and final-inspection notifications covered without fixing the count.
        expect(cancelled).toEqual(
            expect.arrayContaining([
                { filename: path, checks: 1 },
                { filename: path, checks: 2 },
            ])
        );
        expect(cancelled.every(({ filename }) => filename === path)).toBe(true);
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

    it.each([
        { description: "no conflicts remain", conflicts: [] as string[], expectedDeletes: [] as string[] },
        {
            description: "conflict metadata is unreadable",
            conflicts: ["2-unreadable"],
            expectedDeletes: ["2-unreadable"],
        },
    ])("handles the case where $description while resolving by newest", async ({ conflicts, expectedDeletes }) => {
        const harness = createOperationsHarness();
        const path = "newest-policy.md" as FilePathWithPrefix;
        harness.databaseFileAccess.fetchEntryMeta.mockImplementation(
            async (_filename: FilePathWithPrefix, revision?: string) =>
                revision === undefined ? metadata(path, "3-current", 1000) : false
        );
        harness.databaseFileAccess.getConflictedRevs.mockResolvedValueOnce(conflicts).mockResolvedValueOnce([]);

        await expect(harness.operations.resolveByNewest(path)).resolves.toBe(true);
        expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenCalledTimes(expectedDeletes.length);
        for (const [index, revision] of expectedDeletes.entries()) {
            expect(harness.fileHandler.deleteRevisionFromDB).toHaveBeenNthCalledWith(index + 1, path, revision);
        }
    });
});
