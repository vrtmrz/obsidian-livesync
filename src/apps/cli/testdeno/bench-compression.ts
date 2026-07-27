import { join } from "@std/path";
import { TempDir } from "./helpers/temp.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { assertFilesEqual } from "./helpers/cli.ts";
import { runMeasuredCliOrFail, type CliProcessMeasurement } from "./helpers/measuredCli.ts";
import { createCouchdbDatabase, startCouchdb, stopCouchdb } from "./helpers/docker.ts";
import {
    createCompressionBenchmarkDataset,
    type CompressionDataset,
    type CompressionDatasetEntry,
} from "./helpers/compressionDataset.ts";
import { computeDatasetDigestSha256 } from "./helpers/benchmarkVerification.ts";
import { startCouchdbProxy, type CouchdbProxyCounters } from "./bench-couchdb.ts";
import type { DatasetKind } from "./helpers/dataset.ts";

type CompressionCondition = {
    name: string;
    encrypt: boolean;
    enableCompression: boolean;
};

type CouchDbSizes = {
    file: number;
    external: number;
    active: number;
};

type PerKindRemoteMeasurement = {
    sourceFiles: number;
    sourceBytes: number;
    mappedFiles: number;
    uniqueReferencedChunks: number;
    storedChunkDataBytes: number;
    storedChunkJsonBytes: number;
};

type RemoteMeasurement = {
    couchdbSizes: CouchDbSizes;
    documentCount: number;
    chunkDocumentCount: number;
    metadataDocumentCount: number;
    compressedMarkerCount: number;
    encryptedChunkCount: number;
    storedChunkDataBytes: number;
    storedChunkJsonBytes: number;
    perKind: Record<DatasetKind, PerKindRemoteMeasurement>;
};

type RunResult = {
    condition: CompressionCondition;
    repeatIndex: number;
    executionOrder: number;
    databaseName: string;
    datasetDigestSha256: string;
    dataset: {
        totalFiles: number;
        totalBytes: number;
        filesByKind: CompressionDataset["filesByKind"];
        bytesByKind: CompressionDataset["bytesByKind"];
        jpegGenerator: string;
    };
    effectiveSettings: Record<string, unknown>;
    mirror: CliProcessMeasurement;
    upload: CliProcessMeasurement & { http: CouchdbProxyCounters };
    download: CliProcessMeasurement & { http: CouchdbProxyCounters };
    materialisation: CliProcessMeasurement & { http: CouchdbProxyCounters };
    verification: {
        verifiedFiles: number;
        complete: boolean;
    };
    remote: RemoteMeasurement;
};

const CONDITIONS: CompressionCondition[] = [
    { name: "plain", encrypt: false, enableCompression: false },
    { name: "plain-compressed", encrypt: false, enableCompression: true },
    { name: "e2ee", encrypt: true, enableCompression: false },
    { name: "e2ee-compressed", encrypt: true, enableCompression: true },
];

const DATASET_KINDS: DatasetKind[] = ["md", "jpg", "png", "json", "ts", "gz", "bin"];
const COMPRESSED_MARKER = "\u000eLZ\u001d";

function readEnvString(name: string, fallback: string): string {
    const value = Deno.env.get(name)?.trim();
    return value ? value : fallback;
}

function readEnvPositiveInteger(name: string, fallback: number): number {
    const raw = Deno.env.get(name)?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer, got '${raw}'`);
    }
    return value;
}

function readEnvPositiveNumber(name: string, fallback: number): number {
    const raw = Deno.env.get(name)?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be positive, got '${raw}'`);
    }
    return value;
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
    const raw = Deno.env.get(name)?.trim();
    if (!raw) return fallback;
    return /^(1|true|yes|on)$/i.test(raw);
}

function byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value: number): number {
    return Number(value.toFixed(4));
}

function deltaPercent(enabled: number, disabled: number): number | null {
    if (disabled === 0) return null;
    return rounded(((enabled - disabled) / disabled) * 100);
}

function reductionPercent(enabled: number, disabled: number): number | null {
    if (disabled === 0) return null;
    return rounded((1 - enabled / disabled) * 100);
}

function basicAuth(user: string, password: string): string {
    return `Basic ${btoa(`${user}:${password}`)}`;
}

async function couchRequest(
    baseUri: string,
    user: string,
    password: string,
    path: string,
    init: RequestInit = {},
    allowedStatuses: number[] = []
): Promise<Response> {
    const response = await fetch(`${baseUri.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
            Authorization: basicAuth(user, password),
            ...(init.method === "POST" || init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
        },
    });
    if (!response.ok && !allowedStatuses.includes(response.status)) {
        throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
    }
    return response;
}

async function deleteDatabase(baseUri: string, user: string, password: string, databaseName: string): Promise<void> {
    const response = await couchRequest(
        baseUri,
        user,
        password,
        `/${encodeURIComponent(databaseName)}`,
        { method: "DELETE" },
        [404]
    );
    await response.body?.cancel().catch(() => {});
}

function blankPerKind(dataset: CompressionDataset): Record<DatasetKind, PerKindRemoteMeasurement> {
    return Object.fromEntries(
        DATASET_KINDS.map((kind) => [
            kind,
            {
                sourceFiles: dataset.filesByKind[kind],
                sourceBytes: dataset.bytesByKind[kind],
                mappedFiles: 0,
                uniqueReferencedChunks: 0,
                storedChunkDataBytes: 0,
                storedChunkJsonBytes: 0,
            },
        ])
    ) as Record<DatasetKind, PerKindRemoteMeasurement>;
}

function findDatasetEntry(path: unknown, entries: CompressionDatasetEntry[]): CompressionDatasetEntry | undefined {
    if (typeof path !== "string") return undefined;
    return entries.find((entry) => path === entry.relativePath || path.endsWith(`/${entry.relativePath}`));
}

async function inspectRemoteDatabase(options: {
    baseUri: string;
    user: string;
    password: string;
    databaseName: string;
    dataset: CompressionDataset;
}): Promise<RemoteMeasurement> {
    const dbPath = `/${encodeURIComponent(options.databaseName)}`;
    await couchRequest(options.baseUri, options.user, options.password, `${dbPath}/_ensure_full_commit`, {
        method: "POST",
        body: "{}",
    });
    const [info, allDocs] = await Promise.all([
        couchRequest(options.baseUri, options.user, options.password, dbPath).then((response) => response.json()),
        couchRequest(options.baseUri, options.user, options.password, `${dbPath}/_all_docs?include_docs=true`).then(
            (response) => response.json()
        ),
    ]);
    const rows = (allDocs as { rows?: Array<{ doc?: Record<string, unknown> }> }).rows ?? [];
    const docs = rows.flatMap((row) => (row.doc ? [row.doc] : []));
    const docsById = new Map(docs.flatMap((doc) => (typeof doc._id === "string" ? [[doc._id, doc] as const] : [])));
    const metadataDocs = docs.filter((doc) => Array.isArray(doc.children) && typeof doc.path === "string");
    const chunkDocs = docs.filter(
        (doc) =>
            (doc.type === "leaf" || doc.type === "chunkpack") &&
            typeof doc.data === "string" &&
            typeof doc._id === "string"
    );
    const perKind = blankPerKind(options.dataset);
    const chunkIdsByKind = new Map(DATASET_KINDS.map((kind) => [kind, new Set<string>()] as const));

    for (const doc of metadataDocs) {
        const entry = findDatasetEntry(doc.path, options.dataset.entries);
        if (!entry) continue;
        perKind[entry.kind].mappedFiles += 1;
        for (const child of doc.children as unknown[]) {
            if (typeof child === "string") chunkIdsByKind.get(entry.kind)!.add(child);
        }
    }
    for (const kind of DATASET_KINDS) {
        const chunkIds = chunkIdsByKind.get(kind)!;
        perKind[kind].uniqueReferencedChunks = chunkIds.size;
        for (const chunkId of chunkIds) {
            const chunk = docsById.get(chunkId);
            if (!chunk || typeof chunk.data !== "string") continue;
            perKind[kind].storedChunkDataBytes += byteLength(chunk.data);
            perKind[kind].storedChunkJsonBytes += byteLength(JSON.stringify(chunk));
        }
    }

    const sizeInfo = (info as { sizes?: Partial<CouchDbSizes>; doc_count?: number }).sizes ?? {};
    return {
        couchdbSizes: {
            file: sizeInfo.file ?? 0,
            external: sizeInfo.external ?? 0,
            active: sizeInfo.active ?? 0,
        },
        documentCount: (info as { doc_count?: number }).doc_count ?? docs.length,
        chunkDocumentCount: chunkDocs.length,
        metadataDocumentCount: metadataDocs.length,
        compressedMarkerCount: chunkDocs.filter(
            (doc) => typeof doc.data === "string" && doc.data.startsWith(COMPRESSED_MARKER)
        ).length,
        encryptedChunkCount: chunkDocs.filter((doc) => doc.e_ === true).length,
        storedChunkDataBytes: chunkDocs.reduce(
            (sum, doc) => sum + (typeof doc.data === "string" ? byteLength(doc.data) : 0),
            0
        ),
        storedChunkJsonBytes: chunkDocs.reduce((sum, doc) => sum + byteLength(JSON.stringify(doc)), 0),
        perKind,
    };
}

async function verifyDataset(
    workDir: TempDir,
    vaultB: string,
    settingsB: string,
    entries: CompressionDatasetEntry[]
): Promise<CliProcessMeasurement> {
    const started = performance.now();
    const measurements: CliProcessMeasurement[] = [];
    for (const entry of entries) {
        const pulledPath = workDir.join(`verify-${entry.kind}-${entry.relativePath.split("/").at(-1)}`);
        measurements.push(
            await runMeasuredCliOrFail(vaultB, "--settings", settingsB, "pull", entry.relativePath, pulledPath)
        );
        await assertFilesEqual(entry.absolutePath, pulledPath, `compression benchmark mismatch: ${entry.relativePath}`);
    }
    const elapsedMs = performance.now() - started;
    const userCpuMs = measurements.reduce((sum, measurement) => sum + measurement.userCpuMs, 0);
    const systemCpuMs = measurements.reduce((sum, measurement) => sum + measurement.systemCpuMs, 0);
    const totalCpuMs = userCpuMs + systemCpuMs;
    return {
        elapsedMs: rounded(elapsedMs),
        userCpuMs: rounded(userCpuMs),
        systemCpuMs: rounded(systemCpuMs),
        totalCpuMs: rounded(totalCpuMs),
        cpuToWallRatio: rounded(totalCpuMs / elapsedMs),
        maxResidentSetKiB: Math.max(...measurements.map((measurement) => measurement.maxResidentSetKiB)),
    };
}

function summariseResults(results: RunResult[]) {
    const byCondition = Object.fromEntries(
        CONDITIONS.map((condition) => {
            const runs = results.filter((result) => result.condition.name === condition.name);
            return [
                condition.name,
                {
                    repeats: runs.length,
                    remoteStoredChunkDataBytesMedian: median(runs.map((run) => run.remote.storedChunkDataBytes)),
                    couchdbExternalBytesMedian: median(runs.map((run) => run.remote.couchdbSizes.external)),
                    couchdbFileBytesMedian: median(runs.map((run) => run.remote.couchdbSizes.file)),
                    uploadRequestBodyBytesMedian: median(runs.map((run) => run.upload.http.requestBodyBytes)),
                    uploadResponseBodyBytesMedian: median(runs.map((run) => run.upload.http.responseBodyBytes)),
                    downloadRequestBodyBytesMedian: median(runs.map((run) => run.download.http.requestBodyBytes)),
                    downloadResponseBodyBytesMedian: median(runs.map((run) => run.download.http.responseBodyBytes)),
                    uploadElapsedMsMedian: median(runs.map((run) => run.upload.elapsedMs)),
                    uploadCpuMsMedian: median(runs.map((run) => run.upload.totalCpuMs)),
                    downloadElapsedMsMedian: median(runs.map((run) => run.download.elapsedMs)),
                    downloadCpuMsMedian: median(runs.map((run) => run.download.totalCpuMs)),
                    materialisationElapsedMsMedian: median(runs.map((run) => run.materialisation.elapsedMs)),
                    materialisationCpuMsMedian: median(runs.map((run) => run.materialisation.totalCpuMs)),
                    materialisationResponseBodyBytesMedian: median(
                        runs.map((run) => run.materialisation.http.responseBodyBytes)
                    ),
                    completeDownloadResponseBodyBytesMedian: median(
                        runs.map(
                            (run) => run.download.http.responseBodyBytes + run.materialisation.http.responseBodyBytes
                        )
                    ),
                    completeDownloadElapsedMsMedian: median(
                        runs.map((run) => run.download.elapsedMs + run.materialisation.elapsedMs)
                    ),
                    completeDownloadCpuMsMedian: median(
                        runs.map((run) => run.download.totalCpuMs + run.materialisation.totalCpuMs)
                    ),
                    maxResidentSetKiBMedian: median(
                        runs.map((run) =>
                            Math.max(
                                run.upload.maxResidentSetKiB,
                                run.download.maxResidentSetKiB,
                                run.materialisation.maxResidentSetKiB
                            )
                        )
                    ),
                    perKindStoredChunkDataBytesMedian: Object.fromEntries(
                        DATASET_KINDS.map((kind) => [
                            kind,
                            median(runs.map((run) => run.remote.perKind[kind].storedChunkDataBytes)),
                        ])
                    ),
                },
            ];
        })
    );

    const comparisons = [false, true].map((encrypt) => {
        const disabledName = encrypt ? "e2ee" : "plain";
        const enabledName = encrypt ? "e2ee-compressed" : "plain-compressed";
        const disabled = byCondition[disabledName] as Record<string, unknown>;
        const enabled = byCondition[enabledName] as Record<string, unknown>;
        const disabledPerKind = disabled.perKindStoredChunkDataBytesMedian as Record<DatasetKind, number>;
        const enabledPerKind = enabled.perKindStoredChunkDataBytesMedian as Record<DatasetKind, number>;
        return {
            encrypt,
            disabledCondition: disabledName,
            enabledCondition: enabledName,
            storedChunkDataReductionPercent: reductionPercent(
                enabled.remoteStoredChunkDataBytesMedian as number,
                disabled.remoteStoredChunkDataBytesMedian as number
            ),
            couchdbExternalReductionPercent: reductionPercent(
                enabled.couchdbExternalBytesMedian as number,
                disabled.couchdbExternalBytesMedian as number
            ),
            couchdbFileReductionPercent: reductionPercent(
                enabled.couchdbFileBytesMedian as number,
                disabled.couchdbFileBytesMedian as number
            ),
            uploadRequestBodyReductionPercent: reductionPercent(
                enabled.uploadRequestBodyBytesMedian as number,
                disabled.uploadRequestBodyBytesMedian as number
            ),
            completeDownloadResponseBodyReductionPercent: reductionPercent(
                enabled.completeDownloadResponseBodyBytesMedian as number,
                disabled.completeDownloadResponseBodyBytesMedian as number
            ),
            uploadElapsedDeltaPercent: deltaPercent(
                enabled.uploadElapsedMsMedian as number,
                disabled.uploadElapsedMsMedian as number
            ),
            uploadCpuDeltaPercent: deltaPercent(
                enabled.uploadCpuMsMedian as number,
                disabled.uploadCpuMsMedian as number
            ),
            downloadElapsedDeltaPercent: deltaPercent(
                enabled.downloadElapsedMsMedian as number,
                disabled.downloadElapsedMsMedian as number
            ),
            downloadCpuDeltaPercent: deltaPercent(
                enabled.downloadCpuMsMedian as number,
                disabled.downloadCpuMsMedian as number
            ),
            completeDownloadElapsedDeltaPercent: deltaPercent(
                enabled.completeDownloadElapsedMsMedian as number,
                disabled.completeDownloadElapsedMsMedian as number
            ),
            completeDownloadCpuDeltaPercent: deltaPercent(
                enabled.completeDownloadCpuMsMedian as number,
                disabled.completeDownloadCpuMsMedian as number
            ),
            perKindStoredChunkDataReductionPercent: Object.fromEntries(
                DATASET_KINDS.map((kind) => [kind, reductionPercent(enabledPerKind[kind], disabledPerKind[kind])])
            ),
        };
    });
    return { byCondition, comparisons };
}

async function main(): Promise<void> {
    const backendUri = readEnvString("BENCH_COUCHDB_BACKEND_URI", "http://127.0.0.1:5989");
    const proxyUri = readEnvString("BENCH_COUCHDB_URI", "http://127.0.0.1:15989");
    const user = readEnvString("BENCH_COUCHDB_USER", readEnvString("username", "admin"));
    const password = readEnvString("BENCH_COUCHDB_PASSWORD", readEnvString("password", "password"));
    const databasePrefix = readEnvString("BENCH_COUCHDB_DBNAME", `compression-bench-${Date.now()}`);
    const repeatCount = readEnvPositiveInteger("BENCH_COMPRESSION_REPEAT_COUNT", 1);
    const requestedRttMs = readEnvPositiveNumber("BENCH_COUCHDB_RTT_MS", 1);
    const managedCouchdb = readEnvBoolean("BENCH_COUCHDB_MANAGED", true);
    const passphrase = readEnvString("BENCH_PASSPHRASE", "compression-benchmark-passphrase");
    const resultRoot = readEnvString("BENCH_COMPRESSION_RESULT_ROOT", "bench-results");
    const resultPath =
        Deno.env.get("BENCH_COMPRESSION_RESULT_JSON")?.trim() ||
        join(resultRoot, `compression-${new Date().toISOString().replaceAll(":", "-")}.json`);
    const createdDatabases = new Set<string>();
    const results: RunResult[] = [];
    let managedStarted = false;

    await Deno.mkdir(resultRoot, { recursive: true });
    const proxy = startCouchdbProxy({ backendUri, proxyUri, requestedRttMs });

    try {
        for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex++) {
            const rotation = (repeatIndex - 1) % CONDITIONS.length;
            const orderedConditions = [...CONDITIONS.slice(rotation), ...CONDITIONS.slice(0, rotation)];
            for (const [executionOffset, condition] of orderedConditions.entries()) {
                const databaseName = `${databasePrefix}-${repeatIndex}-${condition.name}`.toLowerCase();
                if (managedCouchdb && !managedStarted) {
                    await startCouchdb(backendUri, user, password, databaseName);
                    managedStarted = true;
                } else {
                    await createCouchdbDatabase(backendUri, user, password, databaseName);
                }
                createdDatabases.add(databaseName);

                await using workDir = await TempDir.create(`livesync-compression-${condition.name}`);
                const vaultA = workDir.join("vault-a");
                const vaultB = workDir.join("vault-b");
                const settingsA = workDir.join("settings-a.json");
                const settingsB = workDir.join("settings-b.json");
                await Deno.mkdir(vaultA, { recursive: true });
                await Deno.mkdir(vaultB, { recursive: true });
                await initSettingsFile(settingsA);
                await initSettingsFile(settingsB);
                await Promise.all(
                    [settingsA, settingsB].map((settingsFile) =>
                        applyRemoteSyncSettings(settingsFile, {
                            remoteType: "COUCHDB",
                            couchdbUri: proxyUri,
                            couchdbUser: user,
                            couchdbPassword: password,
                            couchdbDbname: databaseName,
                            encrypt: condition.encrypt,
                            passphrase,
                            enableCompression: condition.enableCompression,
                            usePathObfuscation: false,
                        })
                    )
                );

                const dataset = await createCompressionBenchmarkDataset({ rootDir: vaultA });
                const datasetDigestSha256 = await computeDatasetDigestSha256(dataset.entries);
                const mirror = await runMeasuredCliOrFail(vaultA, "--settings", settingsA, "mirror");

                proxy.resetCounters();
                const uploadMeasurement = await runMeasuredCliOrFail(vaultA, "--settings", settingsA, "sync");
                const upload = { ...uploadMeasurement, http: proxy.snapshotCounters() };

                proxy.resetCounters();
                const downloadMeasurement = await runMeasuredCliOrFail(vaultB, "--settings", settingsB, "sync");
                const download = { ...downloadMeasurement, http: proxy.snapshotCounters() };

                proxy.resetCounters();
                const materialisationMeasurement = await verifyDataset(workDir, vaultB, settingsB, dataset.entries);
                const materialisation = {
                    ...materialisationMeasurement,
                    http: proxy.snapshotCounters(),
                };
                const remote = await inspectRemoteDatabase({
                    baseUri: backendUri,
                    user,
                    password,
                    databaseName,
                    dataset,
                });
                const settings = JSON.parse(await Deno.readTextFile(settingsA)) as Record<string, unknown>;
                const effectiveSettings = Object.fromEntries(
                    [
                        "encrypt",
                        "enableCompression",
                        "E2EEAlgorithm",
                        "usePathObfuscation",
                        "chunkSplitterVersion",
                        "customChunkSize",
                        "minimumChunkSize",
                        "hashAlg",
                    ].map((key) => [key, settings[key]])
                );

                results.push({
                    condition,
                    repeatIndex,
                    executionOrder: executionOffset + 1,
                    databaseName,
                    datasetDigestSha256,
                    dataset: {
                        totalFiles: dataset.totalFiles,
                        totalBytes: dataset.totalBytes,
                        filesByKind: dataset.filesByKind,
                        bytesByKind: dataset.bytesByKind,
                        jpegGenerator: dataset.jpegGenerator,
                    },
                    effectiveSettings,
                    mirror,
                    upload,
                    download,
                    materialisation,
                    verification: { verifiedFiles: dataset.entries.length, complete: true },
                    remote,
                });
                await deleteDatabase(backendUri, user, password, databaseName);
                createdDatabases.delete(databaseName);
                console.error(
                    `[Compression benchmark] repeat ${repeatIndex}/${repeatCount} ${condition.name}: ` +
                        `${dataset.totalFiles} files, ${remote.chunkDocumentCount} chunks, ` +
                        `${remote.storedChunkDataBytes} stored chunk-data bytes`
                );
            }
        }

        const output = {
            schemaVersion: 1,
            mode: "couchdb-cli-compression-benchmark",
            generatedAt: new Date().toISOString(),
            commonlibVersion: (
                JSON.parse(
                    await Deno.readTextFile(
                        join(import.meta.dirname!, "../../../../node_modules/@vrtmrz/livesync-commonlib/package.json")
                    )
                ) as { version: string }
            ).version,
            couchdbVersion: (
                (await couchRequest(backendUri, user, password, "/").then((response) => response.json())) as {
                    version?: string;
                }
            ).version,
            compressionImplementation: "Commonlib replicationFilter using fflate level 8 before E2EE V2",
            chunkingImplementation: "LiveSync CLI mirror using the effective settings recorded for each run",
            requestedRttMs,
            httpByteScope:
                "Decoded HTTP request and response body bytes observed by the local proxy; headers are excluded.",
            limitations: [
                "Synthetic JPEGs exercise a deterministic image-like fixture but are not a photographic corpus.",
                "PNG, Markdown, JSON, and TypeScript inputs are current repository files and therefore change with the source tree.",
                "Wall and CPU times include CLI process start-up; compare repeated medians rather than treating one run as a universal result.",
                "Full materialisation starts one CLI process per file and can repeat lazy chunk fetches; treat it as a CLI workflow measurement rather than a raw download lower bound.",
                "The benchmark uses a local CouchDB and a fixed latency proxy, not a contended production server or a real WAN.",
                "Path obfuscation is explicitly disabled so raw metadata can be mapped back to file kinds.",
            ],
            repeatCount,
            conditions: CONDITIONS,
            summary: summariseResults(results),
            runs: results,
        };
        await Deno.writeTextFile(resultPath, JSON.stringify(output, null, 2));
        console.log(JSON.stringify(output, null, 2));
        console.error(`[Compression benchmark] wrote ${resultPath}`);
    } finally {
        await proxy.stop();
        for (const databaseName of createdDatabases) {
            await deleteDatabase(backendUri, user, password, databaseName).catch((error) => console.error(error));
        }
        if (managedCouchdb && managedStarted) {
            await stopCouchdb().catch(() => {});
        }
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error("[Compression benchmark fatal]", error);
        Deno.exit(1);
    });
}
