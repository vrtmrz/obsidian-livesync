import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { TempDir } from "./helpers/temp.ts";
import {
    applyRemoteSyncSettings,
    initSettingsFile,
} from "./helpers/settings.ts";
import { assertFilesEqual, runCliOrFail } from "./helpers/cli.ts";
import {
    createCouchdbDatabase,
    startCouchdb,
    stopCouchdb,
} from "./helpers/docker.ts";
import {
    createDeterministicDataset,
} from "./helpers/dataset.ts";
import {
    type BenchmarkVerificationMode,
    parseBenchmarkVerificationMode,
    verifyBenchmarkDataset,
} from "./helpers/benchmarkVerification.ts";

type BenchmarkConfig = {
    caseName: string;
    couchdbBackendUri: string;
    couchdbProxyUri: string;
    couchdbUser: string;
    couchdbPassword: string;
    couchdbDbname: string;
    datasetDirName: string;
    datasetSeed: string;
    mdFileCount: number;
    mdMinSizeBytes: number;
    mdMaxSizeBytes: number;
    binFileCount: number;
    binSizeBytes: number;
    syncTimeoutSeconds: number;
    requestedRttMs: number;
    passphrase: string;
    encrypt: boolean;
    managedCouchdb: boolean;
    simulationTier: string;
    networkProfile: string;
    networkModel: string;
    measurementScope: string;
    limitations: string[];
    verificationMode: BenchmarkVerificationMode;
    repeatIndex: number;
    repeatCount: number;
};

function readEnvString(name: string, fallback: string): string {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : fallback;
}

function readEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") {
        return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive number, got '${raw}'`);
    }
    return parsed;
}

function readEnvBool(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") {
        return fallback;
    }
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function readEnvStringArray(name: string, fallback: string[]): string[] {
    const raw = process.env[name]?.trim();
    if (!raw) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(raw);
        if (
            Array.isArray(parsed) &&
            parsed.every((item) => typeof item === "string")
        ) {
            return parsed;
        }
    } catch {
        // Fall through to pipe-separated parsing for hand-written invocations.
    }

    return raw
        .split("|")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function nowMs(): number {
    return performance.now();
}

function formatMs(value: number): string {
    return `${value.toFixed(1)} ms`;
}

function formatBytes(value: number): string {
    if (value < 1024) {
        return `${value} B`;
    }
    const kib = value / 1024;
    if (kib < 1024) {
        return `${kib.toFixed(1)} KiB`;
    }
    return `${(kib / 1024).toFixed(1)} MiB`;
}

function buildConfig(): BenchmarkConfig {
    return {
        caseName: readEnvString("BENCH_CASE", "couchdb-baseline"),
        couchdbBackendUri: readEnvString(
            "BENCH_COUCHDB_BACKEND_URI",
            "http://127.0.0.1:5989",
        ),
        couchdbProxyUri: readEnvString(
            "BENCH_COUCHDB_URI",
            "http://127.0.0.1:15989",
        ),
        couchdbUser: readEnvString(
            "BENCH_COUCHDB_USER",
            readEnvString("username", "admin"),
        ),
        couchdbPassword: readEnvString(
            "BENCH_COUCHDB_PASSWORD",
            readEnvString("password", "password"),
        ),
        couchdbDbname: readEnvString(
            "BENCH_COUCHDB_DBNAME",
            `bench-couchdb-${Date.now()}`,
        ),
        datasetDirName: readEnvString("BENCH_DATASET_DIR", "bench-dataset"),
        datasetSeed: readEnvString("BENCH_SEED", "livesync-benchmark-seed"),
        mdFileCount: Math.floor(readEnvNumber("BENCH_MD_FILE_COUNT", 1500)),
        mdMinSizeBytes: Math.floor(
            readEnvNumber("BENCH_MD_MIN_SIZE_BYTES", 1024),
        ),
        mdMaxSizeBytes: Math.floor(
            readEnvNumber("BENCH_MD_MAX_SIZE_BYTES", 20 * 1024),
        ),
        binFileCount: Math.floor(readEnvNumber("BENCH_BIN_FILE_COUNT", 500)),
        binSizeBytes: Math.floor(
            readEnvNumber("BENCH_BIN_SIZE_BYTES", 100 * 1024),
        ),
        syncTimeoutSeconds: readEnvNumber("BENCH_SYNC_TIMEOUT", 240),
        requestedRttMs: Math.floor(readEnvNumber("BENCH_COUCHDB_RTT_MS", 50)),
        passphrase: readEnvString("BENCH_PASSPHRASE", `bench-${Date.now()}`),
        encrypt: readEnvBool("BENCH_ENCRYPT", true),
        managedCouchdb: readEnvBool("BENCH_COUCHDB_MANAGED", true),
        simulationTier: readEnvString("BENCH_SIMULATION_TIER", "1"),
        networkProfile: readEnvString(
            "BENCH_NETWORK_PROFILE",
            "http-latency-proxy",
        ),
        networkModel: readEnvString("BENCH_NETWORK_MODEL", "local-http-proxy"),
        measurementScope: readEnvString(
            "BENCH_MEASUREMENT_SCOPE",
            "Two one-shot synchronisation phases through a CouchDB-compatible remote-store path.",
        ),
        limitations: readEnvStringArray("BENCH_LIMITATIONS_JSON", [
            "This benchmark result is scoped to the configured dataset, remote store, and network model.",
        ]),
        verificationMode: parseBenchmarkVerificationMode(
            process.env.BENCH_VERIFY_MODE,
        ),
        repeatIndex: Math.floor(readEnvNumber("BENCH_REPEAT_INDEX", 1)),
        repeatCount: Math.floor(readEnvNumber("BENCH_REPEAT_COUNT", 1)),
    };
}

function readOptionalResultPath(): string | undefined {
    const raw = process.env.BENCH_RESULT_JSON?.trim();
    if (!raw) {
        return undefined;
    }
    return raw;
}

export type CouchdbProxyHandle = {
    stop: () => Promise<void>;
    resetCounters: () => void;
    snapshotCounters: () => CouchdbProxyCounters;
    applied: boolean;
    note: string;
    directionalDelayMs: number;
};

export type CouchdbProxyCounters = {
    requestCount: number;
    requestBodyBytes: number;
    responseBodyBytes: number;
};

export async function startCouchdbProxy(
    options: {
        backendUri: string;
        proxyUri: string;
        requestedRttMs: number;
        delay?: (milliseconds: number) => Promise<void>;
    },
): Promise<CouchdbProxyHandle> {
    const backend = new URL(options.backendUri);
    const proxy = new URL(options.proxyUri);
    const halfDelayMs = options.requestedRttMs / 2;
    const delay = options.delay ??
        ((milliseconds: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const counters: CouchdbProxyCounters = {
        requestCount: 0,
        requestBodyBytes: 0,
        responseBodyBytes: 0,
    };

    const server = createServer(async (request, response) => {
        try {
            await delay(halfDelayMs);

            const targetUrl = new URL(request.url ?? "/", proxy);
            targetUrl.protocol = backend.protocol;
            targetUrl.host = backend.host;

            const headers = new Headers();
            for (const [name, value] of Object.entries(request.headers)) {
                if (value === undefined || name === "host" || name === "content-length") continue;
                if (Array.isArray(value)) {
                    for (const item of value) headers.append(name, item);
                } else {
                    headers.append(name, value);
                }
            }
            let requestBody: Buffer | undefined;
            if (request.method !== "GET" && request.method !== "HEAD") {
                try {
                    const chunks: Buffer[] = [];
                    for await (const chunk of request as AsyncIterable<Buffer | string>) {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    }
                    requestBody = Buffer.concat(chunks);
                } catch {
                    requestBody = undefined;
                }
            }
            counters.requestCount += 1;
            counters.requestBodyBytes += requestBody?.byteLength ?? 0;

            const upstream = await fetch(targetUrl, {
                method: request.method,
                headers,
                body: requestBody === undefined ? undefined : Uint8Array.from(requestBody),
                redirect: "manual",
            });

            const responseHeaders = new Headers(upstream.headers);
            responseHeaders.delete("content-length");
            const responseBody = await upstream.arrayBuffer();
            counters.responseBodyBytes += responseBody.byteLength;
            await delay(halfDelayMs);

            response.statusCode = upstream.status;
            response.statusMessage = upstream.statusText;
            responseHeaders.forEach((value, name) => response.setHeader(name, value));
            response.end(Buffer.from(responseBody));
        } catch (error) {
            console.error(`[Proxy] ${String(error)}`);
            if (!response.headersSent) {
                response.statusCode = 502;
                response.end("proxy error");
            } else {
                response.destroy();
            }
        }
    });
    await new Promise<void>((resolve, reject) => {
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        const onError = (error: Error) => {
            server.off("listening", onListening);
            reject(error);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(Number(proxy.port), proxy.hostname);
    });

    return {
        applied: true,
        directionalDelayMs: halfDelayMs,
        note:
            `local reverse proxy on ${proxy.origin} with ${halfDelayMs}ms request-path and ${halfDelayMs}ms response-path delay`,
        resetCounters: () => {
            counters.requestCount = 0;
            counters.requestBodyBytes = 0;
            counters.responseBodyBytes = 0;
        },
        snapshotCounters: () => ({ ...counters }),
        stop: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        },
    };
}

async function main(): Promise<void> {
    const config = buildConfig();
    const resultPath = readOptionalResultPath();

    await using workDir = await TempDir.create("livesync-cli-couchdb-bench");
    const vaultA = workDir.join("vault-a");
    const vaultB = workDir.join("vault-b");
    const settingsA = workDir.join("settings-a.json");
    const settingsB = workDir.join("settings-b.json");
    await mkdir(vaultA, { recursive: true });
    await mkdir(vaultB, { recursive: true });

    await initSettingsFile(settingsA);
    await initSettingsFile(settingsB);

    if (config.managedCouchdb) {
        await startCouchdb(
            config.couchdbBackendUri,
            config.couchdbUser,
            config.couchdbPassword,
            config.couchdbDbname,
        );
    } else {
        console.log(
            `[INFO] using externally managed CouchDB: ${config.couchdbBackendUri}`,
        );
        await createCouchdbDatabase(
            config.couchdbBackendUri,
            config.couchdbUser,
            config.couchdbPassword,
            config.couchdbDbname,
        );
    }

    const proxy = await startCouchdbProxy({
        backendUri: config.couchdbBackendUri,
        proxyUri: config.couchdbProxyUri,
        requestedRttMs: config.requestedRttMs,
    });

    try {
        await Promise.all([
            applyRemoteSyncSettings(settingsA, {
                remoteType: "COUCHDB",
                couchdbUri: config.couchdbProxyUri,
                couchdbUser: config.couchdbUser,
                couchdbPassword: config.couchdbPassword,
                couchdbDbname: config.couchdbDbname,
                encrypt: config.encrypt,
                passphrase: config.passphrase,
            }),
            applyRemoteSyncSettings(settingsB, {
                remoteType: "COUCHDB",
                couchdbUri: config.couchdbProxyUri,
                couchdbUser: config.couchdbUser,
                couchdbPassword: config.couchdbPassword,
                couchdbDbname: config.couchdbDbname,
                encrypt: config.encrypt,
                passphrase: config.passphrase,
            }),
        ]);

        const seedFiles = await createDeterministicDataset({
            rootDir: vaultA,
            datasetDirName: config.datasetDirName,
            seed: config.datasetSeed,
            mdCount: config.mdFileCount,
            mdMinSizeBytes: config.mdMinSizeBytes,
            mdMaxSizeBytes: config.mdMaxSizeBytes,
            binCount: config.binFileCount,
            binSizeBytes: config.binSizeBytes,
        });

        const mirrorStart = nowMs();
        await runCliOrFail(vaultA, "--settings", settingsA, "mirror");
        const mirrorElapsed = nowMs() - mirrorStart;

        const syncAStart = nowMs();
        await runCliOrFail(vaultA, "--settings", settingsA, "sync");
        const syncAElapsed = nowMs() - syncAStart;

        const syncBStart = nowMs();
        await runCliOrFail(vaultB, "--settings", settingsB, "sync");
        const syncBElapsed = nowMs() - syncBStart;

        const verification = await verifyBenchmarkDataset(
            seedFiles.entries,
            config.verificationMode,
            async (entry) => {
                const pulledPath = workDir.join(
                    `pulled-${entry.relativePath.split("/").join("_")}`,
                );
                await runCliOrFail(
                    vaultB,
                    "--settings",
                    settingsB,
                    "pull",
                    entry.relativePath,
                    pulledPath,
                );
                await assertFilesEqual(
                    entry.absolutePath,
                    pulledPath,
                    `file mismatch after CouchDB sync: ${entry.relativePath}`,
                );
            },
        );

        const result = {
            caseName: config.caseName,
            mode: "couchdb-cli-benchmark",
            couchdbBackendUri: config.couchdbBackendUri,
            couchdbProxyUri: config.couchdbProxyUri,
            couchdbDbname: config.couchdbDbname,
            managedCouchdb: config.managedCouchdb,
            simulationTier: config.simulationTier,
            networkProfile: config.networkProfile,
            networkModel: config.networkModel,
            measurementScope: config.measurementScope,
            limitations: config.limitations,
            repeatIndex: config.repeatIndex,
            repeatCount: config.repeatCount,
            rttRequestedMs: config.requestedRttMs,
            proxyApplied: proxy.applied,
            proxyNote: proxy.note,
            proxyDirectionalDelayMs: proxy.directionalDelayMs,
            proxyConfiguredRttMs: proxy.directionalDelayMs * 2,
            proxyDelayApplication: "request-and-response",
            datasetSeed: config.datasetSeed,
            datasetDirName: config.datasetDirName,
            totalFiles: seedFiles.totalFiles,
            totalBytes: seedFiles.totalBytes,
            mdFileCount: seedFiles.mdCount,
            binFileCount: seedFiles.binCount,
            ...verification,
            mirrorElapsedMs: Number(mirrorElapsed.toFixed(1)),
            syncAElapsedMs: Number(syncAElapsed.toFixed(1)),
            syncBElapsedMs: Number(syncBElapsed.toFixed(1)),
            totalSyncElapsedMs: Number(
                (syncAElapsed + syncBElapsed).toFixed(1),
            ),
            throughputBytesPerSec: Number(
                (seedFiles.totalBytes / ((syncAElapsed + syncBElapsed) / 1000))
                    .toFixed(
                        2,
                    ),
            ),
            throughputMiBPerSec: Number(
                (seedFiles.totalBytes / ((syncAElapsed + syncBElapsed) / 1000) /
                    1024 /
                    1024).toFixed(4),
            ),
        };

        if (resultPath) {
            await writeFile(
                resultPath,
                JSON.stringify(result, null, 2),
            );
        }

        console.log(JSON.stringify(result, null, 2));
        console.error(
            `[Benchmark] couchdb mirrored ${seedFiles.totalFiles} files (${
                formatBytes(seedFiles.totalBytes)
            }) in ${
                formatMs(
                    mirrorElapsed,
                )
            }, synced in ${
                formatMs(syncAElapsed + syncBElapsed)
            } (${result.throughputBytesPerSec} B/s, ${result.throughputMiBPerSec} MiB/s)`,
        );
    } finally {
        await proxy.stop();
        if (config.managedCouchdb) {
            await stopCouchdb().catch(() => {});
        }
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(`[Fatal Error]`, error);
        process.exitCode = 1;
    });
}
