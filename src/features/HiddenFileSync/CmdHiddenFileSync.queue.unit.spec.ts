import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({ JsonResolveModal: class JsonResolveModal {} }));
vi.mock("@/modules/features/ModuleLog.ts", () => ({ MARK_DONE: "" }));
vi.mock("@/common/PeriodicProcessor.ts", () => ({ PeriodicProcessor: class PeriodicProcessor {} }));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({ configureHiddenFileSyncMode: vi.fn() }));

import {
    DEFAULT_SETTINGS,
    type DocumentID,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { HiddenFileSync } from "./CmdHiddenFileSync";

const queueOwners: HiddenFileSync[] = [];

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean, message: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error(message);
}

function createHiddenFileSync(localDatabase: object) {
    vi.spyOn(HiddenFileSync.prototype, "onBindFunction").mockImplementation(() => {});
    const hiddenFileSync = new HiddenFileSync({
        settings: {
            ...DEFAULT_SETTINGS,
            syncInternalFiles: true,
            syncInternalFileOverwritePatterns: "",
        },
        localDatabase,
        services: { API: { addLog: vi.fn() }, context: { app: {} } },
    } as unknown as ConstructorParameters<typeof HiddenFileSync>[0]);
    hiddenFileSync._log = vi.fn();
    queueOwners.push(hiddenFileSync);
    return { hiddenFileSync };
}

afterEach(() => {
    for (const hiddenFileSync of queueOwners.splice(0)) {
        hiddenFileSync.conflictResolutionProcessor.terminateAll();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("HiddenFileSync conflict queue", () => {
    it("keeps a self-requeued conflict check and waits for its follow-up", async () => {
        vi.useFakeTimers();
        const path = "i:.obsidian/plugins/example/data.txt" as FilePathWithPrefix;
        const id = String(path) as DocumentID;
        const conflictDoc = {
            _id: id,
            _rev: "2-current",
            path,
            _conflicts: ["2-conflicted"],
        } as MetaEntry;
        const resolvedDoc = { _id: id, _rev: "3-resolved", path } as MetaEntry;
        let rawRead = 0;
        const localDatabase = {
            findEntries: vi.fn(async function* () {
                yield conflictDoc;
            }),
            getRaw: vi.fn(async () => (rawRead++ === 0 ? conflictDoc : resolvedDoc)),
        };
        const { hiddenFileSync } = createHiddenFileSync(localDatabase);
        hiddenFileSync.path2id = async () => id;

        let resolutionCalls = 0;
        let requeued = false;
        hiddenFileSync.resolveByNewerEntry = vi.fn(async () => {
            resolutionCalls++;
            hiddenFileSync.requeueConflictCheck(path);
            requeued = true;
        });

        let completed = false;
        hiddenFileSync.queueConflictCheck(path);
        try {
            expect(hiddenFileSync.conflictResolutionProcessor.delay).toBe(10);
            await waitForCondition(
                () => hiddenFileSync.conflictResolutionProcessor.remaining === 1,
                "The initial conflict check was not queued"
            );

            await vi.advanceTimersByTimeAsync(9);
            expect(localDatabase.getRaw).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            await waitForCondition(
                () =>
                    requeued &&
                    hiddenFileSync.conflictResolutionProcessor.nowProcessing === 0 &&
                    hiddenFileSync.conflictResolutionProcessor.remaining === 1,
                "The conflict follow-up was not retained after the first pass"
            );
            void hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed().then(() => {
                completed = true;
            });
            expect(completed).toBe(false);
            expect(localDatabase.getRaw).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(9);
            expect(localDatabase.getRaw).toHaveBeenCalledTimes(1);
            expect(completed).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            await vi.advanceTimersByTimeAsync(1_000);
            await waitForCondition(() => completed, "The conflict pipeline did not await its follow-up");

            expect(localDatabase.getRaw).toHaveBeenCalledTimes(2);
            expect(resolutionCalls).toBe(1);
            expect(hiddenFileSync.pendingConflictChecks.has(path)).toBe(false);
            expect(hiddenFileSync.conflictResolutionProcessor.remaining).toBe(0);
        } finally {
            await vi.runAllTimersAsync();
        }
    });

    it("waits for a cancelled manual merge dialogue and then finishes without requeueing", async () => {
        vi.useFakeTimers();
        const path = "i:.obsidian/plugins/example/data.json" as FilePathWithPrefix;
        const id = String(path) as DocumentID;
        const conflictDoc = {
            _id: id,
            _rev: "2-current",
            path,
            _conflicts: ["2-conflicted"],
        } as MetaEntry;
        const historyDoc = {} as unknown as MetaEntry;
        const loaded = { _id: id, _rev: "2-current", path } as LoadedEntry;
        const dialogue = deferred<boolean>();
        let dialogueOpened = false;
        const localDatabase = {
            findEntries: vi.fn(async function* () {
                yield conflictDoc;
            }),
            getRaw: vi.fn(async (_id: DocumentID, options?: { revs_info?: boolean }) =>
                options?.revs_info ? historyDoc : conflictDoc
            ),
            getDBEntry: vi.fn(async () => loaded),
            managers: {
                conflictManager: {
                    mergeObject: vi.fn(async () => false),
                },
            },
        };
        const { hiddenFileSync } = createHiddenFileSync(localDatabase);
        hiddenFileSync.path2id = async () => id;
        hiddenFileSync.showJSONMergeDialogAndMerge = vi.fn(async () => {
            dialogueOpened = true;
            return await dialogue.promise;
        });

        let completed = false;
        hiddenFileSync.queueConflictCheck(path);
        try {
            expect(hiddenFileSync.conflictResolutionProcessor.delay).toBe(10);
            await waitForCondition(
                () => hiddenFileSync.conflictResolutionProcessor.remaining === 1,
                "The initial conflict check was not queued"
            );

            await vi.advanceTimersByTimeAsync(100);
            expect(dialogueOpened).toBe(true);
            void hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed().then(() => {
                completed = true;
            });
            expect(completed).toBe(false);
            expect(hiddenFileSync.conflictResolutionProcessor.totalRemaining).toBeGreaterThan(0);
            expect(localDatabase.managers.conflictManager.mergeObject).toHaveBeenCalledOnce();
            expect(localDatabase.getDBEntry).toHaveBeenCalledTimes(2);

            dialogue.resolve(false);
            await vi.advanceTimersByTimeAsync(1_000);
            await waitForCondition(() => completed, "The cancelled dialogue did not release the pipeline");

            expect(hiddenFileSync.pendingConflictChecks.has(path)).toBe(false);
            expect(hiddenFileSync.conflictResolutionProcessor.totalRemaining).toBe(0);
        } finally {
            dialogue.resolve(false);
            await vi.runAllTimersAsync();
        }
    });
});
