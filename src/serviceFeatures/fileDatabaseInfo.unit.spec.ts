import { describe, expect, it, vi } from "vitest";
import {
    buildFileDatabaseInfoReport,
    chooseAndCopyFileDatabaseInfo,
    collectFileDatabaseInfoPaths,
    inspectFileDatabaseInfo,
    readFileDatabaseRevisionLocally,
    retryReadFileDatabaseRevision,
} from "./fileDatabaseInfo";

async function* documents(paths: string[]) {
    for (const path of paths) {
        yield {
            _id: `f:${path}`,
            path,
        };
    }
}

function createCore() {
    const current = {
        _id: "f:note",
        _rev: "3-current",
        _conflicts: ["2-conflict"],
        _revs_info: [
            { rev: "3-current", status: "available" },
            { rev: "2-parent", status: "missing" },
        ],
        path: "note.md",
        ctime: 100,
        mtime: 300,
        size: 42,
        type: "plain",
        datatype: "plain",
        data: "secret current body",
        children: ["h:private-current", "h:private-current", "h:private-embedded", "h:private-deleted"],
        eden: {
            "h:private-embedded": {
                data: "secret embedded body",
                epoch: 1,
            },
        },
    };
    const conflict = {
        ...current,
        _rev: "2-conflict",
        _conflicts: undefined,
        _revs_info: [{ rev: "2-conflict", status: "available" }],
        mtime: 200,
        data: "secret conflict body",
        children: ["h:private-missing"],
        eden: {},
    };
    const promptCopyToClipboard = vi.fn(async (_title: string, _value: string) => true);
    const askSelectString = vi.fn(async () => "db-only.md");
    const core = {
        settings: {
            syncInternalFiles: false,
            syncInternalFilesIgnorePatterns: "",
            syncInternalFilesTargetPatterns: "",
        },
        storageAccess: {
            isExistsIncludeHidden: vi.fn(async () => true),
            statHidden: vi.fn(async () => ({
                ctime: 90,
                mtime: 310,
                size: 45,
                type: "file",
            })),
            getFileNames: vi.fn(async () => ["z.md", "a.md"]),
            getFilesIncludeHidden: vi.fn(async () => [".obsidian/app.json", "a.md"]),
        },
        localDatabase: {
            getDBEntryFromMeta: vi.fn(async (meta: typeof current) => ({
                ...meta,
                data: ["loaded body"],
            })),
            getDBEntry: vi.fn(async () => current),
            localDatabase: {
                get: vi.fn(async (_id: string, options?: { rev?: string }) =>
                    options?.rev === "2-conflict" ? conflict : current
                ),
            },
            allDocsRaw: vi.fn(async ({ keys }: { keys: string[] }) => ({
                rows: [
                    ...(keys.includes("h:private-current")
                        ? [
                              {
                                  id: "h:private-current",
                                  key: "h:private-current",
                                  value: { rev: "1-chunk" },
                              },
                          ]
                        : []),
                    ...(keys.includes("h:private-deleted")
                        ? [
                              {
                                  id: "h:private-deleted",
                                  key: "h:private-deleted",
                                  value: { rev: "4-deleted-chunk", deleted: true },
                              },
                          ]
                        : []),
                ],
            })),
            findAllDocs: vi.fn(() => documents(["db-only.md", "i:.obsidian/app.json", "ix:ignore", "ps:setting"])),
        },
        services: {
            path: {
                path2id: vi.fn(async () => "f:note"),
            },
            UI: {
                promptCopyToClipboard,
                confirm: {
                    askSelectString,
                },
            },
        },
    };
    return {
        askSelectString,
        conflict,
        core,
        current,
        promptCopyToClipboard,
    };
}

describe("file database information", () => {
    it("reports document and chunk revisions without exposing file contents", async () => {
        const { core } = createCore();

        const report = await buildFileDatabaseInfoReport(core as never, "note.md");

        expect(report).toContain('"path": "note.md"');
        expect(report).toContain('"documentId": "f:note"');
        expect(report).toContain('"revision": "3-current"');
        expect(report).toContain('"revision": "2-conflict"');
        expect(report).toContain('"storageType": "plain"');
        expect(report).toContain('"storageLayout": "chunked"');
        expect(report).toContain('"contentAvailableLocally": false');
        expect(report).toContain('"id": "h:private-current"');
        expect(report).toContain('"localDatabaseRevision": "1-chunk"');
        expect(report).toContain('"referenceCount": 2');
        expect(report).toContain('"id": "h:private-embedded"');
        expect(report).toContain('"embedded": true');
        expect(report).toContain('"id": "h:private-deleted"');
        expect(report).toContain('"localDatabaseState": "deleted"');
        expect(report).toContain('"localDatabaseRevision": "4-deleted-chunk"');
        expect(report).toContain('"id": "h:private-missing"');
        expect(report).toContain('"localDatabaseState": "missing"');
        expect(report).toContain('"localDatabaseRevision": null');
        expect(report).not.toContain("secret current body");
        expect(report).not.toContain("secret conflict body");
        expect(report).not.toContain("secret embedded body");
    });

    it.each([
        {
            name: "notes",
            document: {
                type: "notes",
                data: "secret legacy body",
            },
            storageType: "notes",
        },
        {
            name: "an absent type",
            document: {
                type: undefined,
                data: ["secret", " legacy body"],
            },
            storageType: "absent",
        },
    ])("reports $name as legacy inline storage without exposing its body", async ({ document, storageType }) => {
        const { core, current } = createCore();
        core.localDatabase.localDatabase.get.mockResolvedValue({
            ...current,
            ...document,
            _conflicts: [],
            children: ["h:must-not-be-treated-as-a-chunk"],
        } as never);

        const info = await inspectFileDatabaseInfo(core as never, "note.md");
        const report = await buildFileDatabaseInfoReport(core as never, "note.md");

        expect(info.database.revisions).toEqual([
            expect.objectContaining({
                storageType,
                storageLayout: "legacy-inline",
                chunkReferences: 0,
                contentAvailableLocally: true,
            }),
        ]);
        expect(report).not.toContain("secret legacy body");
        expect(report).not.toContain("h:must-not-be-treated-as-a-chunk");
    });

    it("reports the exact shared ancestor and its missing chunks for each conflict", async () => {
        const { conflict, core, current } = createCore();
        const parent = {
            ...current,
            _rev: "2-parent",
            _conflicts: undefined,
            _revs_info: [
                { rev: "2-parent", status: "available" },
                { rev: "1-root", status: "missing" },
            ],
            children: ["h:missing-parent"],
            eden: {},
        };
        core.localDatabase.localDatabase.get.mockImplementation(async (_id: string, options?: { rev?: string }) => {
            if (options?.rev === "2-conflict") {
                return {
                    ...conflict,
                    _revs_info: [
                        { rev: "2-conflict", status: "available" },
                        { rev: "2-parent", status: "available" },
                        { rev: "1-root", status: "missing" },
                    ],
                };
            }
            if (options?.rev === "2-parent") {
                return parent;
            }
            return {
                ...current,
                _revs_info: [
                    { rev: "3-current", status: "available" },
                    { rev: "2-parent", status: "available" },
                    { rev: "1-root", status: "missing" },
                ],
            };
        });

        const info = await inspectFileDatabaseInfo(core as never, "note.md");

        expect(info.database.mergeBases).toEqual([
            {
                winnerRevision: "3-current",
                conflictRevision: "2-conflict",
                revision: "2-parent",
                metadataAvailableLocally: true,
                contentAvailableLocally: false,
                missingChunkIds: ["h:missing-parent"],
                unavailableSharedRevisions: ["1-root"],
            },
        ]);
    });

    it("does not decode a revision whose chunks are not all available locally", async () => {
        const { core } = createCore();

        await expect(readFileDatabaseRevisionLocally(core as never, "note.md", "3-current")).resolves.toBe(false);

        expect(core.localDatabase.getDBEntryFromMeta).not.toHaveBeenCalled();
    });

    it("decodes an exact revision after confirming that every chunk is available locally", async () => {
        const { core, current } = createCore();
        core.localDatabase.localDatabase.get.mockResolvedValue({
            ...current,
            children: ["h:available"],
            eden: {},
        } as never);
        core.localDatabase.allDocsRaw.mockResolvedValue({
            rows: [
                {
                    id: "h:available",
                    key: "h:available",
                    value: { rev: "1-available" },
                },
            ],
        });

        await expect(readFileDatabaseRevisionLocally(core as never, "note.md", "3-current")).resolves.toEqual(
            expect.objectContaining({
                data: ["loaded body"],
            })
        );

        expect(core.localDatabase.getDBEntryFromMeta).toHaveBeenCalledWith(
            expect.objectContaining({
                _rev: "3-current",
            }),
            false,
            false
        );
    });

    it("retries an exact revision through the configured chunk retrieval path", async () => {
        const { core } = createCore();

        await retryReadFileDatabaseRevision(core as never, "note.md", "2-conflict");

        expect(core.localDatabase.getDBEntry).toHaveBeenCalledWith(
            "note.md",
            { rev: "2-conflict" },
            false,
            true,
            true
        );
    });

    it("reports the exact revision as locally available after retry recovers its missing chunk", async () => {
        const { conflict, core } = createCore();
        let recovered = false;
        core.localDatabase.getDBEntry.mockImplementation(async () => {
            recovered = true;
            return conflict as never;
        });
        core.localDatabase.allDocsRaw.mockImplementation(async ({ keys }: { keys: string[] }) => ({
            rows:
                recovered && keys.includes("h:private-missing")
                    ? [
                          {
                              id: "h:private-missing",
                              key: "h:private-missing",
                              value: { rev: "1-recovered" },
                          },
                      ]
                    : [],
        }));

        await expect(
            retryReadFileDatabaseRevision(core as never, "note.md", "2-conflict")
        ).resolves.not.toBe(false);
        const information = await inspectFileDatabaseInfo(core as never, "note.md");

        expect(
            information.database.revisions.find(({ revision }) => revision === "2-conflict")
        ).toEqual(
            expect.objectContaining({
                contentAvailableLocally: true,
                chunks: [
                    expect.objectContaining({
                        id: "h:private-missing",
                        localDatabaseState: "available",
                        localDatabaseRevision: "1-recovered",
                    }),
                ],
            })
        );
    });

    it("keeps the exact revision identifiers when conflict metadata is unavailable", async () => {
        const { conflict, core, current } = createCore();
        core.localDatabase.localDatabase.get.mockImplementation(async (_id: string, options?: { rev?: string }) => {
            if (options?.rev === "2-unavailable") {
                throw Object.assign(new Error("missing"), { status: 404 });
            }
            if (options?.rev === "2-conflict") {
                return conflict;
            }
            return { ...current, _conflicts: ["2-conflict", "2-unavailable"] };
        });

        const report = await buildFileDatabaseInfoReport(core as never, "note.md");

        expect(report).toContain('"conflictRevisions"');
        expect(report).toContain('"2-conflict"');
        expect(report).toContain('"2-unavailable"');
        expect(report).toContain('"unavailableConflictRevisions"');
    });

    it("reads an existing local document even when current synchronisation filters exclude its path", async () => {
        const { core, current } = createCore();
        core.services.path.path2id.mockResolvedValue("f:ignored");
        core.localDatabase.localDatabase.get.mockResolvedValue({
            ...current,
            _id: "f:ignored",
            _rev: "5-ignored",
            _conflicts: [],
            _revs_info: [],
            path: "ignored.md",
            ctime: 10,
            mtime: 20,
            size: 30,
            children: [],
        });

        const report = await buildFileDatabaseInfoReport(core as never, "ignored.md");

        expect(report).toContain('"exists": true');
        expect(report).toContain('"documentId": "f:ignored"');
        expect(report).toContain('"revision": "5-ignored"');
    });

    it("offers the union of storage and database paths and excludes inactive internal namespaces", async () => {
        const { core } = createCore();

        await expect(collectFileDatabaseInfoPaths(core as never)).resolves.toEqual(["a.md", "db-only.md", "z.md"]);

        core.settings.syncInternalFiles = true;
        await expect(collectFileDatabaseInfoPaths(core as never)).resolves.toEqual([
            ".obsidian/app.json",
            "a.md",
            "db-only.md",
        ]);
    });

    it("copies the selected file report through the existing copy dialogue", async () => {
        const { askSelectString, core, promptCopyToClipboard } = createCore();

        await expect(chooseAndCopyFileDatabaseInfo(core as never)).resolves.toBe(true);

        expect(askSelectString).toHaveBeenCalledWith("Choose a file to inspect", ["a.md", "db-only.md", "z.md"]);
        expect(promptCopyToClipboard).toHaveBeenCalledWith(
            "Database information for db-only.md",
            expect.stringContaining('"path": "db-only.md"')
        );
    });
});
