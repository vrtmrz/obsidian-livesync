import { TempDir } from "./helpers/temp.ts";
import { applyP2pSettings, applyP2pTestTweaks, initSettingsFile } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import { discoverPeer, maybeStartLocalRelay, stopLocalRelayIfStarted } from "./helpers/p2p.ts";
import { assertFilesEqual, runCliOrFail } from "./helpers/cli.ts";
import { createDeterministicDataset, type DatasetEntry } from "./helpers/dataset.ts";

type BenchmarkConfig = {
    relay: string;
    appId: string;
    roomId: string;
    passphrase: string;
    datasetDirName: string;
    datasetSeed: string;
    mdFileCount: number;
    mdMinSizeBytes: number;
    mdMaxSizeBytes: number;
    binFileCount: number;
    binSizeBytes: number;
    peersTimeoutSeconds: number;
    syncTimeoutSeconds: number;
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
    const mib = kib / 1024;
    return `${mib.toFixed(1)} MiB`;
}

function buildConfig(): BenchmarkConfig {
    return {
        relay: readEnvString("BENCH_RELAY", "ws://localhost:4000/"),
        appId: readEnvString("BENCH_APP_ID", "self-hosted-livesync-cli-benchmark"),
        roomId: readEnvString("BENCH_ROOM_ID", `bench-room-${Date.now()}`),
        passphrase: readEnvString("BENCH_PASSPHRASE", `bench-${Date.now()}`),
        datasetDirName: readEnvString("BENCH_DATASET_DIR", "bench-dataset"),
        datasetSeed: readEnvString("BENCH_SEED", "livesync-benchmark-seed"),
        mdFileCount: Math.floor(readEnvNumber("BENCH_MD_FILE_COUNT", 1500)),
        mdMinSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MIN_SIZE_BYTES", 1024)),
        mdMaxSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MAX_SIZE_BYTES", 20 * 1024)),
        binFileCount: Math.floor(readEnvNumber("BENCH_BIN_FILE_COUNT", 500)),
        binSizeBytes: Math.floor(readEnvNumber("BENCH_BIN_SIZE_BYTES", 100 * 1024)),
        peersTimeoutSeconds: readEnvNumber("BENCH_PEERS_TIMEOUT", 20),
        syncTimeoutSeconds: readEnvNumber("BENCH_SYNC_TIMEOUT", 240),
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

async function main(): Promise<void> {
    const config = buildConfig();
    const resultPath = readOptionalResultPath();

    const relayStarted = await maybeStartLocalRelay(config.relay);
    await using workDir = await TempDir.create("livesync-cli-p2p-bench");

    const hostVault = workDir.join("vault-host");
    const clientVault = workDir.join("vault-client");
    const hostSettings = workDir.join("settings-host.json");
    const clientSettings = workDir.join("settings-client.json");

    await Promise.all([
        Deno.mkdir(hostVault, { recursive: true }),
        Deno.mkdir(clientVault, { recursive: true }),
        initSettingsFile(hostSettings),
        initSettingsFile(clientSettings),
    ]);

    await Promise.all([
        applyP2pSettings(hostSettings, config.roomId, config.passphrase, config.appId, config.relay, "~.*"),
        applyP2pSettings(clientSettings, config.roomId, config.passphrase, config.appId, config.relay, "~.*"),
    ]);

    await Promise.all([
        applyP2pTestTweaks(hostSettings, "p2p-bench-host", config.passphrase),
        applyP2pTestTweaks(clientSettings, "p2p-bench-client", config.passphrase),
    ]);

    const seedFiles = await createDeterministicDataset({
        rootDir: hostVault,
        datasetDirName: config.datasetDirName,
        seed: config.datasetSeed,
        mdCount: config.mdFileCount,
        mdMinSizeBytes: config.mdMinSizeBytes,
        mdMaxSizeBytes: config.mdMaxSizeBytes,
        binCount: config.binFileCount,
        binSizeBytes: config.binSizeBytes,
    });

    const mirrorStart = nowMs();
    await runCliOrFail(hostVault, "--settings", hostSettings, "mirror");
    const mirrorElapsed = nowMs() - mirrorStart;

    const host = startCliInBackground(hostVault, "--settings", hostSettings, "p2p-host");
    try {
        const hostReadyStart = nowMs();
        await host.waitUntilContains("P2P host is running", 20000);
        const hostReadyElapsed = nowMs() - hostReadyStart;

        const peerDiscoveryStart = nowMs();
        const peer = await discoverPeer(clientVault, clientSettings, config.peersTimeoutSeconds);
        const peerDiscoveryElapsed = nowMs() - peerDiscoveryStart;

        const syncStart = nowMs();
        await runCliOrFail(
            clientVault,
            "--settings",
            clientSettings,
            "p2p-sync",
            peer.id,
            String(config.syncTimeoutSeconds)
        );
        const syncElapsed = nowMs() - syncStart;

        const sampleFiles = pickSampleFiles(seedFiles.entries);
        for (const sample of sampleFiles) {
            const pulledPath = workDir.join(`pulled-${sample.relativePath.replaceAll("/", "_")}`);
            await runCliOrFail(clientVault, "--settings", clientSettings, "pull", sample.relativePath, pulledPath);
            await assertFilesEqual(
                sample.absolutePath,
                pulledPath,
                `sample file mismatch after sync: ${sample.relativePath}`
            );
        }

        const result = {
            mode: "p2p-cli-benchmark",
            relay: config.relay,
            appId: config.appId,
            roomId: config.roomId,
            datasetSeed: config.datasetSeed,
            datasetDirName: config.datasetDirName,
            peerId: peer.id,
            peerName: peer.name,
            totalFiles: seedFiles.totalFiles,
            totalBytes: seedFiles.totalBytes,
            mdFileCount: seedFiles.mdCount,
            binFileCount: seedFiles.binCount,
            mirrorElapsedMs: Number(mirrorElapsed.toFixed(1)),
            hostReadyElapsedMs: Number(hostReadyElapsed.toFixed(1)),
            peerDiscoveryElapsedMs: Number(peerDiscoveryElapsed.toFixed(1)),
            syncElapsedMs: Number(syncElapsed.toFixed(1)),
            throughputBytesPerSec: Number((seedFiles.totalBytes / (syncElapsed / 1000)).toFixed(2)),
            throughputMiBPerSec: Number((seedFiles.totalBytes / (syncElapsed / 1000) / 1024 / 1024).toFixed(4)),
        };

        if (resultPath) {
            await Deno.writeTextFile(resultPath, JSON.stringify(result, null, 2));
        }

        console.log(JSON.stringify(result, null, 2));
        console.error(
            `[Benchmark] mirrored ${seedFiles.totalFiles} files (${formatBytes(seedFiles.totalBytes)}) in ${formatMs(mirrorElapsed)}, ` +
                `synced in ${formatMs(syncElapsed)} ` +
                `(${result.throughputBytesPerSec} B/s, ${result.throughputMiBPerSec} MiB/s)`
        );
    } finally {
        await host.stop();
        await stopLocalRelayIfStarted(relayStarted);
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(`[Fatal Error]`, error);
        Deno.exit(1);
    });
}
