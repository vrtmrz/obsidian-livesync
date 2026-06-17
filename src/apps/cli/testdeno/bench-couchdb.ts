import { TempDir } from "./helpers/temp.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { assertFilesEqual, runCliOrFail } from "./helpers/cli.ts";
import { startCouchdb, stopCouchdb } from "./helpers/docker.ts";
import { createDeterministicDataset, type DatasetEntry } from "./helpers/dataset.ts";

type BenchmarkConfig = {
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
};

function readEnvString(name: string, fallback: string): string {
    const value = Deno.env.get(name)?.trim();
    return value && value.length > 0 ? value : fallback;
}

function readEnvNumber(name: string, fallback: number): number {
    const raw = Deno.env.get(name);
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
    const raw = Deno.env.get(name);
    if (raw === undefined || raw.trim() === "") {
        return fallback;
    }
    return /^(1|true|yes|on)$/i.test(raw.trim());
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
        couchdbBackendUri: readEnvString("BENCH_COUCHDB_BACKEND_URI", "http://127.0.0.1:5989"),
        couchdbProxyUri: readEnvString("BENCH_COUCHDB_URI", "http://127.0.0.1:15989"),
        couchdbUser: readEnvString("BENCH_COUCHDB_USER", readEnvString("username", "admin")),
        couchdbPassword: readEnvString("BENCH_COUCHDB_PASSWORD", readEnvString("password", "password")),
        couchdbDbname: readEnvString("BENCH_COUCHDB_DBNAME", `bench-couchdb-${Date.now()}`),
        datasetDirName: readEnvString("BENCH_DATASET_DIR", "bench-dataset"),
        datasetSeed: readEnvString("BENCH_SEED", "livesync-benchmark-seed"),
        mdFileCount: Math.floor(readEnvNumber("BENCH_MD_FILE_COUNT", 1500)),
        mdMinSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MIN_SIZE_BYTES", 1024)),
        mdMaxSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MAX_SIZE_BYTES", 20 * 1024)),
        binFileCount: Math.floor(readEnvNumber("BENCH_BIN_FILE_COUNT", 500)),
        binSizeBytes: Math.floor(readEnvNumber("BENCH_BIN_SIZE_BYTES", 100 * 1024)),
        syncTimeoutSeconds: readEnvNumber("BENCH_SYNC_TIMEOUT", 240),
        requestedRttMs: Math.floor(readEnvNumber("BENCH_COUCHDB_RTT_MS", 50)),
        passphrase: readEnvString("BENCH_PASSPHRASE", `bench-${Date.now()}`),
        encrypt: readEnvBool("BENCH_ENCRYPT", true),
    };
}

function readOptionalResultPath(): string | undefined {
    const raw = Deno.env.get("BENCH_RESULT_JSON")?.trim();
    if (!raw) {
        return undefined;
    }
    return raw;
}

function pickSampleFiles(entries: DatasetEntry[]): DatasetEntry[] {
    if (entries.length === 0) {
        return [];
    }
    const md = entries.find((e) => e.kind === "md");
    const bin = entries.find((e) => e.kind === "bin");
    const middle = entries[Math.floor(entries.length / 2)];
    const last = entries[entries.length - 1];
    const unique = new Map<string, DatasetEntry>();
    for (const entry of [md, bin, middle, last]) {
        if (entry) {
            unique.set(entry.relativePath, entry);
        }
    }
    return [...unique.values()];
}

type ProxyHandle = {
    stop: () => Promise<void>;
    applied: boolean;
    note: string;
};

function startCouchdbProxy(options: { backendUri: string; proxyUri: string; requestedRttMs: number }): ProxyHandle {
    const backend = new URL(options.backendUri);
    const proxy = new URL(options.proxyUri);
    const halfDelayMs = Math.max(1, Math.floor(options.requestedRttMs / 2));
    const controller = new AbortController();

    const listener = Deno.serve(
        {
            hostname: proxy.hostname,
            port: Number(proxy.port),
            signal: controller.signal,
            onError(error) {
                console.error(`[Proxy] ${String(error)}`);
                return new Response("proxy error", { status: 502 });
            },
        },
        async (request) => {
            await new Promise((resolve) => setTimeout(resolve, halfDelayMs));

            const targetUrl = new URL(request.url);
            targetUrl.protocol = backend.protocol;
            targetUrl.host = backend.host;

            const headers = new Headers(request.headers);
            headers.delete("host");
            headers.delete("content-length");

            let requestBody: ArrayBuffer | undefined;
            if (request.method !== "GET" && request.method !== "HEAD") {
                try {
                    requestBody = await request.arrayBuffer();
                } catch {
                    requestBody = undefined;
                }
            }

            const upstream = await fetch(targetUrl, {
                method: request.method,
                headers,
                body: requestBody,
                redirect: "manual",
            });

            const responseHeaders = new Headers(upstream.headers);
            responseHeaders.delete("content-length");
            const responseBody = await upstream.arrayBuffer();

            return new Response(responseBody, {
                status: upstream.status,
                statusText: upstream.statusText,
                headers: responseHeaders,
            });
        }
    );

    return {
        applied: true,
        note: `local reverse proxy on ${proxy.origin} with ${halfDelayMs}ms pre-forward delay`,
        stop: async () => {
            controller.abort();
            await listener.finished.catch(() => {});
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
    await Deno.mkdir(vaultA, { recursive: true });
    await Deno.mkdir(vaultB, { recursive: true });

    await initSettingsFile(settingsA);
    await initSettingsFile(settingsB);

    await startCouchdb(config.couchdbBackendUri, config.couchdbUser, config.couchdbPassword, config.couchdbDbname);

    const proxy = startCouchdbProxy({
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

        const sampleFiles = pickSampleFiles(seedFiles.entries);
        for (const sample of sampleFiles) {
            const pulledPath = workDir.join(`pulled-${sample.relativePath.split("/").join("_")}`);
            await runCliOrFail(vaultB, "--settings", settingsB, "pull", sample.relativePath, pulledPath);
            await assertFilesEqual(
                sample.absolutePath,
                pulledPath,
                `sample file mismatch after CouchDB sync: ${sample.relativePath}`
            );
        }

        const result = {
            mode: "couchdb-cli-benchmark",
            couchdbBackendUri: config.couchdbBackendUri,
            couchdbProxyUri: config.couchdbProxyUri,
            couchdbDbname: config.couchdbDbname,
            rttRequestedMs: config.requestedRttMs,
            proxyApplied: proxy.applied,
            proxyNote: proxy.note,
            datasetSeed: config.datasetSeed,
            datasetDirName: config.datasetDirName,
            totalFiles: seedFiles.totalFiles,
            totalBytes: seedFiles.totalBytes,
            mdFileCount: seedFiles.mdCount,
            binFileCount: seedFiles.binCount,
            mirrorElapsedMs: Number(mirrorElapsed.toFixed(1)),
            syncAElapsedMs: Number(syncAElapsed.toFixed(1)),
            syncBElapsedMs: Number(syncBElapsed.toFixed(1)),
            totalSyncElapsedMs: Number((syncAElapsed + syncBElapsed).toFixed(1)),
            throughputBytesPerSec: Number((seedFiles.totalBytes / ((syncAElapsed + syncBElapsed) / 1000)).toFixed(2)),
            throughputMiBPerSec: Number(
                (seedFiles.totalBytes / ((syncAElapsed + syncBElapsed) / 1000) / 1024 / 1024).toFixed(4)
            ),
        };

        if (resultPath) {
            await Deno.writeTextFile(resultPath, JSON.stringify(result, null, 2));
        }

        console.log(JSON.stringify(result, null, 2));
        console.error(
            `[Benchmark] couchdb mirrored ${seedFiles.totalFiles} files (${formatBytes(seedFiles.totalBytes)}) in ${formatMs(
                mirrorElapsed
            )}, synced in ${formatMs(syncAElapsed + syncBElapsed)} (${result.throughputBytesPerSec} B/s, ${result.throughputMiBPerSec} MiB/s)`
        );
    } finally {
        await proxy.stop();
        await stopCouchdb().catch(() => {});
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(`[Fatal Error]`, error);
        Deno.exit(1);
    });
}
