export type BenchmarkCase = {
    name: string;
    runner: "p2p" | "couchdb";
    description: string;
    dataPath: string;
    trustBoundary: string;
    measurementScope: string;
    limitations: string[];
    env: Record<string, string>;
};

function readEnvString(name: string, fallback: string): string {
    const value = Deno.env.get(name)?.trim();
    return value && value.length > 0 ? value : fallback;
}

function readEnvInteger(name: string, fallback: number): number {
    const value = readEnvString(name, String(fallback));
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${name} must be a positive integer, got '${value}'`);
    }
    return parsed;
}

function timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${
            pad(d.getUTCDate())
        }-` +
        `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${
            pad(d.getUTCSeconds())
        }`
    );
}

function buildBaseEnv(): Record<string, string> {
    return {
        BENCH_MD_FILE_COUNT: readEnvString("BENCH_MD_FILE_COUNT", "20"),
        BENCH_MD_MIN_SIZE_BYTES: readEnvString(
            "BENCH_MD_MIN_SIZE_BYTES",
            "512",
        ),
        BENCH_MD_MAX_SIZE_BYTES: readEnvString(
            "BENCH_MD_MAX_SIZE_BYTES",
            "2048",
        ),
        BENCH_BIN_FILE_COUNT: readEnvString("BENCH_BIN_FILE_COUNT", "5"),
        BENCH_BIN_SIZE_BYTES: readEnvString("BENCH_BIN_SIZE_BYTES", "8192"),
        BENCH_SYNC_TIMEOUT: readEnvString("BENCH_SYNC_TIMEOUT", "300"),
        BENCH_PEERS_TIMEOUT: readEnvString("BENCH_PEERS_TIMEOUT", "60"),
        BENCH_SEED: readEnvString("BENCH_SEED", "livesync-benchmark-seed"),
        BENCH_VERIFY_MODE: readEnvString("BENCH_VERIFY_MODE", "all"),
        LIVESYNC_TEST_TEE: readEnvString("BENCH_LIVESYNC_TEST_TEE", "0"),
    };
}

function withScopeEnv(
    env: Record<string, string>,
    options: Pick<BenchmarkCase, "measurementScope" | "limitations">,
): Record<string, string> {
    return {
        ...env,
        BENCH_MEASUREMENT_SCOPE: options.measurementScope,
        BENCH_LIMITATIONS_JSON: JSON.stringify(options.limitations),
    };
}

function defineCase(testCase: BenchmarkCase): BenchmarkCase {
    return {
        ...testCase,
        env: withScopeEnv(testCase.env, testCase),
    };
}

export function buildCases(): BenchmarkCase[] {
    const base = buildBaseEnv();
    const couchdbRtt = readEnvString("BENCH_COUCHDB_RTT_MS", "20");
    const tetheringVpnRtt = readEnvString("BENCH_TETHERING_VPN_RTT_MS", "120");
    const localTurnServers = readEnvString(
        "BENCH_LOCAL_TURN_SERVERS",
        "turn:127.0.0.1:3478",
    );
    const shimCouchdbUri = readEnvString(
        "BENCH_SHIM_COUCHDB_URI",
        "http://couchdb-shim:5984",
    );
    const signallingShimRelay = readEnvString(
        "BENCH_SIGNAL_SHIM_RELAY",
        "ws://p2p-signalling-shim:7777/",
    );

    return [
        defineCase({
            name: "couchdb-baseline",
            runner: "couchdb",
            description:
                "Standard self-hosted CouchDB path through a local latency proxy.",
            dataPath: "Device A -> CouchDB -> Device B",
            trustBoundary: "CouchDB operator and network path",
            measurementScope:
                "Two one-shot synchronisation phases through a CouchDB-compatible remote-store path with a local HTTP latency proxy.",
            limitations: [
                "This is not a full netem model of packet loss, jitter, MTU, bandwidth limits, or VPN encapsulation.",
                "This result should be compared with P2P only as a remote-store baseline under the same deterministic dataset.",
            ],
            env: {
                ...base,
                BENCH_CASE: "couchdb-baseline",
                BENCH_COUCHDB_RTT_MS: couchdbRtt,
            },
        }),
        defineCase({
            name: "p2p-direct-local",
            runner: "p2p",
            description:
                "Preferred direct WebRTC P2P path with Nostr signalling and TURN disabled.",
            dataPath: "Device A -> Device B",
            trustBoundary: "Nostr relay for signalling metadata; no TURN relay",
            measurementScope:
                "One fresh CLI p2p-sync command, including process start-up and WebRTC connection establishment, with TURN disabled; the earlier peer-list observation command is excluded.",
            limitations: [
                "The timed command includes its own signalling and connection establishment, but not the earlier peer-list observation window.",
                "This does not measure public relay operation, mobile carrier behaviour, or TURN-relayed throughput.",
                "This small-dataset run should not be treated as a WAN, VPN, or large binary initial synchronisation measurement.",
            ],
            env: {
                ...base,
                BENCH_CASE: "p2p-direct-local",
                BENCH_TURN_SERVERS: "",
                BENCH_SIMULATION_TIER: "1",
                BENCH_NETWORK_PROFILE: "local-direct",
                BENCH_NETWORK_MODEL: "local-runner-webrtc",
                BENCH_P2P_CANDIDATE_PATH_VERIFICATION:
                    "turn-disabled-but-selected-ice-pair-not-collected",
            },
        }),
        defineCase({
            name: "couchdb-tethering-vpn-proxy",
            runner: "couchdb",
            description:
                "Approximate smartphone tethering/VPN remote-database path using an HTTP latency proxy. This does not model loss, jitter, MTU, or VPN encapsulation.",
            dataPath:
                "Device A -> VPN/network path -> CouchDB -> VPN/network path -> Device B",
            trustBoundary: "VPN/network path and CouchDB operator",
            measurementScope:
                "Two one-shot CouchDB synchronisation phases with additional requested RTT through the local HTTP proxy.",
            limitations: [
                "This approximates request latency only and does not model loss, jitter, MTU, bandwidth limits, carrier NAT, or VPN encapsulation.",
                "Use the Tier 2 netem shim cases for a stronger constrained-network fixture.",
            ],
            env: {
                ...base,
                BENCH_CASE: "couchdb-tethering-vpn-proxy",
                BENCH_COUCHDB_RTT_MS: tetheringVpnRtt,
            },
        }),
        defineCase({
            name: "couchdb-netem-home-wifi",
            runner: "couchdb",
            description:
                "Tier 2 CouchDB path through the Compose netem TCP shim using the home-wifi profile.",
            dataPath:
                "Device A -> netem TCP shim -> CouchDB -> netem TCP shim -> Device B",
            trustBoundary: "CouchDB operator and constrained network shim",
            measurementScope:
                "Tier 2 CouchDB synchronisation through a Compose TCP shim that applies the home-wifi netem profile.",
            limitations: [
                "This shapes the CouchDB TCP path, not the WebRTC P2P data path.",
                "The fixture remains a reproducible network emulation, not a field measurement on a real home network.",
            ],
            env: {
                ...base,
                BENCH_CASE: "couchdb-netem-home-wifi",
                BENCH_COUCHDB_BACKEND_URI: shimCouchdbUri,
                BENCH_COUCHDB_RTT_MS: "1",
                BENCH_SIMULATION_TIER: "2",
                BENCH_NETWORK_PROFILE: "home-wifi",
                BENCH_NETWORK_MODEL: "compose-netem-tcp-shim",
            },
        }),
        defineCase({
            name: "couchdb-netem-tethering-vpn",
            runner: "couchdb",
            description:
                "Tier 2 CouchDB path through the Compose netem TCP shim using a tethering-vpn profile.",
            dataPath:
                "Device A -> netem TCP shim -> CouchDB -> netem TCP shim -> Device B",
            trustBoundary:
                "CouchDB operator and constrained smartphone/VPN-like network shim",
            measurementScope:
                "Tier 2 CouchDB synchronisation through a Compose TCP shim that applies the tethering-vpn netem profile.",
            limitations: [
                "This shapes the CouchDB TCP path, not the WebRTC P2P data path.",
                "The profile approximates smartphone/VPN constraints but is not a field measurement on a real tethered VPN connection.",
            ],
            env: {
                ...base,
                BENCH_CASE: "couchdb-netem-tethering-vpn",
                BENCH_COUCHDB_BACKEND_URI: shimCouchdbUri,
                BENCH_COUCHDB_RTT_MS: "1",
                BENCH_SIMULATION_TIER: "2",
                BENCH_NETWORK_PROFILE: "tethering-vpn",
                BENCH_NETWORK_MODEL: "compose-netem-tcp-shim",
            },
        }),
        defineCase({
            name: "p2p-smartphone-vpn-direct",
            runner: "p2p",
            description:
                "Direct P2P case name for smartphone tethering/VPN measurements. In this local runner it is unshaped and should be treated as a wiring check unless executed on that network.",
            dataPath:
                "Device A -> Device B when WebRTC direct connectivity succeeds",
            trustBoundary:
                "Smartphone/VPN routing policy plus Nostr signalling metadata",
            measurementScope:
                "Structural placeholder for direct P2P measurements on a real smartphone tethering/VPN path.",
            limitations: [
                "In the local runner this is unshaped and must not be reported as smartphone, VPN, WAN, or Tier 2 evidence.",
                "Use only when the command is executed on the intended real network path and the selected ICE candidate pair is recorded.",
            ],
            env: {
                ...base,
                BENCH_CASE: "p2p-smartphone-vpn-direct",
                BENCH_TURN_SERVERS: "",
                BENCH_SIMULATION_TIER: "unmeasured",
                BENCH_NETWORK_PROFILE: "smartphone-vpn-direct-placeholder",
                BENCH_NETWORK_MODEL: "local-runner-no-netem",
                BENCH_P2P_CANDIDATE_PATH_VERIFICATION:
                    "structural-placeholder-only; selected ICE pair may be collected, but the path is not shaped",
            },
        }),
        defineCase({
            name: "p2p-signalling-netem-home-wifi",
            runner: "p2p",
            description:
                "Tier 2 P2P path with only the Nostr signalling relay accessed through the home-wifi netem shim.",
            dataPath:
                "Device A -> Device B over WebRTC DataChannel; Nostr signalling through netem shim",
            trustBoundary:
                "Nostr signalling metadata through constrained network shim; no TURN relay",
            measurementScope:
                "One fresh CLI p2p-sync command where only Nostr signalling access is shaped by the home-wifi netem profile; the selected WebRTC note-data path is unshaped.",
            limitations: [
                "The timed p2p-sync command includes signalling and WebRTC connection establishment.",
                "This does not shape the selected WebRTC DataChannel note-data path.",
                "This supports only the claim that constrained signalling access does not place note data on the relay path when a non-relayed ICE path is selected.",
            ],
            env: {
                ...base,
                BENCH_CASE: "p2p-signalling-netem-home-wifi",
                BENCH_RELAY: signallingShimRelay,
                BENCH_TURN_SERVERS: "",
                BENCH_SIMULATION_TIER: "2",
                BENCH_NETWORK_PROFILE: "home-wifi",
                BENCH_NETWORK_MODEL: "compose-netem-signalling-shim",
                BENCH_P2P_CANDIDATE_PATH_VERIFICATION:
                    "selected ICE pair collected; only Nostr signalling path is shaped",
            },
        }),
        defineCase({
            name: "p2p-signalling-netem-tethering-vpn",
            runner: "p2p",
            description:
                "Tier 2 P2P path with only the Nostr signalling relay accessed through the tethering-vpn netem shim.",
            dataPath:
                "Device A -> Device B over WebRTC DataChannel; Nostr signalling through netem shim",
            trustBoundary:
                "Nostr signalling metadata through constrained smartphone/VPN-like network shim; no TURN relay",
            measurementScope:
                "One fresh CLI p2p-sync command where only Nostr signalling access is shaped by the tethering-vpn netem profile; the selected WebRTC note-data path is unshaped.",
            limitations: [
                "The timed p2p-sync command includes signalling and WebRTC connection establishment.",
                "This does not shape the selected WebRTC DataChannel note-data path.",
                "The profile approximates constrained relay access and is not a field measurement on a real tethered VPN connection.",
            ],
            env: {
                ...base,
                BENCH_CASE: "p2p-signalling-netem-tethering-vpn",
                BENCH_RELAY: signallingShimRelay,
                BENCH_TURN_SERVERS: "",
                BENCH_SIMULATION_TIER: "2",
                BENCH_NETWORK_PROFILE: "tethering-vpn",
                BENCH_NETWORK_MODEL: "compose-netem-signalling-shim",
                BENCH_P2P_CANDIDATE_PATH_VERIFICATION:
                    "selected ICE pair collected; only Nostr signalling path is shaped",
            },
        }),
        defineCase({
            name: "p2p-user-turn",
            runner: "p2p",
            description:
                "Optional fallback path through a local user-controlled TURN server.",
            dataPath: "Device A -> user-controlled TURN -> Device B",
            trustBoundary: "User-controlled TURN server",
            measurementScope:
                "Optional local TURN fallback wiring check with a user-controlled TURN server configured.",
            limitations: [
                "TURN configuration does not prove that the selected ICE path was relayed; interpret the recorded candidate pair.",
                "This is not evidence for public TURN relay privacy, throughput, or availability.",
            ],
            env: {
                ...base,
                BENCH_CASE: "p2p-user-turn",
                BENCH_TURN_SERVERS: localTurnServers,
                BENCH_SIMULATION_TIER: "1",
                BENCH_NETWORK_PROFILE: "local-turn-fallback",
                BENCH_NETWORK_MODEL: "local-runner-webrtc-turn-configured",
                BENCH_P2P_CANDIDATE_PATH_VERIFICATION:
                    "turn-configured; selected ICE pair may still be direct or relayed, so interpret the recorded candidate types",
            },
        }),
    ];
}

async function runCase(
    testCase: BenchmarkCase,
    outputDir: string,
    repeatIndex: number,
    repeatCount: number,
): Promise<Record<string, unknown>> {
    const suffix = repeatCount > 1
        ? `-r${String(repeatIndex).padStart(2, "0")}`
        : "";
    const resultPath = `${outputDir}/${testCase.name}${suffix}.json`;
    const taskName = testCase.runner === "p2p" ? "bench:p2p" : "bench:couchdb";
    const env = {
        ...Deno.env.toObject(),
        ...testCase.env,
        BENCH_RESULT_JSON: resultPath,
        BENCH_REPEAT_INDEX: String(repeatIndex),
        BENCH_REPEAT_COUNT: String(repeatCount),
    };

    const repeatLabel = repeatCount > 1
        ? ` (${repeatIndex}/${repeatCount})`
        : "";
    console.log(
        `[bench-cases] running ${testCase.name}${repeatLabel}: ${testCase.description}`,
    );
    const command = new Deno.Command("deno", {
        args: ["task", taskName],
        cwd: import.meta.dirname,
        env,
        stdin: "null",
        stdout: "inherit",
        stderr: "inherit",
    });

    const child = command.spawn();
    const status = await child.status;
    if (status.code !== 0) {
        throw new Error(`case failed: ${testCase.name} (exit ${status.code})`);
    }

    const result = JSON.parse(await Deno.readTextFile(resultPath)) as Record<
        string,
        unknown
    >;
    return {
        ...testCase,
        repeatIndex,
        repeatCount,
        resultPath,
        result,
    };
}

function selectCases(allCases: BenchmarkCase[]): BenchmarkCase[] {
    const requested = readEnvString(
        "BENCH_CASES",
        "couchdb-baseline,p2p-direct-local",
    );
    const names = requested
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    const byName = new Map(allCases.map((c) => [c.name, c]));
    return names.map((name) => {
        const found = byName.get(name);
        if (!found) {
            throw new Error(
                `Unknown BENCH_CASES entry '${name}'. Available: ${
                    allCases.map((c) => c.name).join(", ")
                }`,
            );
        }
        return found;
    });
}

async function main(): Promise<void> {
    const outRoot = readEnvString(
        "BENCH_CASES_ROOT",
        `${import.meta.dirname}/bench-results`,
    );
    const outputDir = `${outRoot}/cases-${timestamp()}`;
    await Deno.mkdir(outputDir, { recursive: true });

    const allCases = buildCases();
    const cases = selectCases(allCases);
    const repeatCount = readEnvInteger("BENCH_REPEAT_COUNT", 1);
    await Deno.writeTextFile(
        `${outputDir}/case-manifest.json`,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                repeatCount,
                selectedCases: cases,
                availableCases: allCases,
            },
            null,
            2,
        ),
    );

    const results: Record<string, unknown>[] = [];
    for (const testCase of cases) {
        for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex++) {
            results.push(
                await runCase(testCase, outputDir, repeatIndex, repeatCount),
            );
        }
    }

    const summary = {
        generatedAt: new Date().toISOString(),
        outputDir,
        repeatCount,
        results,
    };
    await Deno.writeTextFile(
        `${outputDir}/summary.json`,
        JSON.stringify(summary, null, 2),
    );
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[bench-cases] result directory: ${outputDir}`);
}

if (import.meta.main) {
    main().catch((error) => {
        console.error("[Fatal Error]", error);
        Deno.exit(1);
    });
}
