import { join } from "@std/path";
import { startCliInBackground } from "./helpers/backgroundCli.ts";
import { assertFilesEqual, runCliOrFail } from "./helpers/cli.ts";
import { createDeterministicDataset, type DatasetEntry } from "./helpers/dataset.ts";
import { discoverPeer } from "./helpers/p2p.ts";
import { applyP2pSettings, applyP2pTestTweaks, initSettingsFile } from "./helpers/settings.ts";

type Role = "host" | "client";

type NetemSummary = {
    enabled: boolean;
    profile: string;
    interface: string;
    delayMs: number;
    jitterMs: number;
    lossPercent: number;
    bandwidthMbit: number;
    mtu: number;
    tcQdisc?: string;
    ipAddr?: string;
    ipRoute?: string;
};

type HostReady = {
    generatedAt: string;
    totalFiles: number;
    totalBytes: number;
    mdFileCount: number;
    binFileCount: number;
    mirrorElapsedMs: number;
    netem: NetemSummary;
};

type P2PConnectionStats = {
    candidatePathCollected: boolean;
    selectedPath: string;
    localCandidate?: { candidateType: string; protocol: string; relayProtocol: string };
    remoteCandidate?: { candidateType: string; protocol: string; relayProtocol: string };
};

function errorToRecord(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return {
        name: "UnknownError",
        message: String(error),
    };
}

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
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative number, got '${raw}'`);
    }
    return parsed;
}

function nowMs(): number {
    return performance.now();
}

async function commandOutput(command: string, args: string[]): Promise<string> {
    const output = await new Deno.Command(command, {
        args,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (!output.success) {
        throw new Error(`${command} ${args.join(" ")} failed\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    return stdout.trim();
}

async function commandOk(command: string, args: string[]): Promise<void> {
    await commandOutput(command, args);
}

async function applyNetemIfRequested(): Promise<NetemSummary> {
    const enabled = readEnvString("BENCH_NETEM_ENABLED", "0") === "1";
    const profile = readEnvString("NETEM_PROFILE", "home-wifi");
    const iface = readEnvString("NETEM_INTERFACE", "eth0");
    const delayMs = readEnvNumber("NETEM_DELAY_MS", 20);
    const jitterMs = readEnvNumber("NETEM_JITTER_MS", 5);
    const lossPercent = readEnvNumber("NETEM_LOSS_PERCENT", 0.1);
    const bandwidthMbit = readEnvNumber("NETEM_BANDWIDTH_MBIT", 100);
    const mtu = readEnvNumber("NETEM_MTU", 1500);

    const summary: NetemSummary = {
        enabled,
        profile,
        interface: iface,
        delayMs,
        jitterMs,
        lossPercent,
        bandwidthMbit,
        mtu,
    };

    if (!enabled) {
        return summary;
    }

    await commandOk("ip", ["link", "set", "dev", iface, "mtu", String(mtu)]);
    await new Deno.Command("tc", { args: ["qdisc", "del", "dev", iface, "root"] }).output();
    await commandOk("tc", [
        "qdisc",
        "add",
        "dev",
        iface,
        "root",
        "netem",
        "delay",
        `${delayMs}ms`,
        `${jitterMs}ms`,
        "loss",
        `${lossPercent}%`,
        "rate",
        `${bandwidthMbit}mbit`,
    ]);
    summary.tcQdisc = await commandOutput("tc", ["qdisc", "show", "dev", iface]);
    summary.ipAddr = await commandOutput("ip", ["addr", "show", iface]);
    summary.ipRoute = await commandOutput("ip", ["route"]);
    return summary;
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const stat = await Deno.stat(path);
            if (stat.isFile) {
                return;
            }
        } catch {
            // wait
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}`);
}

async function readJsonFile<T>(path: string): Promise<T> {
    return JSON.parse(await Deno.readTextFile(path)) as T;
}

function pickSampleFiles(entries: DatasetEntry[]): DatasetEntry[] {
    const unique = new Map<string, DatasetEntry>();
    for (const entry of [entries.find((e) => e.kind === "md"), entries.find((e) => e.kind === "bin"), entries.at(-1)]) {
        if (entry) {
            unique.set(entry.relativePath, entry);
        }
    }
    return [...unique.values()];
}

async function readLatestP2PConnectionStats(path: string): Promise<P2PConnectionStats | undefined> {
    try {
        const lines = (await Deno.readTextFile(path))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        return lines.length === 0 ? undefined : (JSON.parse(lines.at(-1)!) as P2PConnectionStats);
    } catch {
        return undefined;
    }
}

function buildCommonConfig() {
    const runId = readEnvString("BENCH_SPLIT_RUN_ID", readEnvString("BENCH_ROOM_ID", "bench-split-run"));
    const baseWorkRoot = readEnvString("BENCH_SPLIT_WORK_ROOT", "/p2p-work");
    return {
        runId,
        workRoot: join(baseWorkRoot, runId),
        resultRoot: readEnvString("BENCH_SPLIT_RESULT_ROOT", "/workspace/src/apps/cli/testdeno/bench-results"),
        relay: readEnvString("BENCH_RELAY", "ws://nostr-relay:7777/"),
        appId: readEnvString("BENCH_APP_ID", "self-hosted-livesync-cli-benchmark"),
        roomId: readEnvString("BENCH_ROOM_ID", "bench-split-room"),
        passphrase: readEnvString("BENCH_PASSPHRASE", "bench-split-passphrase"),
        turnServers: readEnvString("BENCH_TURN_SERVERS", ""),
        datasetDirName: readEnvString("BENCH_DATASET_DIR", "bench-dataset"),
        datasetSeed: readEnvString("BENCH_SEED", "livesync-benchmark-seed"),
        mdFileCount: Math.floor(readEnvNumber("BENCH_MD_FILE_COUNT", 20)),
        mdMinSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MIN_SIZE_BYTES", 512)),
        mdMaxSizeBytes: Math.floor(readEnvNumber("BENCH_MD_MAX_SIZE_BYTES", 2048)),
        binFileCount: Math.floor(readEnvNumber("BENCH_BIN_FILE_COUNT", 5)),
        binSizeBytes: Math.floor(readEnvNumber("BENCH_BIN_SIZE_BYTES", 8192)),
        peersTimeoutSeconds: readEnvNumber("BENCH_PEERS_TIMEOUT", 60),
        syncTimeoutSeconds: readEnvNumber("BENCH_SYNC_TIMEOUT", 300),
        nodeTimeoutMs: readEnvNumber("BENCH_SPLIT_NODE_TIMEOUT_MS", 360_000),
        profile: readEnvString("BENCH_NETWORK_PROFILE", readEnvString("NETEM_PROFILE", "split-compose")),
    };
}

async function prepareP2PSettings(
    settingsPath: string,
    peerName: string,
    config: ReturnType<typeof buildCommonConfig>
) {
    await initSettingsFile(settingsPath);
    await applyP2pSettings(
        settingsPath,
        config.roomId,
        config.passphrase,
        config.appId,
        config.relay,
        "~.*",
        config.turnServers
    );
    await applyP2pTestTweaks(settingsPath, peerName, config.passphrase);
}

async function runHost(): Promise<void> {
    const config = buildCommonConfig();
    const netem = await applyNetemIfRequested();
    await Deno.mkdir(config.workRoot, { recursive: true });
    await Deno.mkdir(config.resultRoot, { recursive: true });

    const hostVault = join(config.workRoot, "vault-host");
    const hostSettings = join(config.workRoot, "settings-host.json");
    await Deno.mkdir(hostVault, { recursive: true });
    await prepareP2PSettings(hostSettings, "p2p-split-host", config);

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
    await Deno.writeTextFile(
        join(config.workRoot, "sample-files.json"),
        JSON.stringify(pickSampleFiles(seedFiles.entries), null, 2)
    );

    const mirrorStart = nowMs();
    await runCliOrFail(hostVault, "--settings", hostSettings, "mirror");
    const mirrorElapsedMs = Number((nowMs() - mirrorStart).toFixed(1));
    const hostReady: HostReady = {
        generatedAt: new Date().toISOString(),
        totalFiles: seedFiles.totalFiles,
        totalBytes: seedFiles.totalBytes,
        mdFileCount: seedFiles.mdCount,
        binFileCount: seedFiles.binCount,
        mirrorElapsedMs,
        netem,
    };
    await Deno.writeTextFile(join(config.workRoot, "host-ready.json"), JSON.stringify(hostReady, null, 2));

    const host = startCliInBackground(hostVault, "--settings", hostSettings, "p2p-host");
    try {
        await host.waitUntilContains("P2P host is running", 20_000);
        await Deno.writeTextFile(
            join(config.workRoot, "p2p-host-ready.json"),
            JSON.stringify({ generatedAt: new Date().toISOString() })
        );
        await waitForFile(join(config.workRoot, "client-done.json"), config.nodeTimeoutMs);
    } finally {
        await host.stop();
    }
}

async function runClient(): Promise<void> {
    const config = buildCommonConfig();
    const netem = await applyNetemIfRequested();
    await Deno.mkdir(config.resultRoot, { recursive: true });
    await waitForFile(join(config.workRoot, "host-ready.json"), config.nodeTimeoutMs);
    await waitForFile(join(config.workRoot, "p2p-host-ready.json"), config.nodeTimeoutMs);

    const clientVault = join(config.workRoot, "vault-client");
    const clientSettings = join(config.workRoot, "settings-client.json");
    const statsPath = join(config.workRoot, "p2p-connection-stats.jsonl");
    await Deno.mkdir(clientVault, { recursive: true });
    await prepareP2PSettings(clientSettings, "p2p-split-client", config);

    const hostReady = await readJsonFile<HostReady>(join(config.workRoot, "host-ready.json"));
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    const outputDir = join(config.resultRoot, `p2p-split-${config.profile}-${timestamp}`);
    await Deno.mkdir(outputDir, { recursive: true });

    const previousStatsPath = Deno.env.get("LIVESYNC_P2P_STATS_JSONL");
    Deno.env.set("LIVESYNC_P2P_STATS_JSONL", statsPath);
    let stage = "peer-discovery";
    let peerDiscoveryCommandElapsedMs: number | undefined;
    let syncElapsedMs: number | undefined;
    try {
        const peerDiscoveryCommandStart = nowMs();
        const peer = await discoverPeer(clientVault, clientSettings, config.peersTimeoutSeconds);
        peerDiscoveryCommandElapsedMs = Number((nowMs() - peerDiscoveryCommandStart).toFixed(1));

        stage = "p2p-sync";
        const syncStart = nowMs();
        await runCliOrFail(
            clientVault,
            "--settings",
            clientSettings,
            "p2p-sync",
            peer.id,
            String(config.syncTimeoutSeconds)
        );
        syncElapsedMs = Number((nowMs() - syncStart).toFixed(1));

        stage = "sample-verification";
        const samples = await readJsonFile<DatasetEntry[]>(join(config.workRoot, "sample-files.json"));
        for (const sample of samples) {
            const pulledPath = join(config.workRoot, `pulled-${sample.relativePath.replaceAll("/", "_")}`);
            await runCliOrFail(clientVault, "--settings", clientSettings, "pull", sample.relativePath, pulledPath);
            await assertFilesEqual(
                sample.absolutePath,
                pulledPath,
                `sample file mismatch after split sync: ${sample.relativePath}`
            );
        }

        const p2pConnectionStats = await readLatestP2PConnectionStats(statsPath);
        const result = {
            ok: true,
            generatedAt: new Date().toISOString(),
            caseName: "p2p-split-compose",
            mode: "p2p-split-compose-benchmark",
            runId: config.runId,
            simulationTier: Deno.env.get("BENCH_NETEM_ENABLED") === "1" ? "2" : "1",
            networkProfile: config.profile,
            networkModel:
                Deno.env.get("BENCH_NETEM_ENABLED") === "1" ? "split-compose-egress-netem" : "split-compose-no-netem",
            relay: config.relay,
            turnServers: config.turnServers,
            turnEnabled: config.turnServers.trim().length > 0,
            p2pCandidatePathVerified: p2pConnectionStats?.candidatePathCollected === true,
            p2pConnectionStats,
            hostNetem: hostReady.netem,
            clientNetem: netem,
            totalFiles: hostReady.totalFiles,
            totalBytes: hostReady.totalBytes,
            mdFileCount: hostReady.mdFileCount,
            binFileCount: hostReady.binFileCount,
            mirrorElapsedMs: hostReady.mirrorElapsedMs,
            peerDiscoveryTimeoutSeconds: config.peersTimeoutSeconds,
            peerDiscoveryCommandElapsedMs,
            syncElapsedMs,
            throughputBytesPerSec: Number((hostReady.totalBytes / (syncElapsedMs / 1000)).toFixed(2)),
            throughputMiBPerSec: Number((hostReady.totalBytes / (syncElapsedMs / 1000) / 1024 / 1024).toFixed(4)),
        };
        await Deno.writeTextFile(join(outputDir, "summary.json"), JSON.stringify(result, null, 2));
        await Deno.writeTextFile(
            join(config.workRoot, "client-done.json"),
            JSON.stringify({ generatedAt: new Date().toISOString(), outputDir, ok: true })
        );
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        const p2pConnectionStats = await readLatestP2PConnectionStats(statsPath);
        const result = {
            ok: false,
            generatedAt: new Date().toISOString(),
            caseName: "p2p-split-compose",
            mode: "p2p-split-compose-benchmark",
            runId: config.runId,
            simulationTier: Deno.env.get("BENCH_NETEM_ENABLED") === "1" ? "2" : "1",
            networkProfile: config.profile,
            networkModel:
                Deno.env.get("BENCH_NETEM_ENABLED") === "1" ? "split-compose-egress-netem" : "split-compose-no-netem",
            relay: config.relay,
            turnServers: config.turnServers,
            turnEnabled: config.turnServers.trim().length > 0,
            p2pCandidatePathVerified: p2pConnectionStats?.candidatePathCollected === true,
            p2pConnectionStats,
            hostNetem: hostReady.netem,
            clientNetem: netem,
            totalFiles: hostReady.totalFiles,
            totalBytes: hostReady.totalBytes,
            mdFileCount: hostReady.mdFileCount,
            binFileCount: hostReady.binFileCount,
            mirrorElapsedMs: hostReady.mirrorElapsedMs,
            peerDiscoveryTimeoutSeconds: config.peersTimeoutSeconds,
            peerDiscoveryCommandElapsedMs,
            syncElapsedMs,
            failure: {
                stage,
                ...errorToRecord(error),
            },
        };
        await Deno.writeTextFile(join(outputDir, "summary.json"), JSON.stringify(result, null, 2));
        await Deno.writeTextFile(
            join(config.workRoot, "client-done.json"),
            JSON.stringify({ generatedAt: new Date().toISOString(), outputDir, ok: false })
        );
        console.log(JSON.stringify(result, null, 2));
        throw error;
    } finally {
        if (previousStatsPath === undefined) {
            Deno.env.delete("LIVESYNC_P2P_STATS_JSONL");
        } else {
            Deno.env.set("LIVESYNC_P2P_STATS_JSONL", previousStatsPath);
        }
    }
}

async function main(): Promise<void> {
    const role = readEnvString("BENCH_P2P_SPLIT_ROLE", "") as Role;
    if (role === "host") {
        await runHost();
        return;
    }
    if (role === "client") {
        await runClient();
        return;
    }
    throw new Error("BENCH_P2P_SPLIT_ROLE must be 'host' or 'client'");
}

if (import.meta.main) {
    main().catch((error) => {
        console.error("[Fatal Error]", error);
        Deno.exit(1);
    });
}
