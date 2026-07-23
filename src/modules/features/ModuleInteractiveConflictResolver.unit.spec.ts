import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    CANCELLED,
    DEFAULT_SETTINGS,
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
            resolveByDeletingRevision: vi.fn(),
            queueCheckFor: vi.fn(async () => undefined),
            ensureAllProcessed: vi.fn(async () => true),
        },
        replication: { replicateByEvent: vi.fn(async () => true) },
        vault: { getActiveFilePath: vi.fn(() => path) },
        path: { getPath: vi.fn(), getPathWithoutPrefix: vi.fn() },
    };
    const core = {
        _services: services,
        services,
        settings: { ...DEFAULT_SETTINGS, syncAfterMerge: false },
        localDatabase: {
            getDBEntry: vi.fn(async () => false),
            findAllDocs: vi.fn(),
        },
        databaseFileAccess: {
            getConflictedRevs: vi.fn(async () => conflictedRevisions),
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
});
