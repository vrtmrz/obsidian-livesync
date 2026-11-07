import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
PouchDB.plugin(MemoryAdapter);
import { describe, expect, it, vi } from "vitest";
import { discardLiveBranch, discardUnreadableLiveRevision, inspectFileRepair, repairRevisionSize } from "./fileRepair";

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
        deleted: false,
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
            putRaw: vi.fn(async (_doc: unknown) => ({ ok: true, id: "f:note", rev: "4-repaired" })),
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
    it("reports a size-only mismatch even when Vault bytes match", async () => {
        const { core, current } = createCore();
        current._conflicts = [];
        current.size = 45;
        expect((await inspectFileRepair(core as never, "note.md")).requiresAttention).toBe(true);
    });

    it("omits matching bytes with correct size despite differing timestamps", async () => {
        const { core, current } = createCore();
        current._conflicts = [];
        current.mtime = 9000;
        expect((await inspectFileRepair(core as never, "note.md")).requiresAttention).toBe(false);
    });

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

    it("omits a logical deletion which already matches an absent Vault file", async () => {
        const { core, current } = createCore();
        current.deleted = true;
        current._conflicts = [];
        current.children = [];
        core.storageAccess.isExistsIncludeHidden.mockResolvedValue(false);
        core.storageAccess.statHidden.mockResolvedValue(null as never);

        const inspection = await inspectFileRepair(core as never, "note.md");

        expect(inspection.revisions).toEqual([
            expect.objectContaining({
                role: "winner",
                contentReadable: true,
                metadata: expect.objectContaining({
                    deleted: true,
                    revision: "3-current",
                }),
            }),
        ]);
        expect(inspection.requiresAttention).toBe(false);
    });

    it("rechecks liveness and readability before discarding an exact revision", async () => {
        const { core, deleteRevisionFromDB } = createCore();

        await expect(discardUnreadableLiveRevision(core as never, "note.md", "2-conflict")).resolves.toBe("discarded");
        await expect(discardUnreadableLiveRevision(core as never, "note.md", "3-current")).resolves.toBe(
            "revision-is-readable"
        );

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
        await expect(discardUnreadableLiveRevision(core as never, "note.md", "1-root")).resolves.toBe("discarded");
        expect(deleteRevisionFromDB).toHaveBeenCalledWith("note.md", "1-root");
    });

    it("refuses to discard a revision which stopped being a live leaf", async () => {
        const { core, current, deleteRevisionFromDB } = createCore();
        core.localDatabase.localDatabase.get.mockResolvedValue({
            ...current,
            _conflicts: [],
        });

        await expect(discardUnreadableLiveRevision(core as never, "note.md", "2-conflict")).resolves.toBe(
            "no-longer-live"
        );

        expect(deleteRevisionFromDB).not.toHaveBeenCalled();
    });

    it("discards an exact readable winner while another live branch remains", async () => {
        const { core, deleteRevisionFromDB } = createCore();

        await expect(discardLiveBranch(core as never, "note.md", "3-current")).resolves.toBe("discarded");

        expect(deleteRevisionFromDB).toHaveBeenCalledWith("note.md", "3-current");
    });

    it("refuses to discard the only live branch", async () => {
        const { core, current, deleteRevisionFromDB } = createCore();
        current._conflicts = [];

        await expect(discardLiveBranch(core as never, "note.md", "3-current")).resolves.toBe("only-live-revision");

        expect(deleteRevisionFromDB).not.toHaveBeenCalled();
    });

    it("refuses to discard a branch which is no longer live", async () => {
        const { core, deleteRevisionFromDB } = createCore();

        await expect(discardLiveBranch(core as never, "note.md", "1-stale")).resolves.toBe("no-longer-live");

        expect(deleteRevisionFromDB).not.toHaveBeenCalled();
    });
});

describe("recorded size repair", () => {
    function repairFixture() {
        const fixture = createCore();
        fixture.current._conflicts = [];
        fixture.current.size = 45;
        return fixture;
    }
    it("writes a child changing only size and omitting response metadata", async () => {
        const { core, current } = repairFixture();
        expect(await repairRevisionSize(core as never, "note.md", current._rev)).toBe("repaired");
        const corrected = core.localDatabase.putRaw.mock.calls[0][0];
        const expected = { ...current, size: 7 } as Partial<typeof current>;
        delete expected._conflicts;
        delete expected._revs_info;
        expect(corrected).toEqual(expected);
    });
    it.each(["conflict", "different-body", "missing-chunk", "deleted", "absent-vault"])("refuses %s", async (state) => {
        const { core, current } = repairFixture();
        if (state === "conflict") current._conflicts = ["2-conflict"];
        if (state === "different-body")
            core.storageAccess.readHiddenFileBinary.mockResolvedValue(new TextEncoder().encode("edit").buffer);
        if (state === "missing-chunk") core.localDatabase.allDocsRaw.mockResolvedValue({ rows: [] });
        if (state === "deleted") current.deleted = true;
        if (state === "absent-vault") core.storageAccess.isExistsIncludeHidden.mockResolvedValue(false);
        expect(await repairRevisionSize(core as never, "note.md", current._rev)).toBe("unsafe");
        expect(core.localDatabase.putRaw).not.toHaveBeenCalled();
    });
    it("refuses a selected revision replaced before inspection", async () => {
        const { core } = repairFixture();
        expect(await repairRevisionSize(core as never, "note.md", "2-old")).toBe("stale");
        expect(core.localDatabase.putRaw).not.toHaveBeenCalled();
    });
    it("refuses a revision advancing between inspection and final metadata read", async () => {
        const { core, current } = repairFixture();
        const read = core.localDatabase.localDatabase.get;
        read.mockResolvedValueOnce(current)
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce({ ...current, _rev: "4-advanced" });
        expect(await repairRevisionSize(core as never, "note.md", current._rev)).toBe("stale");
        expect(core.localDatabase.putRaw).not.toHaveBeenCalled();
    });
    it("refuses a Vault edit after inspection", async () => {
        const { core, current } = repairFixture();
        core.storageAccess.readHiddenFileBinary
            .mockResolvedValueOnce(new TextEncoder().encode("current").buffer)
            .mockResolvedValueOnce(new TextEncoder().encode("new edit").buffer);
        expect(await repairRevisionSize(core as never, "note.md", current._rev)).toBe("unsafe");
        expect(core.localDatabase.putRaw).not.toHaveBeenCalled();
    });
    it("treats a document removed after inspection as stale", async () => {
        const { core, current } = repairFixture();
        core.localDatabase.localDatabase.get
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce(current)
            .mockRejectedValueOnce({ status: 404 });
        expect(await repairRevisionSize(core as never, "note.md", current._rev)).toBe("stale");
        expect(core.localDatabase.putRaw).not.toHaveBeenCalled();
    });
    it("refuses advancement during the last Vault read through CAS", async () => {
        const { core, current } = repairFixture();
        core.localDatabase.putRaw.mockRejectedValue({ status: 409 });
        expect(await repairRevisionSize(core as never, "note.md", current._rev)).toBe("stale");
    });
    it("does not repeat a correction or change mtime for matching content", async () => {
        const { core, current } = repairFixture();
        current.size = 7;
        expect(await repairRevisionSize(core as never, "note.md", current._rev)).toBe("unchanged");
        expect(core.localDatabase.putRaw).not.toHaveBeenCalled();
    });
});

describe("size repair revision ancestry", () => {
    it("preserves metadata and chunks in a real PouchDB child and is idempotent", async () => {
        const { core, current } = createCore();
        const database = new PouchDB(`size-repair-${crypto.randomUUID()}`, { adapter: "memory" });
        try {
            const metadata = { ...current } as Partial<typeof current> & { _id: string };
            delete metadata._rev;
            delete metadata._conflicts;
            delete metadata._revs_info;
            const stored = await database.put({ ...metadata, size: 45 });
            core.localDatabase.localDatabase = database as never;
            core.localDatabase.putRaw.mockImplementation((doc) => database.put(doc as never));
            core.localDatabase.getDBEntryFromMeta.mockImplementation(async (meta) => ({ ...meta, data: ["current"] }));
            expect(await repairRevisionSize(core as never, "note.md", stored.rev)).toBe("repaired");
            const corrected = (await database.get(current._id, { revs: true })) as typeof current & {
                _revisions: { ids: string[] };
            };
            expect(corrected.size).toBe(7);
            expect(corrected.children).toEqual(current.children);
            expect(corrected.ctime).toBe(current.ctime);
            expect(corrected.mtime).toBe(current.mtime);
            expect(corrected.path).toBe(current.path);
            expect(corrected).not.toHaveProperty("data");
            expect(corrected._revisions.ids[1]).toBe(stored.rev.split("-")[1]);
            expect(await repairRevisionSize(core as never, "note.md", corrected._rev)).toBe("unchanged");
            expect((await inspectFileRepair(core as never, "note.md")).requiresAttention).toBe(false);
            expect(core.localDatabase.putRaw).toHaveBeenCalledOnce();
        } finally {
            await database.destroy();
        }
    });
});
