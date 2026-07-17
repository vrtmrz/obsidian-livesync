type SweepResult = {
    name: string;
    runner: "p2p" | "couchdb";
    rttMs?: number;
    repeatIndex: number;
    repeatCount: number;
    result: Record<string, unknown>;
};

function readEnvString(name: string, fallback: string): string {
    const value = Deno.env.get(name)?.trim();
    return value && value.length > 0 ? value : fallback;
}

function timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
        `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
    );
}

function readEnvInteger(name: string, fallback: number): number {
    const raw = readEnvString(name, String(fallback));
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${name} must be a positive integer, got '${raw}'`);
    }
    return parsed;
}

function parseRttList(raw: string): number[] {
    const values = raw
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
    if (values.length === 0) {
        throw new Error(`BENCH_SWEEP_RTT_MS must contain at least one positive number, got '${raw}'`);
    }
    return values;
}

function buildBaseEnv(): Record<string, string> {
    return {
        BENCH_MD_FILE_COUNT: readEnvString("BENCH_MD_FILE_COUNT", "20"),
        BENCH_MD_MIN_SIZE_BYTES: readEnvString("BENCH_MD_MIN_SIZE_BYTES", "512"),
        BENCH_MD_MAX_SIZE_BYTES: readEnvString("BENCH_MD_MAX_SIZE_BYTES", "2048"),
        BENCH_BIN_FILE_COUNT: readEnvString("BENCH_BIN_FILE_COUNT", "5"),
        BENCH_BIN_SIZE_BYTES: readEnvString("BENCH_BIN_SIZE_BYTES", "8192"),
        BENCH_SYNC_TIMEOUT: readEnvString("BENCH_SYNC_TIMEOUT", "300"),
        BENCH_PEERS_TIMEOUT: readEnvString("BENCH_PEERS_TIMEOUT", "60"),
        BENCH_SEED: readEnvString("BENCH_SEED", "livesync-benchmark-seed"),
        BENCH_VERIFY_MODE: readEnvString("BENCH_VERIFY_MODE", "all"),
        LIVESYNC_TEST_TEE: readEnvString("BENCH_LIVESYNC_TEST_TEE", "0"),
    };
}

async function runBenchmark(options: {
    taskName: "bench:p2p" | "bench:couchdb";
    name: string;
    outputDir: string;
    env: Record<string, string>;
    repeatIndex: number;
    repeatCount: number;
}): Promise<Record<string, unknown>> {
    const suffix = options.repeatCount > 1 ? `-r${String(options.repeatIndex).padStart(2, "0")}` : "";
    const resultPath = `${options.outputDir}/${options.name}${suffix}.json`;
    const env = {
        ...Deno.env.toObject(),
        ...options.env,
        BENCH_RESULT_JSON: resultPath,
        BENCH_REPEAT_INDEX: String(options.repeatIndex),
        BENCH_REPEAT_COUNT: String(options.repeatCount),
    };

    console.log(`[latency-sweep] running ${options.name}`);
    const child = new Deno.Command("deno", {
        args: ["task", options.taskName],
        cwd: import.meta.dirname,
        env,
        stdin: "null",
        stdout: "inherit",
        stderr: "inherit",
    }).spawn();
    const status = await child.status;
    if (status.code !== 0) {
        throw new Error(`benchmark failed: ${options.name} (exit ${status.code})`);
    }
    return JSON.parse(await Deno.readTextFile(resultPath)) as Record<string, unknown>;
}

async function main(): Promise<void> {
    const outRoot = readEnvString("BENCH_SWEEP_ROOT", `${import.meta.dirname}/bench-results`);
    const outputDir = `${outRoot}/latency-sweep-${timestamp()}`;
    const rtts = parseRttList(readEnvString("BENCH_SWEEP_RTT_MS", "20,50,100,150,300"));
    const repeatCount = readEnvInteger("BENCH_REPEAT_COUNT", 1);
    const base = buildBaseEnv();

    await Deno.mkdir(outputDir, { recursive: true });

    const results: SweepResult[] = [];
    if (readEnvString("BENCH_SWEEP_INCLUDE_P2P", "true") !== "false") {
        for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex++) {
            const p2pResult = await runBenchmark({
                taskName: "bench:p2p",
                name: "p2p-direct-local",
                outputDir,
                repeatIndex,
                repeatCount,
                env: {
                    ...base,
                    BENCH_CASE: "p2p-direct-local",
                    BENCH_TURN_SERVERS: "",
                },
            });
            results.push({
                name: "p2p-direct-local",
                runner: "p2p",
                repeatIndex,
                repeatCount,
                result: p2pResult,
            });
        }
    }

    for (const rtt of rtts) {
        const name = `couchdb-rtt-${rtt}ms`;
        for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex++) {
            const couchdbResult = await runBenchmark({
                taskName: "bench:couchdb",
                name,
                outputDir,
                repeatIndex,
                repeatCount,
                env: {
                    ...base,
                    BENCH_CASE: name,
                    BENCH_COUCHDB_RTT_MS: String(rtt),
                },
            });
            results.push({
                name,
                runner: "couchdb",
                rttMs: rtt,
                repeatIndex,
                repeatCount,
                result: couchdbResult,
            });
        }
    }

    const summary = {
        generatedAt: new Date().toISOString(),
        outputDir,
        note: "This sweep applies half of each requested CouchDB RTT before forwarding requests and half before returning responses. It is not a full netem model of jitter, loss, MTU, bandwidth, or VPN encapsulation.",
        rtts,
        repeatCount,
        results,
    };
    await Deno.writeTextFile(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[latency-sweep] result directory: ${outputDir}`);
}

if (import.meta.main) {
    main().catch((error) => {
        console.error("[Fatal Error]", error);
        Deno.exit(1);
    });
}
