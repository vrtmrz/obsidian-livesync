import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import {
    AUTO_MERGED,
    CANCELLED,
    DEFAULT_SETTINGS,
    LEAVE_TO_SUBSEQUENT,
    MISSING_OR_ERROR,
    type FilePathWithPrefix,
    type diff_result,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_CONFLICT_CANCELLED, EVENT_ON_UNRESOLVED_ERROR, EVENT_PLUGIN_UNLOADED } from "@/common/events";
import {
    createInteractiveConflictResolutionOperations,
    type InteractiveConflictResolutionOperationsDependencies,
} from "./operations";
import { POSTPONED, type ConflictResolveDialogueFactory, type MergeDialogResult } from "./types";
import { useInteractiveConflictResolutionFeature } from "./index";

const path = "note.md" as FilePathWithPrefix;
const conflict: diff_result = {
    left: { rev: "2-left", data: "left", ctime: 1, mtime: 2 },
    right: { rev: "2-right", data: "right", ctime: 1, mtime: 2 },
    diff: [],
};

async function* documents(items: unknown[]) {
    for (const item of items) {
        yield item;
    }
}

function createOperations(conflictedRevisions: string[] = ["2-right"]) {
    const context = createServiceContext();
    let dialogueResult: unknown = POSTPONED;
    const constructed = { value: 0 };
    const getDBEntry = vi.fn(async (): Promise<false | { _rev: string; _conflicts?: string[] }> => false);
    const findAllDocs = vi.fn(() => documents([]));
    const askSelectString = vi.fn(async (): Promise<string> => "");
    const askInPopup = vi.fn();
    const queueCheckFor = vi.fn(async () => undefined);
    const ensureAllProcessed = vi.fn(async () => true);
    const resolveByDeletingRevision = vi.fn(async () => AUTO_MERGED);
    const getConflictedRevs = vi.fn(async () => conflictedRevisions);
    const storeContent = vi.fn(async () => true);
    const isSuspended = vi.fn(() => false);
    const getActiveFilePath = vi.fn((): FilePathWithPrefix | undefined => path);
    const replicateUnattendedByEvent = vi.fn(async () => ({ status: "completed" as const }));
    const currentSettings = vi.fn(() => ({ syncAfterMerge: false }));
    const log = vi.fn();
    const operations = createInteractiveConflictResolutionOperations({
        events: context.events,
        databaseFileAccess: {
            getConflictedRevs,
            storeContent,
        },
        localDatabase: () => ({ getDBEntry, findAllDocs }),
        confirm: {
            askSelectString,
            askInPopup,
        },
        path: { getPath: vi.fn((entry: { path: FilePathWithPrefix }) => entry.path) },
        vault: { getActiveFilePath },
        appLifecycle: { isSuspended },
        conflict: { queueCheckFor, ensureAllProcessed, resolveByDeletingRevision },
        replication: {
            replicateUnattendedByEvent,
        },
        currentSettings,
        createDialogue: vi.fn(() => {
            constructed.value++;
            return {
                open: vi.fn(),
                waitForResult: vi.fn(async () => dialogueResult),
            };
        }),
        log,
    } as unknown as InteractiveConflictResolutionOperationsDependencies);
    return {
        askSelectString,
        askInPopup,
        constructed,
        context,
        dialogueResult: {
            get value() {
                return dialogueResult;
            },
            set value(value: unknown) {
                dialogueResult = value;
            },
        },
        findAllDocs,
        getDBEntry,
        getActiveFilePath,
        getConflictedRevs,
        ensureAllProcessed,
        currentSettings,
        isSuspended,
        log,
        operations,
        queueCheckFor,
        replicateUnattendedByEvent,
        resolveByDeletingRevision,
        storeContent,
        conflictedRevisions,
    };
}

type ControlledDialogue = {
    readonly filename: FilePathWithPrefix;
    readonly open: ReturnType<typeof vi.fn>;
    readonly finish: (result: MergeDialogResult) => void;
    readonly waitForResult: () => Promise<MergeDialogResult>;
};

function createControlledDialogueFactory(
    context: ReturnType<typeof createServiceContext>,
    dialogues: ControlledDialogue[]
): ConflictResolveDialogueFactory {
    const createDialogue = vi.fn((filename: FilePathWithPrefix) => {
        let settle!: (result: MergeDialogResult) => void;
        let offConflictCancelled: (() => void) | undefined;
        const result = new Promise<MergeDialogResult>((resolve) => {
            settle = resolve;
        });
        const finish = (dialogueResult: MergeDialogResult) => {
            offConflictCancelled?.();
            offConflictCancelled = undefined;
            settle(dialogueResult);
        };
        const dialogue: ControlledDialogue = {
            filename,
            open: vi.fn(() => {
                offConflictCancelled = context.events.onEvent(EVENT_CONFLICT_CANCELLED, (cancelledFilename) => {
                    if (cancelledFilename === filename) {
                        finish(CANCELLED);
                    }
                });
            }),
            finish,
            waitForResult: () => result,
        };
        dialogues.push(dialogue);
        return dialogue;
    });
    return createDialogue as unknown as ConflictResolveDialogueFactory;
}

function createDialogueConcurrencyHarness() {
    const context = createServiceContext();
    const emitEvent = vi.spyOn(context.events, "emitEvent");
    const dialogues: ControlledDialogue[] = [];
    const createDialogue = createControlledDialogueFactory(context, dialogues);
    const operations = createInteractiveConflictResolutionOperations({
        events: context.events,
        databaseFileAccess: {
            getConflictedRevs: vi.fn(async () => ["2-right"]),
            storeContent: vi.fn(async () => true),
        },
        localDatabase: () => ({
            getDBEntry: vi.fn(async () => false),
            findAllDocs: vi.fn(() => documents([])),
        }),
        confirm: { askSelectString: vi.fn(), askInPopup: vi.fn() },
        path: { getPath: vi.fn() },
        vault: { getActiveFilePath: vi.fn(() => path) },
        appLifecycle: { isSuspended: vi.fn(() => false) },
        conflict: {
            queueCheckFor: vi.fn(async () => undefined),
            ensureAllProcessed: vi.fn(async () => true),
            resolveByDeletingRevision: vi.fn(async () => AUTO_MERGED),
        },
        replication: {
            replicateUnattendedByEvent: vi.fn(async () => ({ status: "completed" as const })),
        },
        currentSettings: () => ({ syncAfterMerge: false }),
        createDialogue: createDialogue as ConflictResolveDialogueFactory,
        log: vi.fn(),
    } as unknown as InteractiveConflictResolutionOperationsDependencies);
    return { context, createDialogue, dialogues, emitEvent, operations };
}

describe("interactive conflict resolution operations", () => {
    it("replaces an active same-file dialogue with only the newest waiting request", async () => {
        const fixture = createDialogueConcurrencyHarness();

        const first = fixture.operations.resolveByUserInteraction(path, conflict);
        await vi.waitFor(() => expect(fixture.dialogues).toHaveLength(1));
        const superseded = fixture.operations.resolveByUserInteraction(path, conflict);
        const replacement = fixture.operations.resolveByUserInteraction(path, conflict);

        await vi.waitFor(() => expect(fixture.dialogues).toHaveLength(2));
        expect(fixture.emitEvent).toHaveBeenCalledWith(EVENT_CONFLICT_CANCELLED, path);
        expect(fixture.dialogues[1].filename).toBe(path);
        expect(fixture.createDialogue).toHaveBeenCalledTimes(2);

        fixture.dialogues[1].finish(CANCELLED);
        await Promise.all([first, superseded, replacement]);
    });

    it("keeps a same-file replacement request when its cancellation refresh sees the active dialogue", async () => {
        const dialogues: ControlledDialogue[] = [];
        const fixture = createFeatureHarness((context) => createControlledDialogueFactory(context, dialogues));
        const resolveByUserInteraction = fixture.handlers.resolveByUserInteraction!;

        const first = resolveByUserInteraction(path, conflict);
        await vi.waitFor(() => expect(dialogues).toHaveLength(1));
        const replacement = resolveByUserInteraction(path, conflict);

        await vi.waitFor(() => expect(dialogues).toHaveLength(2));
        expect(dialogues[1]?.filename).toBe(path);

        dialogues[1]?.finish(CANCELLED);
        await Promise.all([first, replacement]);
    });

    it("keeps a different file waiting until the active dialogue finishes", async () => {
        const fixture = createDialogueConcurrencyHarness();
        const otherPath = "other.md" as FilePathWithPrefix;

        const first = fixture.operations.resolveByUserInteraction(path, conflict);
        await vi.waitFor(() => expect(fixture.dialogues).toHaveLength(1));
        const waiting = fixture.operations.resolveByUserInteraction(otherPath, conflict);
        await Promise.resolve();

        expect(fixture.dialogues).toHaveLength(1);
        expect(fixture.emitEvent).not.toHaveBeenCalledWith(EVENT_CONFLICT_CANCELLED, otherPath);

        fixture.dialogues[0].finish(CANCELLED);
        await vi.waitFor(() => expect(fixture.dialogues).toHaveLength(2));
        expect(fixture.dialogues[1].filename).toBe(otherPath);
        fixture.dialogues[1].finish(CANCELLED);
        await Promise.all([first, waiting]);
    });

    it("does not reopen an unchanged conflict after the user chooses Not now", async () => {
        const { constructed, operations } = createOperations();

        await operations.resolveByUserInteraction(path, conflict);
        await operations.resolveByUserInteraction(path, conflict);

        expect(constructed.value).toBe(1);
    });

    it("does not treat cancellation by another conflict dialogue as Not now", async () => {
        const { constructed, dialogueResult, operations } = createOperations();
        dialogueResult.value = CANCELLED;

        await operations.resolveByUserInteraction(path, conflict);
        await operations.resolveByUserInteraction(path, conflict);

        expect(constructed.value).toBe(2);
    });

    it("allows an explicit resolution request to reopen a postponed conflict", async () => {
        const { constructed, dialogueResult, ensureAllProcessed, operations, queueCheckFor } = createOperations();

        await operations.resolveByUserInteraction(path, conflict);
        await operations.requestConflictResolution(path);
        await operations.resolveByUserInteraction(path, conflict);

        expect(queueCheckFor).toHaveBeenCalledWith(path);
        expect(queueCheckFor).toHaveBeenCalledOnce();
        expect(ensureAllProcessed).toHaveBeenCalledOnce();
        expect(constructed.value).toBe(2);
        expect(dialogueResult.value).toBe(POSTPONED);
    });

    it("opens a later conflict after the postponed conflict episode has resolved", async () => {
        const conflictedRevisions = ["2-right"];
        const { constructed, operations } = createOperations(conflictedRevisions);

        await operations.resolveByUserInteraction(path, conflict);
        conflictedRevisions.splice(0);
        await operations.refreshConflictState(path);
        conflictedRevisions.push("4-later");
        await operations.resolveByUserInteraction(path, conflict);

        expect(constructed.value).toBe(2);
    });

    it.each([
        { label: "cannot be read", result: false as const, refreshes: false },
        { label: "has no conflicts", result: { _rev: "2-left", _conflicts: [] as string[] }, refreshes: true },
    ])("exits safely when the live database $label after a user selection", async ({ result, refreshes }) => {
        const fixture = createOperations();
        fixture.dialogueResult.value = "2-right";
        fixture.getDBEntry.mockResolvedValue(result);
        const emitEvent = vi.spyOn(fixture.context.events, "emitEvent");

        await expect(fixture.operations.resolveByUserInteraction(path, conflict)).resolves.toBe(false);

        expect(fixture.resolveByDeletingRevision).not.toHaveBeenCalled();
        expect(fixture.replicateUnattendedByEvent).not.toHaveBeenCalled();
        expect(fixture.queueCheckFor).not.toHaveBeenCalled();
        if (refreshes) {
            expect(fixture.getConflictedRevs).toHaveBeenCalledWith(path);
            expect(emitEvent).toHaveBeenCalledWith(EVENT_ON_UNRESOLVED_ERROR);
        } else {
            expect(fixture.getConflictedRevs).not.toHaveBeenCalled();
            expect(emitEvent).not.toHaveBeenCalled();
        }
    });

    it("contributes the active conflict to the existing unresolved-message display", async () => {
        const { operations } = createOperations();

        await expect(operations.getActiveConflictMessages()).resolves.toEqual(["This file has unresolved conflicts."]);
    });

    it("returns no unresolved message when there is no active file", async () => {
        const { getActiveFilePath, getConflictedRevs, operations } = createOperations();
        getActiveFilePath.mockReturnValue(undefined);

        await expect(operations.getActiveConflictMessages()).resolves.toEqual([]);

        expect(getConflictedRevs).not.toHaveBeenCalled();
    });

    it("logs a failed conflict inspection and returns no unresolved messages", async () => {
        const fixture = createOperations();
        const error = new Error("database unavailable");
        fixture.getConflictedRevs.mockRejectedValue(error);

        await expect(fixture.operations.getActiveConflictMessages()).resolves.toEqual([]);

        expect(fixture.log).toHaveBeenCalledWith("Could not inspect the conflict state of note.md", expect.anything());
        expect(fixture.log).toHaveBeenCalledWith(error, expect.anything());
    });

    it("removes the active warning once the conflict has resolved", async () => {
        const conflictedRevisions = ["2-right"];
        const { operations } = createOperations(conflictedRevisions);

        await expect(operations.getActiveConflictMessages()).resolves.toEqual(["This file has unresolved conflicts."]);
        conflictedRevisions.splice(0);
        await expect(operations.getActiveConflictMessages()).resolves.toEqual([]);
    });

    it("reports the number of live versions and reduces it after each resolved pair", async () => {
        const conflictedRevisions = ["2-second", "2-third"];
        const { operations } = createOperations(conflictedRevisions);

        await expect(operations.getActiveConflictMessages()).resolves.toEqual([
            "This file has 3 unresolved versions. They will be reviewed one pair at a time.",
        ]);

        conflictedRevisions.shift();
        await operations.refreshConflictState(path);
        await expect(operations.getActiveConflictMessages()).resolves.toEqual(["This file has unresolved conflicts."]);

        conflictedRevisions.shift();
        await operations.refreshConflictState(path);
        await expect(operations.getActiveConflictMessages()).resolves.toEqual([]);
    });

    it("reconstructs the remaining pair after a postponed session is restarted", async () => {
        const conflictedRevisions = ["2-second", "2-third"];
        const firstSession = createOperations(conflictedRevisions);

        await firstSession.operations.resolveByUserInteraction(path, conflict);
        conflictedRevisions.shift();

        const restartedSession = createOperations(conflictedRevisions);
        await expect(restartedSession.operations.getActiveConflictMessages()).resolves.toEqual([
            "This file has unresolved conflicts.",
        ]);

        await restartedSession.operations.resolveByUserInteraction(path, {
            left: { rev: "3-merged", data: "merged", ctime: 1, mtime: 3 },
            right: { rev: "2-third", data: "third", ctime: 1, mtime: 2 },
            diff: [],
        });

        expect(restartedSession.constructed.value).toBe(1);
    });

    it("stores the exact concatenated diff before deleting a deterministically selected pair", async () => {
        const fixture = createOperations(["2-unrelated", "2-right"]);
        fixture.dialogueResult.value = LEAVE_TO_SUBSEQUENT;
        fixture.getDBEntry.mockResolvedValue({
            _rev: "2-left",
            _conflicts: ["2-unrelated", "2-right"],
        });
        await fixture.operations.resolveByUserInteraction(path, {
            ...conflict,
            diff: [
                [0, "left"],
                [1, "\n"],
                [1, "right"],
            ],
        });

        expect(fixture.storeContent).toHaveBeenCalledWith(path, "left\nright");
        expect(fixture.resolveByDeletingRevision).toHaveBeenCalledWith(path, "2-right", "UI Concatenated");
    });

    it("does not replicate or requeue when concatenated revision deletion fails", async () => {
        const fixture = createOperations();
        fixture.dialogueResult.value = LEAVE_TO_SUBSEQUENT;
        fixture.getDBEntry.mockResolvedValue({ _rev: "2-left", _conflicts: ["2-right"] });
        fixture.currentSettings.mockReturnValue({ syncAfterMerge: true });
        fixture.resolveByDeletingRevision.mockResolvedValue(MISSING_OR_ERROR);

        await fixture.operations.resolveByUserInteraction(path, {
            ...conflict,
            diff: [
                [0, "left"],
                [1, "\nright"],
            ],
        });

        expect(fixture.storeContent).toHaveBeenCalledWith(path, "left\nright");
        expect(fixture.resolveByDeletingRevision).toHaveBeenCalledWith(path, "2-right", "UI Concatenated");
        expect(fixture.replicateUnattendedByEvent).not.toHaveBeenCalled();
        expect(fixture.queueCheckFor).not.toHaveBeenCalled();
    });

    it("rechecks the live leaves instead of applying a stale dialogue selection", async () => {
        const fixture = createOperations(["2-other"]);
        fixture.dialogueResult.value = "2-right";
        fixture.getDBEntry.mockResolvedValue({
            _rev: "3-new-winner",
            _conflicts: ["2-other"],
        });

        await fixture.operations.resolveByUserInteraction(path, conflict);

        expect(fixture.resolveByDeletingRevision).not.toHaveBeenCalled();
        expect(fixture.queueCheckFor).toHaveBeenCalledWith(path);
    });

    it("does not delete a revision when concatenated content cannot be stored", async () => {
        const fixture = createOperations();
        fixture.dialogueResult.value = LEAVE_TO_SUBSEQUENT;
        fixture.getDBEntry.mockResolvedValue({ _rev: "2-left", _conflicts: ["2-right"] });
        fixture.storeContent.mockResolvedValue(false);

        await fixture.operations.resolveByUserInteraction(path, conflict);

        expect(fixture.resolveByDeletingRevision).not.toHaveBeenCalled();
        expect(fixture.replicateUnattendedByEvent).not.toHaveBeenCalled();
        expect(fixture.queueCheckFor).not.toHaveBeenCalled();
    });

    it("does not replicate or requeue when selected revision deletion fails", async () => {
        const fixture = createOperations();
        fixture.dialogueResult.value = "2-right";
        fixture.getDBEntry.mockResolvedValue({ _rev: "2-left", _conflicts: ["2-right"] });
        fixture.resolveByDeletingRevision.mockResolvedValue(MISSING_OR_ERROR);

        await fixture.operations.resolveByUserInteraction(path, conflict);

        expect(fixture.replicateUnattendedByEvent).not.toHaveBeenCalled();
        expect(fixture.queueCheckFor).not.toHaveBeenCalled();
    });

    it("rejects an unexpected dialogue result without changing revisions", async () => {
        const fixture = createOperations();
        fixture.dialogueResult.value = "unexpected-result";
        fixture.getDBEntry.mockResolvedValue({ _rev: "2-left", _conflicts: ["2-right"] });

        await fixture.operations.resolveByUserInteraction(path, conflict);

        expect(fixture.log).toHaveBeenCalledWith(
            `Merge: Something went wrong: ${path}, (unexpected-result)`,
            expect.anything()
        );
        expect(fixture.resolveByDeletingRevision).not.toHaveBeenCalled();
        expect(fixture.replicateUnattendedByEvent).not.toHaveBeenCalled();
        expect(fixture.queueCheckFor).not.toHaveBeenCalled();
    });

    it("replicates and requeues after a selected revision is resolved", async () => {
        const fixture = createOperations();
        fixture.dialogueResult.value = "2-right";
        fixture.getDBEntry.mockResolvedValue({ _rev: "2-left", _conflicts: ["2-right"] });
        fixture.currentSettings.mockReturnValue({ syncAfterMerge: true });

        await fixture.operations.resolveByUserInteraction(path, conflict);

        expect(fixture.resolveByDeletingRevision).toHaveBeenCalledWith(path, "2-right", "UI Selected");
        expect(fixture.replicateUnattendedByEvent).toHaveBeenCalledWith({
            trigger: "merge",
            interaction: expect.anything(),
        });
        expect(fixture.queueCheckFor).toHaveBeenCalledWith(path);
    });

    it("requeues without replication while the app is suspended", async () => {
        const fixture = createOperations();
        fixture.dialogueResult.value = "2-right";
        fixture.getDBEntry.mockResolvedValue({ _rev: "2-left", _conflicts: ["2-right"] });
        fixture.currentSettings.mockReturnValue({ syncAfterMerge: true });
        fixture.isSuspended.mockReturnValue(true);

        await fixture.operations.resolveByUserInteraction(path, conflict);

        expect(fixture.replicateUnattendedByEvent).not.toHaveBeenCalled();
        expect(fixture.queueCheckFor).toHaveBeenCalledWith(path);
    });

    it("does not show a no-conflicts notice when an automatic repeat reaches its normal end", async () => {
        const fixture = createOperations();
        fixture.findAllDocs
            .mockImplementationOnce(() =>
                documents([
                    {
                        _id: "note-id",
                        _rev: "2-left",
                        _conflicts: ["2-right"],
                        path,
                        mtime: 2,
                    },
                ])
            )
            .mockImplementationOnce(() => documents([]));
        fixture.askSelectString.mockResolvedValue(path);

        await fixture.operations.allConflictCheck();

        expect(fixture.askSelectString).toHaveBeenCalledOnce();
        expect(fixture.log).not.toHaveBeenCalledWith("There are no conflicted documents", expect.anything());
    });

    it("shows one no-conflicts notice for an explicit selection request which starts empty", async () => {
        const fixture = createOperations();

        await fixture.operations.pickFileForResolve();

        expect(fixture.askSelectString).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalledWith("There are no conflicted documents", expect.anything());
    });

    it("sorts multiple picker candidates newest first and returns safely on cancellation", async () => {
        const fixture = createOperations();
        fixture.findAllDocs.mockReturnValue(
            documents([
                { _id: "ordinary-id", path: "ordinary.md", mtime: 40 },
                { _id: "old-id", path: "old.md", _conflicts: ["2-old"], mtime: 10 },
                { _id: "new-id", path: "new.md", _conflicts: ["2-new"], mtime: 30 },
                { _id: "middle-id", path: "middle.md", _conflicts: ["2-middle"], mtime: 20 },
            ])
        );
        fixture.askSelectString.mockResolvedValue("");

        await expect(fixture.operations.pickFileForResolve()).resolves.toBe(false);

        expect(fixture.askSelectString).toHaveBeenCalledWith("File to resolve conflict", [
            "new.md",
            "middle.md",
            "old.md",
        ]);
        expect(fixture.queueCheckFor).not.toHaveBeenCalled();
        expect(fixture.ensureAllProcessed).not.toHaveBeenCalled();
    });

    it("reports conflicted documents and wires the startup popup action", async () => {
        const fixture = createOperations();
        fixture.findAllDocs.mockImplementation(() =>
            documents([
                { _id: "ordinary-id", path: "ordinary.md", mtime: 30 },
                { _id: "first-id", path: "first.md", _conflicts: ["2-first"], mtime: 10 },
                { _id: "second-id", path: "second.md", _conflicts: ["2-second"], mtime: 20 },
            ])
        );

        await expect(fixture.operations.scanStartupIssues()).resolves.toBe(true);

        expect(fixture.askInPopup).toHaveBeenCalledWith(
            "conflicting-detected-on-safety",
            expect.stringContaining("Some files have been left conflicted!"),
            expect.any(Function)
        );
        expect(fixture.log).toHaveBeenCalledWith("Conflicted: first.md");
        expect(fixture.log).toHaveBeenCalledWith("Conflicted: second.md");
        expect(fixture.log).not.toHaveBeenCalledWith("Conflicted: ordinary.md");

        const popupAction = fixture.askInPopup.mock.calls[0]?.[2] as (anchor: HTMLAnchorElement) => void;
        const addEventListener = vi.fn();
        const anchor = { text: "", addEventListener } as unknown as HTMLAnchorElement;
        popupAction(anchor);

        expect(anchor.text).toBe("HERE");
        expect(addEventListener).toHaveBeenCalledWith("click", expect.any(Function));

        const clickHandler = addEventListener.mock.calls[0]?.[1] as () => void;
        clickHandler();
        await vi.waitFor(() =>
            expect(fixture.askSelectString).toHaveBeenCalledWith("File to resolve conflict", ["second.md", "first.md"])
        );
    });
});

function createFeatureHarness(
    createDialogueForContext?: (context: ReturnType<typeof createServiceContext>) => ConflictResolveDialogueFactory
) {
    const context = createServiceContext();
    type FeatureLocalDatabase = {
        getDBEntry: (...args: unknown[]) => Promise<unknown>;
        findAllDocs: (...args: unknown[]) => AsyncGenerator<unknown>;
    };
    const initialLocalDatabase = {
        getDBEntry: vi.fn(async () => false),
        findAllDocs: vi.fn(() => documents([])),
    };
    let activeLocalDatabase: FeatureLocalDatabase = initialLocalDatabase;
    const getLocalDatabase = vi.fn(() => activeLocalDatabase);
    const replaceLocalDatabase = (replacement: FeatureLocalDatabase) => {
        activeLocalDatabase = replacement;
    };
    const database = {} as { readonly localDatabase: ReturnType<typeof getLocalDatabase> };
    Object.defineProperty(database, "localDatabase", { get: getLocalDatabase });
    const handlers = {
        initialise: undefined as undefined | (() => Promise<boolean>),
        onUnload: undefined as undefined | (() => Promise<boolean>),
        scanning: undefined as undefined | (() => Promise<boolean>),
        unresolvedMessages: undefined as undefined | (() => Promise<string[]>),
        resolveByUserInteraction: undefined as
            | undefined
            | ((filename: FilePathWithPrefix, result: diff_result) => Promise<boolean>),
    };
    const getConflictedRevs = vi.fn(async () => ["2-right"]);
    const services = {
        API: {
            addCommand: vi.fn(),
            addLog: vi.fn(),
        },
        UI: {
            confirm: {
                askSelectString: vi.fn(async () => ""),
                askInPopup: vi.fn(),
            },
        },
        appLifecycle: {
            getUnresolvedMessages: {
                addHandler: vi.fn((handler: () => Promise<string[]>) => {
                    handlers.unresolvedMessages = handler;
                }),
            },
            onInitialise: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    handlers.initialise = handler;
                }),
            },
            onScanningStartupIssues: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    handlers.scanning = handler;
                }),
            },
            onUnload: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    handlers.onUnload = handler;
                }),
            },
            isSuspended: vi.fn(() => false),
        },
        conflict: {
            resolveByUserInteraction: {
                addHandler: vi.fn(
                    (handler: (filename: FilePathWithPrefix, result: diff_result) => Promise<boolean>) => {
                        handlers.resolveByUserInteraction = handler;
                    }
                ),
            },
            queueCheckFor: vi.fn(async () => undefined),
            ensureAllProcessed: vi.fn(async () => true),
            resolveByDeletingRevision: vi.fn(async () => AUTO_MERGED),
        },
        replication: {
            replicateUnattendedByEvent: vi.fn(async () => ({ status: "completed" as const })),
        },
        vault: { getActiveFilePath: vi.fn(() => path) },
        path: { getPath: vi.fn((entry: { path: FilePathWithPrefix }) => entry.path) },
        database,
        setting: { currentSettings: vi.fn(() => ({ ...DEFAULT_SETTINGS, syncAfterMerge: false })) },
        context,
    };
    const serviceModules = {
        databaseFileAccess: {
            getConflictedRevs,
            storeContent: vi.fn(async () => true),
        },
    };
    const createDialogue =
        createDialogueForContext?.(context) ??
        vi.fn(() => ({
            open: vi.fn(),
            waitForResult: vi.fn(async (): Promise<typeof POSTPONED> => POSTPONED),
        }));

    useInteractiveConflictResolutionFeature({ services, serviceModules } as never, createDialogue);
    return {
        context,
        createDialogue,
        getConflictedRevs,
        getLocalDatabase,
        handlers,
        initialLocalDatabase,
        replaceLocalDatabase,
        services,
    };
}

describe("interactive conflict resolution feature composition", () => {
    it("registers lifecycle, command, conflict, and cancellation handlers", async () => {
        const fixture = createFeatureHarness();

        expect(fixture.services.appLifecycle.onScanningStartupIssues.addHandler).toHaveBeenCalledOnce();
        expect(fixture.services.appLifecycle.onInitialise.addHandler).toHaveBeenCalledOnce();
        expect(fixture.services.appLifecycle.getUnresolvedMessages.addHandler).toHaveBeenCalledOnce();
        expect(fixture.services.conflict.resolveByUserInteraction.addHandler).toHaveBeenCalledOnce();
        expect(fixture.services.appLifecycle.onUnload.addHandler).toHaveBeenCalledOnce();
        expect(fixture.getLocalDatabase).not.toHaveBeenCalled();

        await fixture.handlers.initialise?.();
        expect(fixture.services.API.addCommand).toHaveBeenCalledTimes(3);
        expect(fixture.services.API.addCommand).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ id: "livesync-checkdoc-conflicted", name: "Resolve if conflicted." })
        );
        expect(fixture.services.API.addCommand).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: "livesync-conflictcheck", name: "Pick a file to resolve conflict" })
        );
        expect(fixture.services.API.addCommand).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ id: "livesync-all-conflictcheck", name: "Resolve all conflicted files" })
        );
    });

    it("refreshes unresolved state through the host context event channel and disposes the listener", async () => {
        const fixture = createFeatureHarness();

        fixture.context.events.emitEvent(EVENT_CONFLICT_CANCELLED, path);
        await vi.waitFor(() => expect(fixture.getConflictedRevs).toHaveBeenCalledOnce());

        await fixture.handlers.onUnload?.();
        fixture.getConflictedRevs.mockClear();
        fixture.context.events.emitEvent(EVENT_CONFLICT_CANCELLED, path);
        await Promise.resolve();

        expect(fixture.getConflictedRevs).not.toHaveBeenCalled();
    });

    it("closes the active dialogue and drops waiting dialogues on unload", async () => {
        const dialogues: ControlledDialogue[] = [];
        const fixture = createFeatureHarness((context) => createControlledDialogueFactory(context, dialogues));
        const resolveByUserInteraction = fixture.handlers.resolveByUserInteraction!;

        const active = resolveByUserInteraction(path, conflict);
        await vi.waitFor(() => expect(dialogues).toHaveLength(1));
        const waiting = resolveByUserInteraction("waiting.md" as FilePathWithPrefix, conflict);
        await Promise.resolve();

        fixture.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
        let completed = false;
        const allResolutions = Promise.all([active, waiting]).then(() => {
            completed = true;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        const completedOnUnload = completed;

        if (!completedOnUnload) {
            dialogues[0]?.finish(CANCELLED);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            dialogues[1]?.finish(CANCELLED);
            await allResolutions;
        }

        expect(completedOnUnload).toBe(true);
        expect(dialogues).toHaveLength(1);
        await fixture.handlers.onUnload?.();
    });

    it("rejects a resolution request after unload without opening a dialogue", async () => {
        const dialogues: ControlledDialogue[] = [];
        const fixture = createFeatureHarness((context) => createControlledDialogueFactory(context, dialogues));
        const resolveByUserInteraction = fixture.handlers.resolveByUserInteraction!;

        await fixture.handlers.onUnload?.();
        await expect(resolveByUserInteraction(path, conflict)).resolves.toBe(false);

        expect(dialogues).toHaveLength(0);
        expect(fixture.createDialogue).not.toHaveBeenCalled();
    });

    it("drops a waiting dialogue when its conflict is resolved elsewhere", async () => {
        const dialogues: ControlledDialogue[] = [];
        const fixture = createFeatureHarness((context) => createControlledDialogueFactory(context, dialogues));
        const resolveByUserInteraction = fixture.handlers.resolveByUserInteraction!;
        const waitingPath = "resolved-while-waiting.md" as FilePathWithPrefix;

        const active = resolveByUserInteraction(path, conflict);
        await vi.waitFor(() => expect(dialogues).toHaveLength(1));
        const waiting = resolveByUserInteraction(waitingPath, conflict);
        await Promise.resolve();

        fixture.context.events.emitEvent(EVENT_CONFLICT_CANCELLED, waitingPath);
        dialogues[0].finish(CANCELLED);
        let completed = false;
        const allResolutions = Promise.all([active, waiting]).then(() => {
            completed = true;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        const completedWithoutOpening = completed;

        if (!completedWithoutOpening) {
            dialogues[1]?.finish(CANCELLED);
            await allResolutions;
        }

        expect(completedWithoutOpening).toBe(true);
        expect(dialogues).toHaveLength(1);
        await fixture.handlers.onUnload?.();
    });

    it("uses the replacement local database for operations after a reset", async () => {
        const fixture = createFeatureHarness();
        const replacementLocalDatabase = {
            getDBEntry: vi.fn(async () => false),
            findAllDocs: vi.fn(() => documents([])),
        };

        await fixture.handlers.scanning?.();
        fixture.replaceLocalDatabase(replacementLocalDatabase);
        await fixture.handlers.scanning?.();

        expect(fixture.initialLocalDatabase.findAllDocs).toHaveBeenCalledOnce();
        expect(replacementLocalDatabase.findAllDocs).toHaveBeenCalledOnce();
        expect(fixture.getLocalDatabase).toHaveBeenCalledTimes(2);
    });

    it("routes registered command callbacks to conflict operations", async () => {
        const fixture = createFeatureHarness();
        await fixture.handlers.initialise?.();
        const commands = fixture.services.API.addCommand.mock.calls.map(
            ([command]) => command as Record<string, unknown>
        );

        (commands[0].editorCallback as (editor: unknown, view: unknown) => void)({}, { file: { path } });
        await vi.waitFor(() => expect(fixture.services.conflict.ensureAllProcessed).toHaveBeenCalledOnce());
        await (commands[1].callback as () => Promise<void>)();
        await (commands[2].callback as () => Promise<void>)();

        expect(fixture.services.conflict.queueCheckFor).toHaveBeenCalledWith(path);
        expect(fixture.getLocalDatabase).toHaveBeenCalledTimes(2);
    });

    it("reads the host's current sync setting after a composed resolution", async () => {
        const fixture = createFeatureHarness(() => () => ({
            open: vi.fn(),
            waitForResult: vi.fn(async (): Promise<MergeDialogResult> => "2-right"),
        }));
        fixture.replaceLocalDatabase({
            getDBEntry: vi.fn(async () => ({ _rev: "2-left", _conflicts: ["2-right"] })),
            findAllDocs: vi.fn(() => documents([])),
        });
        fixture.services.setting.currentSettings.mockReturnValue({
            ...DEFAULT_SETTINGS,
            syncAfterMerge: true,
        });

        await fixture.handlers.resolveByUserInteraction?.(path, conflict);

        expect(fixture.services.setting.currentSettings).toHaveBeenCalledOnce();
        expect(fixture.services.replication.replicateUnattendedByEvent).toHaveBeenCalledOnce();
    });

    it("does nothing when the editor command has no active file", async () => {
        const fixture = createFeatureHarness();
        await fixture.handlers.initialise?.();
        const command = fixture.services.API.addCommand.mock.calls[0]?.[0] as {
            editorCallback: (editor: unknown, view: { file: null }) => void;
        };

        command.editorCallback({}, { file: null });
        await Promise.resolve();

        expect(fixture.services.conflict.queueCheckFor).not.toHaveBeenCalled();
        expect(fixture.services.conflict.ensureAllProcessed).not.toHaveBeenCalled();
        expect(fixture.createDialogue).not.toHaveBeenCalled();
    });

    it("reports a failed startup scan without escaping the lifecycle handler", async () => {
        const fixture = createFeatureHarness();
        async function* failedDocuments() {
            throw new Error("database unavailable");
        }
        fixture.replaceLocalDatabase({
            getDBEntry: vi.fn(async () => false),
            findAllDocs: vi.fn(() => failedDocuments()),
        });

        await expect(fixture.handlers.scanning?.()).resolves.toBe(false);
        expect(fixture.services.API.addLog).toHaveBeenCalled();
    });
});
