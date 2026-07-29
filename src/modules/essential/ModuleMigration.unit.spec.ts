import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/features/SetupManager.ts", () => ({
    SetupManager: class SetupManager {},
}));
vi.mock("@/deps.ts", () => ({}));
vi.mock("@/common/utils.ts", () => ({
    isValidPath: () => true,
}));

import { ModuleMigration } from "./ModuleMigration.ts";

async function* noDocuments() {
    return;
}

async function* failedDocumentScan() {
    throw new Error("scan failed");
}

function createMigration(findAllNormalDocs: typeof noDocuments | typeof failedDocumentScan = noDocuments) {
    const noticeGroups = {
        setItem: vi.fn(),
        finish: vi.fn(() => true),
    };
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        context: { noticeGroups },
        vault: { isTargetFile: vi.fn(async () => true) },
        path: { getPath: vi.fn() },
    };
    const core = {
        _services: services,
        services,
        kvDB: {
            get: vi.fn(async () => false),
            set: vi.fn(async () => undefined),
        },
        localDatabase: { findAllNormalDocs },
        storageAccess: {},
    };
    return {
        migration: new ModuleMigration(core as never),
        noticeGroups,
    };
}

describe("ModuleMigration incomplete-document notice", () => {
    it("keeps the check and its result in one persistent named group", async () => {
        const { migration, noticeGroups } = createMigration();

        await expect(migration.hasIncompleteDocs()).resolves.toBe(true);

        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(1, "startup-integrity-check", "checking", {
            message: "Checking for incomplete documents...",
        });
        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(2, "startup-integrity-check", "result", {
            message: "No size mismatches found",
        });
        expect(noticeGroups.finish).toHaveBeenCalledWith("startup-integrity-check");
    });

    it("finishes the group with a failure result when the scan throws", async () => {
        const { migration, noticeGroups } = createMigration(failedDocumentScan);

        await expect(migration.hasIncompleteDocs()).rejects.toThrow("scan failed");

        expect(noticeGroups.setItem).toHaveBeenLastCalledWith("startup-integrity-check", "result", {
            message: "The incomplete document check could not be completed.",
        });
        expect(noticeGroups.finish).toHaveBeenCalledWith("startup-integrity-check");
    });
});
