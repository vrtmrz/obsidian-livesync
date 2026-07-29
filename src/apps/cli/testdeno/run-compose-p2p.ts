const repositoryRoot = await Deno.realPath(new URL("../../../../", import.meta.url));
const composeArgs = ["compose", "-f", "test/bench-network/compose.yml"];
const p2pEnvironment = {
    CLI_E2E_TASK: Deno.env.get("CLI_E2E_TASK") ?? "test:p2p:ci",
    RELAY: Deno.env.get("RELAY") ?? "ws://nostr-relay:7777/",
    PEERS_TIMEOUT: Deno.env.get("PEERS_TIMEOUT") ?? "20",
    SYNC_TIMEOUT: Deno.env.get("SYNC_TIMEOUT") ?? "60",
    LIVESYNC_USE_COTURN: Deno.env.get("LIVESYNC_USE_COTURN") ?? "0",
    TURN_SERVERS: Deno.env.get("TURN_SERVERS") ?? "none",
    LIVESYNC_P2P_PEERS_RETRY: Deno.env.get("LIVESYNC_P2P_PEERS_RETRY") ?? "1",
    LIVESYNC_P2P_RELAY_READY_TIMEOUT_MS: Deno.env.get("LIVESYNC_P2P_RELAY_READY_TIMEOUT_MS") ?? "60000",
    BENCH_LIVESYNC_TEST_TEE: Deno.env.get("BENCH_LIVESYNC_TEST_TEE") ?? "0",
    LIVESYNC_CLI_DEBUG: Deno.env.get("LIVESYNC_CLI_DEBUG") ?? "0",
    LIVESYNC_CLI_VERBOSE: Deno.env.get("LIVESYNC_CLI_VERBOSE") ?? "0",
};

async function runDocker(args: string[], env?: Record<string, string>): Promise<Deno.CommandStatus> {
    return await new Deno.Command("docker", {
        args,
        cwd: repositoryRoot,
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    }).spawn().status;
}

let testStatus: Deno.CommandStatus | undefined;
try {
    testStatus = await runDocker(
        [...composeArgs, "run", "--build", "--rm", "bench-runner", "run-livesync-cli-e2e"],
        p2pEnvironment
    );
} finally {
    const cleanupStatus = await runDocker([...composeArgs, "down", "-v", "--remove-orphans"]);
    if (!cleanupStatus.success) {
        console.error(`[CLI E2E] Compose cleanup failed with exit code ${cleanupStatus.code}.`);
        if (testStatus?.success) {
            Deno.exit(cleanupStatus.code);
        }
    }
}

if (!testStatus?.success) {
    const code = testStatus?.code ?? 1;
    console.error(`[CLI E2E] Compose P2P suite failed with exit code ${code}.`);
    Deno.exit(code);
}

console.log("\n[CLI E2E] Compose P2P suite passed.");
