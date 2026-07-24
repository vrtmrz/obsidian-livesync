import { describe, expect, it, vi } from "vitest";
import {
    discardUnreadableLiveRevision,
    inspectFileRepair,
} from "./fileRepair";

function createCore() {
    const current = {
        _id: "f:note",
        _rev: "3-current",
        _conflicts: ["2-conflict"],
        _revs_info: [{ rev: "3-current", status: "available" }],
        path: "note.md",
        ctime: 1,
        mtime: 3,
        size: 7,
        type: "plain",
        children: ["h:current"],
        eden: {},
    };
    const conflict = {
        ...current,
        _rev: "2-conflict",
        _conflicts: undefined,
        _revs_info: [{ rev: "2-conflict", status: "available" }],
        mtime: 2,
        children: ["h:missing-conflict"],
    };
    const deleteRevisionFromDB = vi.fn(async () => true);
    const core = {
        settings: {
            syncInternalFiles: false,
            syncInternalFilesIgnorePatterns: "",
            syncInternalFilesTargetPatterns: "",
        },
        storageAccess: {
            isExistsIncludeHidden: vi.fn(async () => true),
            statHidden: vi.fn(async () => ({
                ctime: 1,
                mtime: 3,
                size: 7,
                type: "file",
            })),
            readHiddenFileBinary: vi.fn(async () => new TextEncoder().encode("current").buffer),
            getFileNames: vi.fn(async () => ["note.md"]),
            getFilesIncludeHidden: vi.fn(async () => ["note.md"]),
        },
        localDatabase: {
            localDatabase: {
                get: vi.fn(async (_id: string, options?: { rev?: string }) =>
                    options?.rev === "2-conflict" ? conflict : current
                ),
            },
            allDocsRaw: vi.fn(async ({ keys }: { keys: string[] }) => ({
                rows: keys.includes("h:current")
                    ? [
                          {
                              id: "h:current",
                              key: "h:current",
                              value: { rev: "1-current" },
                          },
                      ]
                    : [],
            })),
            getDBEntryFromMeta: vi.fn(async (meta: typeof current) => ({
                ...meta,
                data: [meta._rev === "3-current" ? "current" : "conflict"],
            })),
            getDBEntry: vi.fn(async () => false),
            findAllDocs: vi.fn(async function* () {
                yield current;
            }),
        },
        fileHandler: {
            deleteRevisionFromDB,
        },
        services: {
            path: {
                path2id: vi.fn(async () => "f:note"),
            },
            UI: {
                confirm: {},
            },
        },
    };
    return {
        conflict,
        core,
        current,
        deleteRevisionFromDB,
    };
}

describe("file repair inspection", () => {
    it("shows the winner and every conflict revision independently", async () => {
        const { core } = createCore();

        const inspection = await inspectFileRepair(core as never, "note.md");

        expect(inspection.revisions).toEqual([
            expect.objectContaining({
                role: "winner",
                contentReadable: true,
                contentMatchesStorage: true,
                metadata: expect.objectContaining({
                    revision: "3-current",
                }),
            }),
            expect.objectContaining({
                role: "conflict",
                contentReadable: false,
                contentMatchesStorage: null,
                metadata: expect.objectContaining({
                    revision: "2-conflict",
                }),
            }),
        ]);
        expect(inspection.requiresAttention).toBe(true);
    });

    it("rechecks liveness and readability before discarding an exact revision", async () => {
        const { core, deleteRevisionFromDB } = createCore();

        await expect(
            discardUnreadableLiveRevision(core as never, "note.md", "2-conflict")
        ).resolves.toBe("discarded");
        await expect(
            discardUnreadableLiveRevision(core as never, "note.md", "3-current")
        ).resolves.toBe("revision-is-readable");

        expect(deleteRevisionFromDB).toHaveBeenCalledOnce();
        expect(deleteRevisionFromDB).toHaveBeenCalledWith("note.md", "2-conflict");
    });

    it("allows an exact unreadable generation-one winner to be discarded explicitly", async () => {
        const { core, current, deleteRevisionFromDB } = createCore();
        current._rev = "1-root";
        current._conflicts = [];
        current.children = ["h:missing-root"];
        core.localDatabase.allDocsRaw.mockResolvedValue({ rows: [] });

        const inspection = await inspectFileRepair(core as never, "note.md");

        expect(inspection.revisions).toEqual([
            expect.objectContaining({
                role: "winner",
                contentReadable: false,
                metadata: expect.objectContaining({
                    revision: "1-root",
                }),
            }),
        ]);
        await expect(
            discardUnreadableLiveRevision(core as never, "note.md", "1-root")
        ).resolves.toBe("discarded");
        expect(deleteRevisionFromDB).toHaveBeenCalledWith("note.md", "1-root");
    });

    it("refuses to discard a revision which stopped being a live leaf", async () => {
        const { core, current, deleteRevisionFromDB } = createCore();
        core.localDatabase.localDatabase.get.mockResolvedValue({
            ...current,
            _conflicts: [],
        });

        await expect(
            discardUnreadableLiveRevision(core as never, "note.md", "2-conflict")
        ).resolves.toBe("no-longer-live");

        expect(deleteRevisionFromDB).not.toHaveBeenCalled();
    });
});
