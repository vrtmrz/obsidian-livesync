import { TempDir } from "./helpers/temp.ts";
import { applyP2pSettings, applyP2pTestTweaks, initSettingsFile } from "./helpers/settings.ts";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import {
    discoverPeer,
    maybeStartCoturn,
    maybeStartLocalRelay,
    stopCoturnIfStarted,
    stopLocalRelayIfStarted,
} from "./helpers/p2p.ts";
import { assertFilesEqual, runCliOrFail } from "./helpers/cli.ts";
import { createDeterministicDataset } from "./helpers/dataset.ts";
import {
    type BenchmarkVerificationMode,
    parseBenchmarkVerificationMode,
    verifyBenchmarkDataset,
} from "./helpers/benchmarkVerification.ts";

type BenchmarkConfig = {
    caseName: string;
    relay: string;
    appId: string;
    roomId: string;
    passphrase: string;
    turnServers: string;
    datasetDirName: string;
    datasetSeed: string;
    mdFileCount: number;
    mdMinSizeBytes: number;
    mdMaxSizeBytes: number;
    binFileCount: number;
    binSizeBytes: number;
    peersTimeoutSeconds: number;
    syncTimeoutSeconds: number;
    simulationTier: string;
    networkProfile: string;
    networkModel: string;
    candidatePathVerification: string;
    measurementScope: string;
    limitations: string[];
    verificationMode: BenchmarkVerificationMode;
    repeatIndex: number;
    repeatCount: number;
};

type P2PConnectionStats = {
    generatedAt: string;
    command: string;
    peerId: string;
    peerName: string;
    candidatePathCollected: boolean;
    selectedPath: string;
    selectedPair?: {
        id: string;
        state: string;
        currentRoundTripTime: number | "unknown";
        totalRoundTripTime: number | "unknown";
        requestsSent: number | "unknown";
        responsesReceived: number | "unknown";
        packetsDiscardedOnSend: number | "unknown";
        bytesSent: number | "unknown";
        bytesReceived: number | "unknown";
    };
    localCandidate?: {
        id: string;
        candidateType: string;
        protocol: string;
        relayProtocol: string;
    };
    remoteCandidate?: {
        id: string;
        candidateType: string;
        protocol: string;
        relayProtocol: string;
    };
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

function readEnvStringArray(name: string, fallback: string[]): string[] {
    const raw = Deno.env.get(name)?.trim();
    if (!raw) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
            return parsed;
        }
    } catch {
        // Fall through to comma-separated parsing for hand-written invocations.
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
    const mib = kib / 1024;
    return `${mib.toFixed(1)} MiB`;
}

function buildConfig(): BenchmarkConfig {
    return {
        caseName: readEnvString("BENCH_CASE", "p2p-direct-local"),
        relay: readEnvString("BENCH_RELAY", "ws://localhost:4000/"),
        appId: readEnvString("BENCH_APP_ID", "self-hosted-livesync-cli-benchmark"),
        roomId: readEnvString("BENCH_ROOM_ID", `bench-room-${Date.now()}`),
        passphrase: readEnvString("BENCH_PASSPHRASE", `bench-${Date.now()}`),
        turnServers: readEnvString("BENCH_TURN_SERVERS", ""),
        datasetDirName: readEnvString("BENCH_DATASET_DIR", "bench-dataset"),
        datasetSeed: readEnvString("BENCH_SEED", "livesync-benchmark-seed"),
        mdFileCount: Math.floor(readEnvNumber("BENCH_MD_FILE_COUNT", 1500)),
        mdMinSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MIN_SIZE_BYTES", 1024)),
        mdMaxSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MAX_SIZE_BYTES", 20 * 1024)),
        binFileCount: Math.floor(readEnvNumber("BENCH_BIN_FILE_COUNT", 500)),
        binSizeBytes: Math.floor(readEnvNumber("BENCH_BIN_SIZE_BYTES", 100 * 1024)),
        peersTimeoutSeconds: readEnvNumber("BENCH_PEERS_TIMEOUT", 20),
        syncTimeoutSeconds: readEnvNumber("BENCH_SYNC_TIMEOUT", 240),
        simulationTier: readEnvString("BENCH_SIMULATION_TIER", "1"),
        networkProfile: readEnvString("BENCH_NETWORK_PROFILE", "local-direct"),
        networkModel: readEnvString("BENCH_NETWORK_MODEL", "local-runner-webrtc"),
        candidatePathVerification: readEnvString("BENCH_P2P_CANDIDATE_PATH_VERIFICATION", "not-collected"),
        measurementScope: readEnvString(
            "BENCH_MEASUREMENT_SCOPE",
            "One fresh CLI p2p-sync command, including process start-up and WebRTC connection establishment; the earlier peer-list observation command is excluded."
        ),
        limitations: readEnvStringArray("BENCH_LIMITATIONS_JSON", [
            "This benchmark result is scoped to the configured dataset, network model, and selected ICE path.",
        ]),
        verificationMode: parseBenchmarkVerificationMode(Deno.env.get("BENCH_VERIFY_MODE")),
        repeatIndex: Math.floor(readEnvNumber("BENCH_REPEAT_INDEX", 1)),
        repeatCount: Math.floor(readEnvNumber("BENCH_REPEAT_COUNT", 1)),
    };
}

function readOptionalResultPath(): string | undefined {
    const raw = Deno.env.get("BENCH_RESULT_JSON")?.trim();
    if (!raw) {
        return undefined;
    }
    return raw;
}

async function readLatestP2PConnectionStats(statsPath: string): Promise<P2PConnectionStats | undefined> {
    try {
        const text = await Deno.readTextFile(statsPath);
        const lines = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length === 0) {
            return undefined;
        }
        return JSON.parse(lines[lines.length - 1]) as P2PConnectionStats;
    } catch {
        return undefined;
    }
}

async function main(): Promise<void> {
    const config = buildConfig();
    const resultPath = readOptionalResultPath();

    const relayStarted = await maybeStartLocalRelay(config.relay);
    const coturnStarted = await maybeStartCoturn(config.turnServers);
    await using workDir = await TempDir.create("livesync-cli-p2p-bench");

    const hostVault = workDir.join("vault-host");
    const clientVault = workDir.join("vault-client");
    const hostSettings = workDir.join("settings-host.json");
    const clientSettings = workDir.join("settings-client.json");
    const p2pStatsPath = workDir.join("p2p-connection-stats.jsonl");
    const previousStatsPath = Deno.env.get("LIVESYNC_P2P_STATS_JSONL");
    Deno.env.set("LIVESYNC_P2P_STATS_JSONL", p2pStatsPath);

    try {
        await Promise.all([
            Deno.mkdir(hostVault, { recursive: true }),
            Deno.mkdir(clientVault, { recursive: true }),
            initSettingsFile(hostSettings),
            initSettingsFile(clientSettings),
        ]);

        await Promise.all([
            applyP2pSettings(
                hostSettings,
                config.roomId,
                config.passphrase,
                config.appId,
                config.relay,
                "~.*",
                config.turnServers
            ),
            applyP2pSettings(
                clientSettings,
                config.roomId,
                config.passphrase,
                config.appId,
                config.relay,
                "~.*",
                config.turnServers
            ),
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

            const peerDiscoveryCommandStart = nowMs();
            const peer = await discoverPeer(clientVault, clientSettings, config.peersTimeoutSeconds);
            const peerDiscoveryCommandElapsed = nowMs() - peerDiscoveryCommandStart;

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

            const verification = await verifyBenchmarkDataset(
                seedFiles.entries,
                config.verificationMode,
                async (entry) => {
                    const pulledPath = workDir.join(`pulled-${entry.relativePath.replaceAll("/", "_")}`);
                    await runCliOrFail(
                        clientVault,
                        "--settings",
                        clientSettings,
                        "pull",
                        entry.relativePath,
                        pulledPath
                    );
                    await assertFilesEqual(
                        entry.absolutePath,
                        pulledPath,
                        `file mismatch after P2P sync: ${entry.relativePath}`
                    );
                }
            );

            const p2pConnectionStats = await readLatestP2PConnectionStats(p2pStatsPath);
            const result = {
                caseName: config.caseName,
                mode: "p2p-cli-benchmark",
                relay: config.relay,
                turnServers: config.turnServers,
                turnEnabled: config.turnServers.trim().length > 0,
                simulationTier: config.simulationTier,
                networkProfile: config.networkProfile,
                networkModel: config.networkModel,
                measurementScope: config.measurementScope,
                limitations: config.limitations,
                repeatIndex: config.repeatIndex,
                repeatCount: config.repeatCount,
                p2pCandidatePathVerified: p2pConnectionStats?.candidatePathCollected === true,
                p2pCandidatePathVerification: p2pConnectionStats?.candidatePathCollected
                    ? "selected ICE candidate pair collected from RTCPeerConnection.getStats"
                    : config.candidatePathVerification,
                p2pCandidatePathNote: p2pConnectionStats?.candidatePathCollected
                    ? "The selected ICE candidate pair was collected by the CLI benchmark. Interpret the path from the candidate types; do not infer TURN use from configuration alone."
                    : config.turnServers.trim().length > 0
                      ? "TURN is configured, so the selected WebRTC path may be direct, server-reflexive, or relayed. The selected ICE candidate pair was not exported by this run."
                      : "TURN is disabled, so a TURN-relayed path is not expected. The selected ICE candidate pair was not exported by this run.",
                p2pConnectionStats,
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
                ...verification,
                mirrorElapsedMs: Number(mirrorElapsed.toFixed(1)),
                hostReadyElapsedMs: Number(hostReadyElapsed.toFixed(1)),
                peerDiscoveryTimeoutSeconds: config.peersTimeoutSeconds,
                peerDiscoveryCommandElapsedMs: Number(peerDiscoveryCommandElapsed.toFixed(1)),
                peerDiscoveryNote:
                    "p2p-peers waits for the requested timeout before printing discovered peers, so this is command duration, not first-peer latency.",
                syncElapsedMs: Number(syncElapsed.toFixed(1)),
                throughputBytesPerSec: Number((seedFiles.totalBytes / (syncElapsed / 1000)).toFixed(2)),
                throughputMiBPerSec: Number((seedFiles.totalBytes / (syncElapsed / 1000) / 1024 / 1024).toFixed(4)),
            };

            if (resultPath) {
                await Deno.writeTextFile(resultPath, JSON.stringify(result, null, 2));
            }

            console.log(JSON.stringify(result, null, 2));
            console.error(
                `[Benchmark] mirrored ${seedFiles.totalFiles} files (${formatBytes(
                    seedFiles.totalBytes
                )}) in ${formatMs(mirrorElapsed)}, ` +
                    `synced in ${formatMs(syncElapsed)} ` +
                    `(${result.throughputBytesPerSec} B/s, ${result.throughputMiBPerSec} MiB/s)`
            );
        } finally {
            await host.stop();
        }
    } finally {
        if (previousStatsPath === undefined) {
            Deno.env.delete("LIVESYNC_P2P_STATS_JSONL");
        } else {
            Deno.env.set("LIVESYNC_P2P_STATS_JSONL", previousStatsPath);
        }
        await stopCoturnIfStarted(coturnStarted);
        await stopLocalRelayIfStarted(relayStarted);
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(`[Fatal Error]`, error);
        Deno.exit(1);
    });
}
