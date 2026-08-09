import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    AUTO_MERGED,
    CANCELLED,
    DEFAULT_SETTINGS,
    LEAVE_TO_SUBSEQUENT,
    LOG_LEVEL_NOTICE,
    type FilePathWithPrefix,
    type diff_result,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

const modalState = vi.hoisted(() => ({
    constructed: 0,
    result: undefined as unknown,
    postponed: Symbol("postponed"),
}));

vi.mock("@/common/utils.ts", () => ({
    displayRev: (revision: string) => revision,
}));

vi.mock("./InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    POSTPONED: modalState.postponed,
    ConflictResolveModal: class ConflictResolveModal {
        constructor() {
            modalState.constructed++;
        }

        open() {}

        async waitForResult() {
            return modalState.result;
        }
    },
}));

import { ModuleInteractiveConflictResolver } from "./ModuleInteractiveConflictResolver.ts";

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

function createModule(conflictedRevisions: string[] = ["2-right"]) {
    const handlers = {
        unresolvedMessages: undefined as undefined | (() => Promise<string[]>),
    };
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        appLifecycle: {
            getUnresolvedMessages: {
                addHandler: vi.fn((handler: () => Promise<string[]>) => {
                    handlers.unresolvedMessages = handler;
                }),
            },
            onScanningStartupIssues: { addHandler: vi.fn() },
            onInitialise: { addHandler: vi.fn() },
            isSuspended: vi.fn(() => false),
        },
        conflict: {
            resolveByUserInteraction: { addHandler: vi.fn() },
            resolveByDeletingRevision: vi.fn(async () => AUTO_MERGED),
            queueCheckFor: vi.fn(async () => undefined),
            ensureAllProcessed: vi.fn(async () => true),
        },
        replication: { replicateByEvent: vi.fn(async () => true) },
        vault: { getActiveFilePath: vi.fn(() => path) },
        path: { getPath: vi.fn((entry: { path: FilePathWithPrefix }) => entry.path) },
    };
    const core = {
        _services: services,
        services,
        settings: { ...DEFAULT_SETTINGS, syncAfterMerge: false },
        localDatabase: {
            getDBEntry: vi.fn(async (): Promise<false | { _rev: string; _conflicts?: string[] }> => false),
            findAllDocs: vi.fn(() => documents([])),
        },
        databaseFileAccess: {
            getConflictedRevs: vi.fn(async () => conflictedRevisions),
            storeContent: vi.fn(async () => true),
        },
        confirm: {
            askSelectString: vi.fn(async (): Promise<string | undefined> => undefined),
        },
    };
    const plugin = { app: {} };
    const module = new ModuleInteractiveConflictResolver(plugin as never, core as never);
    module._log = vi.fn();
    return { core, handlers, module, services };
}

describe("ModuleInteractiveConflictResolver postponement", () => {
    beforeEach(() => {
        modalState.constructed = 0;
        modalState.result = modalState.postponed;
    });

    it("does not reopen an unchanged conflict after the user chooses Not now", async () => {
        const { module } = createModule();

        await module._anyResolveConflictByUI(path, conflict);
        await module._anyResolveConflictByUI(path, conflict);

        expect(modalState.constructed).toBe(1);
    });

    it("does not treat cancellation by another conflict dialogue as Not now", async () => {
        const { module } = createModule();
        modalState.result = CANCELLED;

        await module._anyResolveConflictByUI(path, conflict);
        await module._anyResolveConflictByUI(path, conflict);

        expect(modalState.constructed).toBe(2);
    });

    it("allows an explicit resolution request to reopen a postponed conflict", async () => {
        const { module, services } = createModule();

        await module._anyResolveConflictByUI(path, conflict);
        await (module as any).requestConflictResolution(path);
        await module._anyResolveConflictByUI(path, conflict);

        expect(services.conflict.queueCheckFor).toHaveBeenCalledWith(path);
        expect(services.conflict.ensureAllProcessed).toHaveBeenCalledOnce();
        expect(modalState.constructed).toBe(2);
    });

    it("opens a later conflict after the postponed conflict episode has resolved", async () => {
        const conflictedRevisions = ["2-right"];
        const { module } = createModule(conflictedRevisions);

        await module._anyResolveConflictByUI(path, conflict);
        conflictedRevisions.splice(0);
        await (module as any).refreshConflictState(path);
        conflictedRevisions.push("4-later");
        await module._anyResolveConflictByUI(path, conflict);

        expect(modalState.constructed).toBe(2);
    });

    it("contributes the active conflict to the existing unresolved-message display", async () => {
        const { core, handlers, module, services } = createModule();

        module.onBindFunction(core as never, services as never);

        expect(services.appLifecycle.getUnresolvedMessages.addHandler).toHaveBeenCalledOnce();
        await expect(handlers.unresolvedMessages?.()).resolves.toEqual(["This file has unresolved conflicts."]);
    });

    it("removes the active warning once the conflict has resolved", async () => {
        const conflictedRevisions = ["2-right"];
        const { core, handlers, module, services } = createModule(conflictedRevisions);
        module.onBindFunction(core as never, services as never);

        await expect(handlers.unresolvedMessages?.()).resolves.toEqual(["This file has unresolved conflicts."]);
        conflictedRevisions.splice(0);
        await expect(handlers.unresolvedMessages?.()).resolves.toEqual([]);
    });

    it("reports the number of live versions and reduces it after each resolved pair", async () => {
        const conflictedRevisions = ["2-second", "2-third"];
        const { core, handlers, module, services } = createModule(conflictedRevisions);
        module.onBindFunction(core as never, services as never);

        await expect(handlers.unresolvedMessages?.()).resolves.toEqual([
            "This file has 3 unresolved versions. They will be reviewed one pair at a time.",
        ]);

        conflictedRevisions.shift();
        await (module as any).refreshConflictState(path);
        await expect(handlers.unresolvedMessages?.()).resolves.toEqual(["This file has unresolved conflicts."]);

        conflictedRevisions.shift();
        await (module as any).refreshConflictState(path);
        await expect(handlers.unresolvedMessages?.()).resolves.toEqual([]);
    });

    it("reconstructs the remaining pair after a postponed session is restarted", async () => {
        const conflictedRevisions = ["2-second", "2-third"];
        const firstSession = createModule(conflictedRevisions);

        await firstSession.module._anyResolveConflictByUI(path, conflict);
        conflictedRevisions.shift();

        const restartedSession = createModule(conflictedRevisions);
        restartedSession.module.onBindFunction(restartedSession.core as never, restartedSession.services as never);
        await expect(restartedSession.handlers.unresolvedMessages?.()).resolves.toEqual([
            "This file has unresolved conflicts.",
        ]);

        await restartedSession.module._anyResolveConflictByUI(path, {
            left: { rev: "3-merged", data: "merged", ctime: 1, mtime: 3 },
            right: { rev: "2-third", data: "third", ctime: 1, mtime: 2 },
            diff: [],
        });

        expect(modalState.constructed).toBe(2);
    });

    it("deletes the compared right leaf when concatenating a deterministically selected pair", async () => {
        const { core, module, services } = createModule(["2-unrelated", "2-right"]);
        modalState.result = LEAVE_TO_SUBSEQUENT;
        core.localDatabase.getDBEntry.mockResolvedValue({
            _rev: "2-left",
            _conflicts: ["2-unrelated", "2-right"],
        });

        await module._anyResolveConflictByUI(path, conflict);

        expect(core.databaseFileAccess.storeContent).toHaveBeenCalledWith(path, "");
        expect(services.conflict.resolveByDeletingRevision).toHaveBeenCalledWith(path, "2-right", "UI Concatenated");
    });

    it("rechecks the live leaves instead of applying a stale dialogue selection", async () => {
        const { core, module, services } = createModule(["2-other"]);
        modalState.result = "2-right";
        core.localDatabase.getDBEntry.mockResolvedValue({
            _rev: "3-new-winner",
            _conflicts: ["2-other"],
        });

        await module._anyResolveConflictByUI(path, conflict);

        expect(services.conflict.resolveByDeletingRevision).not.toHaveBeenCalled();
        expect(services.conflict.queueCheckFor).toHaveBeenCalledWith(path);
    });
});

describe("ModuleInteractiveConflictResolver file selection", () => {
    beforeEach(() => {
        modalState.constructed = 0;
        modalState.result = modalState.postponed;
    });

    it("does not show a no-conflicts notice when an automatic repeat reaches its normal end", async () => {
        const { core, module } = createModule();
        core.localDatabase.findAllDocs
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
        core.confirm.askSelectString.mockResolvedValue(path);

        await module.allConflictCheck();

        expect(core.confirm.askSelectString).toHaveBeenCalledOnce();
        expect(module._log).not.toHaveBeenCalledWith("There are no conflicted documents", LOG_LEVEL_NOTICE);
    });

    it("shows one no-conflicts notice for an explicit selection request which starts empty", async () => {
        const { module } = createModule();

        await module.pickFileForResolve();

        expect(module._log).toHaveBeenCalledTimes(1);
        expect(module._log).toHaveBeenCalledWith("There are no conflicted documents", LOG_LEVEL_NOTICE);
    });
});
