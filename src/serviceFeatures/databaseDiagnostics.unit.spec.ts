import { describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

const diagnosticsMocks = vi.hoisted(() => ({ analyseOptions: vi.fn() }));

vi.mock("@vrtmrz/livesync-commonlib/diagnostics", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/diagnostics")>();
    return {
        ...actual,
        analyseDatabaseIntegrity: (options: Parameters<typeof actual.analyseDatabaseIntegrity>[0]) => {
            diagnosticsMocks.analyseOptions(options);
            return actual.analyseDatabaseIntegrity(options);
        },
    };
});

import { readDiagnosticStorage, runDatabaseDiagnostic, type DatabaseDiagnosticHost } from "./databaseDiagnostics";

function fixture() {
    const path = "Private/日本語.md";
    const body = "private file contents";
    const bytes = new TextEncoder().encode(body);
    const settings: ObsidianLiveSyncSettings = {
        ...DEFAULT_SETTINGS,
        remoteType: REMOTE_P2P,
        readChunksOnline: true,
        passphrase: "private encryption passphrase",
        couchDB_PASSWORD: "private credential",
        couchDB_URI: "https://private-server.invalid",
    };
    const documents = {
        "f:private-actual-id": {
            _id: "f:private-actual-id",
            _rev: "1-private-revision",
            _revs_info: [{ rev: "1-private-revision", status: "available" }],
            type: "plain",
            path,
            ctime: 1,
            mtime: 1,
            size: bytes.byteLength,
            children: ["h:private-chunk"],
        },
        "h:private-chunk": {
            _id: "h:private-chunk",
            _rev: "1-private-chunk-revision",
            _revs_info: [{ rev: "1-private-chunk-revision", status: "available" }],
            type: "leaf",
            data: body,
        },
    };
    const get = vi.fn(async (id: string) => {
        const doc = documents[id as keyof typeof documents];
        if (!doc) throw { status: 404 };
        return structuredClone(doc);
    });
    const info = vi.fn(async () => ({ update_seq: "1-stable" }));
    const put = vi.fn(() => {
        throw new Error("Diagnostic attempted a write");
    });
    const applyPartial = vi.fn();
    const fetch = vi.fn();
    const storage = {
        statHidden: vi.fn(async () => ({ type: "file" as const, ctime: 1, mtime: 1, size: bytes.byteLength })),
        readHiddenFileBinary: vi.fn(async () => bytes.buffer),
    };
    const host = {
        services: {
            setting: { currentSettings: () => settings, applyPartial },
            database: {
                localDatabase: {
                    localDatabase: {
                        info,
                        get,
                        put,
                        allDocs: vi.fn(async () => ({
                            rows: Object.keys(documents).map((id) => ({ id, value: { rev: "1-current" } })),
                        })),
                    },
                },
            },
            path: {
                getPath: (doc: { path: string }) => doc.path,
                path2idWithSettings: vi.fn(async (rawPath: string) => `f:expected:${rawPath}`),
            },
            API: {
                webCompatFetch: fetch,
                nativeFetch: fetch,
                getPluginVersion: () => "1.0.38",
                getAppVersion: () => "1.12.7",
            },
        },
        serviceModules: { storageAccess: storage },
    } as unknown as DatabaseDiagnosticHost;
    return { host, settings, path, body, bytes, get, info, put, applyPartial, fetch, storage };
}

describe("database diagnostic host composition", () => {
    it("passes growing Usage totals and the separate accounting phase to the dialogue", async () => {
        const onProgress = vi.fn();
        await runDatabaseDiagnostic(fixture().host, "usage", "pseudonym", { onProgress });
        const progress = onProgress.mock.calls.map(([value]) => value);
        expect(progress).toContainEqual(
            expect.objectContaining({
                phase: "usage",
                processed: 0,
                total: 0,
                totalIsFinal: false,
            })
        );
        expect(progress).toContainEqual(
            expect.objectContaining({
                phase: "usage",
                processed: 2,
                total: 2,
                totalIsFinal: true,
            })
        );
        const accounting = progress.filter((value) => value.phase === "accounting");
        expect(accounting.length).toBeGreaterThan(1);
        const final = accounting[accounting.length - 1];
        expect(final).toMatchObject({ processed: final.total, totalIsFinal: true });
    });

    it("preserves phase, source, and totals for the inspection dialogue", async () => {
        const onProgress = vi.fn();
        await runDatabaseDiagnostic(fixture().host, "integrity", "pseudonym", { onProgress });
        expect(onProgress).toHaveBeenCalledWith(
            expect.objectContaining({ phase: "metadata", source: "local", processed: 0 })
        );
        expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: "content", processed: 1, total: 1 }));
    });

    it("keeps on-demand fetching enabled while analysing only existing local revisions", async () => {
        const data = fixture();
        const before = JSON.stringify(data.settings);
        const result = await runDatabaseDiagnostic(data.host, "usage", "pseudonym");
        expect(result.status).toBe("complete");
        expect(result.artifacts.map((artifact) => artifact.format)).toEqual(["tsv", "json"]);
        expect(data.settings.readChunksOnline).toBe(true);
        expect(JSON.stringify(data.settings)).toBe(before);
        expect(data.applyPartial).not.toHaveBeenCalled();
        expect(data.fetch).not.toHaveBeenCalled();
        expect(data.put).not.toHaveBeenCalled();
        expect(data.get).toHaveBeenCalledWith("f:private-actual-id", { rev: "1-private-revision" });
        const report = JSON.parse(result.artifacts.find((artifact) => artifact.format === "json")!.content);
        expect(report.versions).toMatchObject({ plugin: "1.0.38", application: "1.12.7" });
        expect(report.versions.commonlib).toMatch(/^\d+\.\d+\.\d+/);
        for (const artifact of result.artifacts) {
            for (const secret of [
                data.path,
                data.body,
                data.settings.passphrase,
                "private-actual-id",
                "private-revision",
                "private-server.invalid",
            ]) {
                expect(artifact.content).not.toContain(secret);
            }
        }
    });

    it("keeps local findings when the remote type is unsupported and projects both formats consistently", async () => {
        const data = fixture();
        const result = await runDatabaseDiagnostic(data.host, "integrity", "pseudonym");
        expect(diagnosticsMocks.analyseOptions).toHaveBeenLastCalledWith(
            expect.objectContaining({ includeRemote: true })
        );
        expect(result.status).toBe("partial");
        expect(data.fetch).not.toHaveBeenCalled();
        expect(data.put).not.toHaveBeenCalled();
        expect(data.storage.readHiddenFileBinary).toHaveBeenCalledWith(data.path);
        const json = JSON.parse(result.artifacts.find((artifact) => artifact.format === "json")!.content);
        expect(json.errors).toContainEqual({ source: "remote", reason: "unsupported-remote" });
        expect(json.observations[0]).toMatchObject({
            identity: "document-id-mismatch",
            content: { status: "available" },
        });
        expect(json.observations[0].comparisons).toContainEqual({
            against: json.observations[0].vault.reference,
            relation: "equal",
        });
        for (const artifact of result.artifacts) {
            expect(artifact.content).toContain(json.observations[0].path);
            expect(artifact.content).not.toContain(data.path);
            expect(artifact.content).not.toContain(data.body);
            expect(artifact.content).not.toContain(data.settings.passphrase);
        }
    });

    it("excludes the remote source for a local integrity run", async () => {
        const data = fixture();
        data.settings.remoteType = REMOTE_COUCHDB;
        data.settings.couchDB_DBNAME = "private-database";
        data.settings.useRequestAPI = true;
        data.fetch
            .mockImplementationOnce(async () => {
                await new Promise((resolve) => setTimeout(resolve, 2));
                return { ok: false, status: 503 } as Response;
            })
            .mockRejectedValue(new Error("simulated diagnostic request failure"));

        diagnosticsMocks.analyseOptions.mockClear();
        const result = await runDatabaseDiagnostic(data.host, "integrity", "pseudonym", {
            includeRemote: false,
        });

        expect(data.fetch).not.toHaveBeenCalled();
        const passedOptions = diagnosticsMocks.analyseOptions.mock.calls[0][0];
        expect(passedOptions.includeRemote).toBe(false);
        expect(passedOptions.remote).toBeUndefined();
        expect(result.artifacts.map((artifact) => artifact.format)).toEqual(["markdown", "json"]);
        const report = JSON.parse(result.artifacts.find((artifact) => artifact.format === "json")!.content);
        expect(report.scope.remote).toBe("excluded");
        expect(report.coverage.remote.status).toBe("not-checked");
        expect(report.errors.some((error: { source: string }) => error.source === "remote")).toBe(false);
    });

    it("logs cumulative HTTP dispatch, failure, and duration counters for remote inspection", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        try {
            const nonOk = fixture();
            nonOk.settings.remoteType = REMOTE_COUCHDB;
            nonOk.settings.couchDB_DBNAME = "private-database";
            nonOk.settings.useRequestAPI = true;
            nonOk.fetch.mockImplementation(async () => {
                await new Promise((resolve) => setTimeout(resolve, 2));
                return { ok: false, status: 503 } as Response;
            });
            await runDatabaseDiagnostic(nonOk.host, "integrity", "pseudonym");

            const thrown = fixture();
            thrown.settings.remoteType = REMOTE_COUCHDB;
            thrown.settings.couchDB_DBNAME = "private-database";
            thrown.settings.useRequestAPI = true;
            thrown.fetch.mockRejectedValue(new Error("simulated diagnostic request failure"));
            await runDatabaseDiagnostic(thrown.host, "integrity", "pseudonym");

            const messages = log.mock.calls.map(([message]) => String(message));
            const inspectionLogs = messages.filter((message) => message.includes("Database integrity inspection:"));
            expect(inspectionLogs.length).toBeGreaterThan(0);
            const inspectionEvents = inspectionLogs.map((message) => {
                const json = message.slice(message.indexOf("{"));
                return JSON.parse(json);
            });
            expect(inspectionEvents.some((event) => event.httpRequests > 0)).toBe(true);
            expect(inspectionEvents.some((event) => event.httpFailedRequests > 0)).toBe(true);
            expect(inspectionEvents.every((event) => typeof event.httpRequestDurationMs === "number")).toBe(true);

            const summaries = messages.filter((message) => message.includes("Database integrity report:"));
            expect(summaries).toHaveLength(2);
            for (const [index, summary] of summaries.entries()) {
                const match = /httpRequests=(\d+), httpFailedRequests=(\d+), httpRequestDurationMs=(\d+)/.exec(summary);
                expect(match).not.toBeNull();
                const data = index === 0 ? nonOk : thrown;
                expect(Number(match![1])).toBe(data.fetch.mock.calls.length);
                expect(Number(match![2])).toBe(data.fetch.mock.calls.length);
                expect(Number(match![3])).toBeGreaterThanOrEqual(0);
                if (index === 0) expect(Number(match![3])).toBeGreaterThan(0);
            }
        } finally {
            log.mockRestore();
        }
    });

    it("includes names only when requested and never includes credentials or file contents", async () => {
        const data = fixture();
        const result = await runDatabaseDiagnostic(data.host, "usage", "original");
        for (const artifact of result.artifacts) {
            expect(artifact.content).toContain(data.path);
            expect(artifact.content).toContain("f:private-actual-id");
            expect(artifact.content).not.toContain(data.body);
            expect(artifact.content).not.toContain(data.settings.couchDB_PASSWORD);
            expect(artifact.content).not.toContain(data.settings.couchDB_URI);
        }
    });

    it("retains cancellation and configuration changes in JSON instead of presenting a complete TSV", async () => {
        const cancelled = fixture();
        const controller = new AbortController();
        controller.abort();
        const stopped = await runDatabaseDiagnostic(cancelled.host, "usage", "pseudonym", {
            signal: controller.signal,
        });
        expect(stopped.status).toBe("cancelled");
        expect(stopped.artifacts.map((artifact) => artifact.format)).toEqual(["json"]);
        expect(cancelled.get).not.toHaveBeenCalled();

        const changed = fixture();
        changed.info.mockImplementationOnce(async () => ({ update_seq: "1-stable" }));
        changed.info.mockImplementationOnce(async () => {
            changed.settings.couchDB_URI = "https://changed.invalid";
            return { update_seq: "1-stable" };
        });
        const output = await runDatabaseDiagnostic(changed.host, "usage", "original");
        expect(output.status).toBe("partial");
        expect(output.artifacts.map((artifact) => artifact.format)).toEqual(["json"]);
        expect(JSON.parse(output.artifacts[0].content).errors).toContainEqual({ code: "configuration_changed" });
    });
});

describe("diagnostic Vault reads", () => {
    it("reuses the validated snapshot timestamp without adding stat or content reads", async () => {
        const data = fixture();
        expect(await readDiagnosticStorage(data.storage, data.path)).toEqual({
            status: "available",
            bytes: data.bytes,
            mtime: 1,
        });
        expect(data.storage.statHidden).toHaveBeenCalledTimes(2);
        expect(data.storage.readHiddenFileBinary).toHaveBeenCalledTimes(1);
    });

    it("distinguishes an absent file, a read error, and a file changing during its read", async () => {
        const data = fixture();
        data.storage.statHidden.mockResolvedValueOnce(null as never);
        expect(await readDiagnosticStorage(data.storage, data.path)).toEqual({ status: "missing" });
        data.storage.readHiddenFileBinary.mockRejectedValueOnce(new Error("private filename and content"));
        expect(await readDiagnosticStorage(data.storage, data.path)).toEqual({
            status: "unreadable",
            reason: "content-unreadable",
        });
        data.storage.statHidden.mockResolvedValueOnce({
            type: "file",
            ctime: 1,
            mtime: 1,
            size: data.bytes.byteLength,
        });
        data.storage.statHidden.mockResolvedValueOnce({
            type: "file",
            ctime: 1,
            mtime: 2,
            size: data.bytes.byteLength,
        });
        expect(await readDiagnosticStorage(data.storage, data.path)).toEqual({
            status: "unreadable",
            reason: "storage-changed",
        });
    });

    it("rejects paths outside the Vault before touching storage", async () => {
        const data = fixture();
        for (const path of ["../private", "/private", "C:\\private", "x/../private", "x\0y"]) {
            expect(await readDiagnosticStorage(data.storage, path)).toEqual({
                status: "unreadable",
                reason: "content-unreadable",
            });
        }
        expect(data.storage.statHidden).not.toHaveBeenCalled();
        expect(data.storage.readHiddenFileBinary).not.toHaveBeenCalled();
    });
});
