import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({ JsonResolveModal: class JsonResolveModal {} }));
vi.mock("@/modules/features/ModuleLog.ts", () => ({ MARK_DONE: "" }));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {
        disable = vi.fn();
    },
}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({ configureHiddenFileSyncMode: vi.fn() }));

import {
    DEFAULT_SETTINGS,
    type DocumentID,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { HiddenFileSync } from "./CmdHiddenFileSync";
import { sendSignal, waitForSignal } from "@vrtmrz/livesync-commonlib/compat/common/utils";

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
        hiddenFileSync.conflictResolutionProcessor.dispose();
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

    it.each(["prefixed", "unprefixed"])(
        "cancels the older same-file dialogue and presents the latest revisions for a %s request",
        async (form) => {
            vi.useFakeTimers();
            const filename = `.obsidian/replacement-${form}.json`;
            const path = `i:${filename}` as FilePathWithPrefix;
            const id = String(path) as DocumentID;
            let generation = 2;
            const localDatabase = {
                getRaw: vi.fn(async (_id: DocumentID, options?: { revs_info?: boolean }) =>
                    options?.revs_info
                        ? {}
                        : { _id: id, path, _rev: `${generation}-current`, _conflicts: [`${generation}-other`] }
                ),
                getDBEntry: vi.fn(
                    async (_path: FilePathWithPrefix, options: { rev: string }) =>
                        ({ _id: id, path, _rev: options.rev }) as LoadedEntry
                ),
                managers: { conflictManager: { mergeObject: vi.fn(async () => false) } },
            };
            const { hiddenFileSync } = createHiddenFileSync(localDatabase);
            hiddenFileSync.path2id = async () => id;
            const finishFirst = deferred<boolean>();
            let cancelled = false;
            const opened: string[][] = [];
            hiddenFileSync.showJSONMergeDialogAndMerge = vi.fn(async (left, right) => {
                opened.push([left._rev!, right._rev!]);
                if (opened.length > 1) return false;
                return await Promise.race([
                    finishFirst.promise,
                    waitForSignal(`cancel-internal-conflict:${filename}`).then(() => {
                        cancelled = true;
                        return false;
                    }),
                ]);
            });

            try {
                hiddenFileSync.queueConflictCheck(path);
                await vi.advanceTimersByTimeAsync(100);
                expect(opened).toEqual([["2-current", "2-other"]]);

                generation = 3;
                hiddenFileSync.queueConflictCheck((form === "prefixed" ? path : filename) as FilePathWithPrefix);
                await vi.advanceTimersByTimeAsync(100);

                expect(cancelled).toBe(true);
                expect(opened).toEqual([
                    ["2-current", "2-other"],
                    ["3-current", "3-other"],
                ]);
                expect(await hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed()).toBe(true);
                expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
            } finally {
                finishFirst.resolve(false);
                sendSignal(`cancel-internal-conflict:${filename}`);
                await vi.advanceTimersByTimeAsync(100);
            }
        }
    );

    it.each(["same", "different"])(
        "closes only a dialogue for the %s file when a replicated resolution arrives",
        async (target) => {
            vi.useFakeTimers();
            const filename = `.obsidian/received-${target}.json`;
            const path = `i:${filename}` as FilePathWithPrefix;
            const incomingPath = (target === "same" ? path : "i:.obsidian/other-resolved.json") as FilePathWithPrefix;
            const id = String(path) as DocumentID;
            let resolved = false;
            const localDatabase = {
                getRaw: vi.fn(async (_id: DocumentID, options?: { revs_info?: boolean }) =>
                    options?.revs_info
                        ? {}
                        : {
                              _id: id,
                              path,
                              _rev: resolved ? "3-resolved" : "2-current",
                              _conflicts: resolved ? [] : ["2-other"],
                          }
                ),
                getDBEntry: vi.fn(async () => ({ _id: id, path }) as LoadedEntry),
                managers: { conflictManager: { mergeObject: vi.fn(async () => false) } },
            };
            const { hiddenFileSync } = createHiddenFileSync(localDatabase);
            hiddenFileSync.path2id = async () => id;
            hiddenFileSync.getPath = () => incomingPath;
            hiddenFileSync.isTargetFile = vi.fn(async () => true);
            hiddenFileSync.trackDatabaseFileModification = vi.fn(async () => true);
            const finishFirst = deferred<boolean>();
            let cancelled = false;
            hiddenFileSync.showJSONMergeDialogAndMerge = vi.fn(
                async () =>
                    await Promise.race([
                        finishFirst.promise,
                        waitForSignal(`cancel-internal-conflict:${filename}`).then(() => {
                            cancelled = true;
                            return false;
                        }),
                    ])
            );

            try {
                hiddenFileSync.queueConflictCheck(path);
                await vi.advanceTimersByTimeAsync(100);
                expect(hiddenFileSync.showJSONMergeDialogAndMerge).toHaveBeenCalledOnce();

                resolved = target === "same";
                const incoming = {
                    _id: String(incomingPath) as DocumentID,
                    path: incomingPath,
                    _rev: "3-received",
                } as LoadedEntry;
                expect(await hiddenFileSync._anyProcessOptionalSyncFiles(incoming)).toBe(true);
                await vi.advanceTimersByTimeAsync(100);

                expect(cancelled).toBe(target === "same");
                expect(hiddenFileSync.showJSONMergeDialogAndMerge).toHaveBeenCalledOnce();
                expect(hiddenFileSync.pendingConflictChecks.size).toBe(target === "same" ? 0 : 1);
                if (target === "same") {
                    expect(await hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed()).toBe(true);
                }
            } finally {
                finishFirst.resolve(false);
                sendSignal(`cancel-internal-conflict:${filename}`);
                await vi.advanceTimersByTimeAsync(100);
            }
        }
    );

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

describe("HiddenFileSync pipeline contracts", () => {
    it("starts above the threshold, limits analysis to five, and retains FIFO input", async () => {
        vi.useFakeTimers();
        const gates = Array.from({ length: 11 }, () => deferred<MetaEntry>());
        const paths = gates.map((_, index) => `i:.obsidian/${index}.txt` as FilePathWithPrefix);
        const reads: string[] = [];
        const getRaw = vi.fn((id: DocumentID) => {
            reads.push(id);
            return gates[paths.indexOf(id as unknown as FilePathWithPrefix)].promise;
        });
        const { hiddenFileSync } = createHiddenFileSync({ getRaw });
        hiddenFileSync.path2id = async (path) => path as unknown as DocumentID;
        for (const path of paths.slice(0, 10)) hiddenFileSync.queueConflictCheck(path);
        await vi.advanceTimersByTimeAsync(0);
        expect(reads).toEqual([]);
        hiddenFileSync.queueConflictCheck(paths[10]);
        await vi.advanceTimersByTimeAsync(0);
        expect(reads).toEqual(paths.slice(0, 5));
        hiddenFileSync.queueConflictCheck(paths[0]);
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(11);
        gates[0].resolve({ path: paths[0] } as MetaEntry);
        await vi.advanceTimersByTimeAsync(0);
        expect(reads).toEqual(paths.slice(0, 6));
        gates.forEach((gate, index) => gate.resolve({ path: paths[index] } as MetaEntry));
        await vi.advanceTimersByTimeAsync(100);
        expect(await hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed()).toBe(true);
        expect(reads).toEqual([...paths, paths[0]]);
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
    });

    it("continues analysis while one manual dialogue is open and serialises the dialogues", async () => {
        vi.useFakeTimers();
        const paths = Array.from({ length: 12 }, (_, index) => `i:.obsidian/${index}.json` as FilePathWithPrefix);
        const gates = paths.map(() => deferred<boolean>());
        const firstDialogue = deferred<boolean>();
        let firstCancelled = false;
        const localDatabase = {
            getRaw: vi.fn(async (id: DocumentID, options?: { revs_info?: boolean }) =>
                options?.revs_info
                    ? {}
                    : {
                          _id: id,
                          path: id,
                          _rev: "2-current",
                          _conflicts: ["2-other"],
                      }
            ),
            getDBEntry: vi.fn(async (path: FilePathWithPrefix) => ({ path }) as LoadedEntry),
            managers: { conflictManager: { mergeObject: vi.fn(async () => false) } },
        };
        const { hiddenFileSync } = createHiddenFileSync(localDatabase);
        hiddenFileSync.path2id = async (path) => path as unknown as DocumentID;
        const opened: FilePathWithPrefix[] = [];
        hiddenFileSync.showJSONMergeDialogAndMerge = vi.fn((doc) => {
            opened.push(doc.path);
            if (opened.length === 1) {
                return Promise.race([
                    firstDialogue.promise,
                    waitForSignal(`cancel-internal-conflict:${doc.path.slice(2)}`).then(() => {
                        firstCancelled = true;
                        return false;
                    }),
                ]);
            }
            return gates[paths.indexOf(doc.path)].promise;
        });
        paths.forEach((path) => hiddenFileSync.queueConflictCheck(path));
        await vi.advanceTimersByTimeAsync(100);
        expect(localDatabase.managers.conflictManager.mergeObject).toHaveBeenCalledTimes(12);
        expect(opened).toEqual([paths[0]]);
        paths.forEach((path) => hiddenFileSync.queueConflictCheck(path));
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(12);
        await vi.advanceTimersByTimeAsync(100);
        expect(firstCancelled).toBe(true);
        expect(opened).toEqual([paths[0], paths[0]]);
        expect(localDatabase.managers.conflictManager.mergeObject).toHaveBeenCalledTimes(24);
        let completed = false;
        void hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed().then(() => {
            completed = true;
        });
        for (let index = 0; index < paths.length; index++) {
            expect(opened).toEqual([paths[0], ...paths.slice(0, index + 1)]);
            expect(completed).toBe(false);
            gates[index].resolve(false);
            await vi.advanceTimersByTimeAsync(100);
        }
        expect(completed).toBe(true);
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
    });

    it("logs an analysis error and continues with later paths", async () => {
        vi.useFakeTimers();
        const failure = new Error("Injected read failure");
        const getRaw = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({});
        const { hiddenFileSync } = createHiddenFileSync({ getRaw });
        hiddenFileSync.path2id = async (path) => path as unknown as DocumentID;
        hiddenFileSync.queueConflictCheck("i:bad.txt" as FilePathWithPrefix);
        hiddenFileSync.queueConflictCheck("i:good.txt" as FilePathWithPrefix);
        await vi.advanceTimersByTimeAsync(100);
        expect(await hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed()).toBe(true);
        expect(getRaw).toHaveBeenCalledTimes(2);
        expect(hiddenFileSync._log).toHaveBeenCalledWith(failure, expect.anything());
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
    });

    it("collects a conflict enumeration before resuming analysis", async () => {
        vi.useFakeTimers();
        const gate = deferred();
        const path = "i:.obsidian/scanned.txt" as FilePathWithPrefix;
        const getRaw = vi.fn(async () => ({}));
        const { hiddenFileSync } = createHiddenFileSync({
            getRaw,
            findEntries: async function* () {
                await gate.promise;
                yield { _id: path, path, _conflicts: ["2-other"] };
            },
        });
        hiddenFileSync.path2id = async (value) => value as unknown as DocumentID;
        const result = hiddenFileSync.resolveConflictOnInternalFiles();
        await vi.advanceTimersByTimeAsync(100);
        hiddenFileSync.queueConflictCheck(path);
        await vi.advanceTimersByTimeAsync(100);
        expect(getRaw).not.toHaveBeenCalled();
        gate.resolve();
        await vi.advanceTimersByTimeAsync(100);
        await result;
        expect(getRaw).toHaveBeenCalledOnce();
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
    });
});

describe("HiddenFileSync conflict queue ownership", () => {
    it("stops delayed work on unload and rejects later conflict events", async () => {
        vi.useFakeTimers();
        const getRaw = vi.fn(async () => ({}));
        const { hiddenFileSync } = createHiddenFileSync({ getRaw });
        hiddenFileSync.path2id = async (path) => path as unknown as DocumentID;
        const path = "i:.obsidian/queued.txt" as FilePathWithPrefix;
        hiddenFileSync.queueConflictCheck(path);
        const idle = hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed();
        hiddenFileSync.onunload();
        hiddenFileSync.queueConflictCheck(path);
        await vi.advanceTimersByTimeAsync(100);
        expect(await idle).toBe(false);
        expect(getRaw).not.toHaveBeenCalled();
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("finishes an admitted analysis without handing its result to a new dialogue after unload", async () => {
        vi.useFakeTimers();
        const gate = deferred<MetaEntry>();
        const path = "i:.obsidian/active.json" as FilePathWithPrefix;
        const getRaw = vi
            .fn()
            .mockImplementationOnce(() => gate.promise)
            .mockResolvedValue({});
        const getDBEntry = vi.fn(async () => ({ path }));
        const mergeObject = vi.fn(async () => false);
        const { hiddenFileSync } = createHiddenFileSync({
            getRaw,
            getDBEntry,
            managers: { conflictManager: { mergeObject } },
        });
        hiddenFileSync.path2id = async () => path as unknown as DocumentID;
        hiddenFileSync.queueConflictCheck(path);
        await vi.advanceTimersByTimeAsync(10);
        expect(getRaw).toHaveBeenCalledOnce();
        hiddenFileSync.onunload();
        expect(await hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed()).toBe(false);
        gate.resolve({
            _id: String(path) as DocumentID,
            path,
            _rev: "2-current",
            _conflicts: ["2-other"],
        } as MetaEntry);
        await vi.advanceTimersByTimeAsync(100);
        expect(mergeObject).toHaveBeenCalledOnce();
        expect(getDBEntry).not.toHaveBeenCalled();
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
    });

    it("does not requeue a manual resolution which finishes after unload", async () => {
        vi.useFakeTimers();
        const gate = deferred<boolean>();
        const path = "i:.obsidian/dialogue.json" as FilePathWithPrefix;
        const getRaw = vi.fn(async (_id: DocumentID, options?: { revs_info?: boolean }) =>
            options?.revs_info
                ? {}
                : {
                      _id: path,
                      path,
                      _rev: "2-current",
                      _conflicts: ["2-other"],
                  }
        );
        const getDBEntry = vi.fn(async () => ({ path }) as LoadedEntry);
        const { hiddenFileSync } = createHiddenFileSync({
            getRaw,
            getDBEntry,
            managers: { conflictManager: { mergeObject: async () => false } },
        });
        hiddenFileSync.path2id = async () => path as unknown as DocumentID;
        hiddenFileSync.showJSONMergeDialogAndMerge = vi.fn(() => gate.promise);
        hiddenFileSync.queueConflictCheck(path);
        await vi.advanceTimersByTimeAsync(20);
        expect(hiddenFileSync.showJSONMergeDialogAndMerge).toHaveBeenCalledOnce();
        hiddenFileSync.onunload();
        expect(await hiddenFileSync.conflictResolutionProcessor.waitForAllProcessed()).toBe(false);
        gate.resolve(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(getRaw).toHaveBeenCalledTimes(2);
        expect(getDBEntry).toHaveBeenCalledTimes(2);
        expect(hiddenFileSync.pendingConflictChecks.size).toBe(0);
        expect(hiddenFileSync.conflictResolutionProcessor.totalRemaining).toBe(0);
    });
});
