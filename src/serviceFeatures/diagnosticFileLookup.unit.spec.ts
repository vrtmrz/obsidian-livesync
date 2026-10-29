import { createDiagnosticNameMapper } from "@vrtmrz/livesync-commonlib/diagnostics";
import { describe, expect, it, vi } from "vitest";
import { buildPseudonymousFileReport, findDiagnosticFiles, showDiagnosticFileLookup } from "./diagnosticFileLookup";
import type { DiagnosticFileLookupDialogOptions } from "./diagnosticFileLookupTypes";

type TestDocument = {
    _id: string;
    _rev?: string;
    _conflicts?: string[];
    _revs_info?: Array<{ rev: string; status: string }>;
    _deleted?: boolean;
    children?: string[];
    ctime?: number;
    data?: string;
    deleted?: boolean;
    eden?: Record<string, unknown>;
    mtime?: number;
    path?: string;
    size?: number;
    type?: string;
};

async function* entries(documents: TestDocument[]) {
    for (const document of documents) yield document;
}

function createCore(vaultPaths: string[] = [], documents: TestDocument[] = []) {
    const existingPaths = new Set(vaultPaths);
    const chunkRevisions = new Map([["h:secret-chunk", "1-secret-chunk-revision"]]);
    const core = {
        settings: {},
        storageAccess: {
            getFileNames: vi.fn(async () => [...vaultPaths]),
            getFilesIncludeHidden: vi.fn(async () => [...vaultPaths]),
            isExistsIncludeHidden: vi.fn(async (path: string) => existingPaths.has(path)),
            statHidden: vi.fn(async (path: string) =>
                existingPaths.has(path) ? { ctime: 10, mtime: 20, size: 30, type: "file" } : undefined
            ),
        },
        localDatabase: {
            allDocsRaw: vi.fn(async ({ keys }: { keys: string[] }) => ({
                rows: keys.flatMap((key) => {
                    const rev = chunkRevisions.get(key);
                    return rev ? [{ id: key, key, value: { rev } }] : [];
                }),
            })),
            findAllDocs: vi.fn(() => entries(documents)),
            getDBEntryFromMeta: vi.fn(),
            getDBEntry: vi.fn(),
            localDatabase: {
                get: vi.fn(async (id: string) => {
                    const document = documents.find(({ _id }) => _id === id);
                    if (document) return document;
                    throw Object.assign(new Error("missing"), { status: 404 });
                }),
            },
        },
        services: {
            path: { path2id: vi.fn(async () => "f:path-derived") },
            UI: {
                promptCopyToClipboard: vi.fn(async () => true),
                dialogManager: { open: vi.fn() },
            },
        },
    };
    return core;
}

function diagnosticPath(path: string, salt = "salt1234"): string {
    return createDiagnosticNameMapper("pseudonym", salt).path(path);
}

describe("diagnostic file lookup", () => {
    it.each(["metadata", "chunks"] as const)(
        "stops follow-up reads when the dialogue closes during a %s read",
        async (pendingRead) => {
            const path = "cancelled.md";
            const selected = {
                _id: "f:cancelled",
                _rev: "3-current",
                _conflicts: ["3-conflict"],
                path,
                type: "plain",
                children: ["h:secret-chunk"],
            };
            const core = createCore([path], [selected]);
            let markStarted!: () => void;
            const started = new Promise<void>((resolve) => {
                markStarted = resolve;
            });
            let releaseRead!: () => void;
            const pending = new Promise<void>((resolve) => {
                releaseRead = resolve;
            });
            if (pendingRead === "metadata") {
                core.localDatabase.localDatabase.get.mockImplementationOnce(async () => {
                    markStarted();
                    await pending;
                    return selected;
                });
            } else {
                core.localDatabase.allDocsRaw.mockImplementationOnce(async () => {
                    markStarted();
                    await pending;
                    return { rows: [] };
                });
            }
            core.services.UI.dialogManager.open.mockImplementation(async (...args: unknown[]) => {
                const options = args[1] as DiagnosticFileLookupDialogOptions;
                const preparation = options.prepareReport(
                    { path, documentId: selected._id, storageExists: true, source: "metadata" },
                    diagnosticPath(path)
                );
                await started;
                const cancelled = expect(preparation).rejects.toMatchObject({ name: "AbortError" });
                options.cancel();
                releaseRead();
                await cancelled;
            });

            await showDiagnosticFileLookup(core as never);

            expect(core.localDatabase.localDatabase.get).toHaveBeenCalledTimes(1);
            expect(core.localDatabase.allDocsRaw).toHaveBeenCalledTimes(pendingRead === "metadata" ? 0 : 1);
        }
    );

    it("rejects an invalid path token before reading storage or the database", async () => {
        const core = createCore(["note.md"], [{ _id: "f:note", path: "note.md", type: "plain" }]);

        await expect(findDiagnosticFiles(core as never, "not-a-path-token")).resolves.toEqual({
            valid: false,
            status: "invalid",
            processed: 0,
            candidates: [],
        });

        expect(core.storageAccess.getFileNames).not.toHaveBeenCalled();
        expect(core.localDatabase.findAllDocs).not.toHaveBeenCalled();
        expect(core.localDatabase.localDatabase.get).not.toHaveBeenCalled();
    });

    it("matches path spelling exactly without case folding or Unicode normalisation", async () => {
        const decomposed = "Cafe\u0301.md";
        const core = createCore(
            [decomposed, "Café.md", "CAFÉ.md"],
            [
                { _id: "f:decomposed", path: decomposed, type: "plain" },
                { _id: "f:composed", path: "Café.md", type: "plain" },
                { _id: "f:case", path: "CAFÉ.md", type: "plain" },
            ]
        );
        const progressCounts: number[] = [];

        const result = await findDiagnosticFiles(core as never, diagnosticPath(decomposed), {
            onProgress: (processed) => progressCounts.push(processed),
        });

        expect(result).toMatchObject({ valid: true, status: "complete" });
        expect(result.candidates).toEqual([
            expect.objectContaining({
                path: decomposed,
                documentId: "f:decomposed",
                source: "metadata",
                storageExists: true,
            }),
        ]);
        expect(core.localDatabase.localDatabase.get).not.toHaveBeenCalled();
        expect(progressCounts).toEqual([0, 6]);
    });

    it("keeps distinct Metadata documents with the same exact path as separate candidates", async () => {
        const path = "duplicate.md";
        const core = createCore(
            [path],
            [
                { _id: "f:duplicate-one", path, type: "plain" },
                { _id: "f:duplicate-two", path, type: "plain" },
            ]
        );

        const result = await findDiagnosticFiles(core as never, diagnosticPath(path));

        expect(result.candidates).toEqual([
            expect.objectContaining({ documentId: "f:duplicate-one", path, storageExists: true, source: "metadata" }),
            expect.objectContaining({ documentId: "f:duplicate-two", path, storageExists: true, source: "metadata" }),
        ]);
        expect(result.candidates).toHaveLength(2);
    });

    it("keeps logically deleted current file Metadata as an exact candidate", async () => {
        const path = "vault-only.md";
        const core = createCore(
            [path],
            [
                { _id: "f:deleted", path, type: "plain", deleted: true },
                { _id: "f:chunk", path, type: "chunk" },
                { _id: "i:internal", path: "i:.obsidian/config.json", type: "plain" },
            ]
        );

        const result = await findDiagnosticFiles(core as never, diagnosticPath(path));
        expect(result.candidates).toEqual([
            expect.objectContaining({ path, documentId: "f:deleted", storageExists: true, source: "metadata" }),
        ]);
    });

    it("returns a Vault-only candidate when there is no current normal-file Metadata", async () => {
        const path = "vault-only.md";
        const core = createCore(
            [path],
            [
                { _id: "f:chunk", path, type: "chunk" },
                { _id: "f:legacy", path, type: "notes" },
                { _id: "i:internal", path: "i:.obsidian/config.json", type: "plain" },
            ]
        );

        const result = await findDiagnosticFiles(core as never, diagnosticPath(path));
        expect(result.candidates).toEqual([expect.objectContaining({ path, storageExists: true, source: "vault" })]);
        expect(result.candidates[0]).not.toHaveProperty("documentId");

        const report = await buildPseudonymousFileReport(core as never, result.candidates[0], "salt1234");
        const jsonText = report.artifacts.find(({ format }) => format === "json")!.content;
        const json = JSON.parse(jsonText);

        expect(json.file.path).toBe(diagnosticPath(path));
        expect(jsonText).not.toContain(path);
        expect(json.file.database).toEqual({
            source: "local database on this device",
            remoteQueried: false,
            inspected: false,
            reason: "no-local-target",
        });
        expect(json.scope).toEqual({
            source: "local database on this device",
            remoteQueried: false,
            vaultContentRead: false,
            fileContents: "omitted",
            revisions: "current revision, current conflict revisions, and selected merge-base revisions",
            revisionHistory: "status metadata is listed for current and conflict revisions where available",
            historicalFileBodiesScanned: false,
        });
        expect(core.localDatabase.localDatabase.get).not.toHaveBeenCalled();
    });

    it("returns partial exact matches when cancellation arrives during enumeration", async () => {
        const path = "match.md";
        const documents = [
            { _id: "f:match", path, type: "plain" },
            ...Array.from({ length: 299 }, (_, index) => ({
                _id: `f:other-${index}`,
                path: `other-${index}.md`,
                type: "plain",
            })),
        ];
        const core = createCore([], documents);
        const controller = new AbortController();
        const progressCounts: number[] = [];

        const result = await findDiagnosticFiles(core as never, diagnosticPath(path), {
            signal: controller.signal,
            onProgress: (processed) => {
                progressCounts.push(processed);
                if (processed >= 128) controller.abort();
            },
        });

        expect(result).toMatchObject({ valid: true, status: "cancelled", processed: 128 });
        expect(result.candidates).toEqual([
            expect.objectContaining({ documentId: "f:match", path, storageExists: false, source: "metadata" }),
        ]);
        expect(progressCounts).toEqual([0, 128, 128]);
    });

    it("projects an exact target with the token salt, preserves revision generations, and omits raw values", async () => {
        const path = "private-name.md";
        const salt = "salt1234";
        const token = diagnosticPath(path, salt);
        const selected = {
            _id: "f:selected-private-id",
            _rev: "3-private-revision",
            _conflicts: [],
            _revs_info: [{ rev: "3-private-revision", status: "private-status-value" }],
            path,
            ctime: 11,
            mtime: 22,
            size: 33,
            type: "plain",
            data: "private file contents",
            children: ["h:private-chunk-id"],
            eden: {},
            unreported: "private-extra-value",
        };
        const decoy = { ...selected, _id: "f:path-derived", path: "different.md", _rev: "9-decoy-revision" };
        const core = createCore([path], [selected, decoy]);
        core.localDatabase.localDatabase.get.mockImplementation(async (id: string) => {
            if (id === selected._id) return selected;
            if (id === decoy._id) return decoy;
            throw Object.assign(new Error("missing"), { status: 404 });
        });
        const candidate = {
            path,
            databasePath: path as never,
            documentId: selected._id,
            storageExists: true,
            source: "metadata" as const,
        };

        const output = await buildPseudonymousFileReport(core as never, candidate, salt);
        const jsonText = output.artifacts.find(({ format }) => format === "json")!.content;
        const json = JSON.parse(jsonText);
        const revision = json.file.database.revisions[0];

        expect(output.nameMode).toBe("pseudonym");
        expect(json.kind).toBe("file");
        expect(json.nameMode).toBe("pseudonym");
        expect(json.salt).toBe(salt);
        expect(json.file.path).toBe(token);
        expect(json.scope).toMatchObject({ vaultContentRead: false, fileContents: "omitted" });
        expect(revision.documentId).toMatch(/^document-[0-9a-f]{32}$/);
        expect(revision.revision).toMatch(/^3-psu[0-9a-f]{32}$/);
        expect(revision.chunks[0].id).toMatch(/^chunk-[0-9a-f]{32}$/);
        expect(revision.revisionHistory[0].status).toBe("unknown");
        expect(json.file.database.inspected).toBe(true);
        expect(output.artifacts.map(({ format }) => format)).toEqual(["json", "markdown"]);
        expect(output.artifacts.find(({ format }) => format === "markdown")?.content).toContain("```json");
        expect(jsonText).not.toContain(path);
        expect(jsonText).not.toContain(selected._id);
        expect(jsonText).not.toContain("3-private-revision");
        expect(jsonText).not.toContain("h:private-chunk-id");
        expect(jsonText).not.toContain("private-status-value");
        expect(jsonText).not.toContain("private file contents");
        expect(jsonText).not.toContain("private-extra-value");
        expect(core.localDatabase.localDatabase.get.mock.calls.map(([id]) => id)).toEqual([selected._id]);
        expect(core.services.path.path2id).not.toHaveBeenCalled();
    });

    it("keeps an exact Metadata target visibly missing without substituting a path-derived document", async () => {
        const path = "vanished.md";
        const salt = "salt1234";
        const selected = { _id: "f:vanished", path, type: "plain" };
        const decoy = { _id: "f:path-derived", path: "wrong.md", type: "plain", _rev: "1-decoy" };
        const core = createCore([path], [selected, decoy]);
        const lookup = await findDiagnosticFiles(core as never, diagnosticPath(path, salt));
        core.localDatabase.localDatabase.get.mockImplementation(async (id: string) => {
            if (id === decoy._id) return decoy;
            throw Object.assign(new Error("missing"), { status: 404 });
        });

        const output = await buildPseudonymousFileReport(core as never, lookup.candidates[0], salt);
        const jsonText = output.artifacts.find(({ format }) => format === "json")!.content;
        const json = JSON.parse(jsonText);

        expect(json.file.database).toMatchObject({ inspected: true, exists: false });
        expect(json.file.database.documentId).toMatch(/^document-[0-9a-f]{32}$/);
        expect(jsonText).not.toContain("f:vanished");
        expect(jsonText).not.toContain("f:path-derived");
        expect(core.localDatabase.localDatabase.get.mock.calls.map(([id]) => id)).toEqual([selected._id]);
        expect(core.services.path.path2id).not.toHaveBeenCalled();
    });
});
