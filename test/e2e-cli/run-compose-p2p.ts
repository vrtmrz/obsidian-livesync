import { spawnProcess, type ProcessStatus } from "./helpers/process.ts";
import { REPOSITORY_ROOT } from "./helpers/paths.ts";
import { realpath } from "node:fs/promises";
const repositoryRoot = await realpath(REPOSITORY_ROOT);
const composeArgs = ["compose", "-f", "test/bench-network/compose.yml"];
const p2pEnvironment = {
    CLI_E2E_TASK: process.env.CLI_E2E_TASK ?? "test:p2p:ci",
    RELAY: process.env.RELAY ?? "ws://nostr-relay:7777/",
    PEERS_TIMEOUT: process.env.PEERS_TIMEOUT ?? "20",
    SYNC_TIMEOUT: process.env.SYNC_TIMEOUT ?? "60",
    LIVESYNC_USE_COTURN: process.env.LIVESYNC_USE_COTURN ?? "0",
    TURN_SERVERS: process.env.TURN_SERVERS ?? "none",
    LIVESYNC_P2P_PEERS_RETRY: process.env.LIVESYNC_P2P_PEERS_RETRY ?? "1",
    LIVESYNC_P2P_RELAY_READY_TIMEOUT_MS: process.env.LIVESYNC_P2P_RELAY_READY_TIMEOUT_MS ?? "60000",
    BENCH_LIVESYNC_TEST_TEE: process.env.BENCH_LIVESYNC_TEST_TEE ?? "0",
    LIVESYNC_CLI_DEBUG: process.env.LIVESYNC_CLI_DEBUG ?? "0",
    LIVESYNC_CLI_VERBOSE: process.env.LIVESYNC_CLI_VERBOSE ?? "0",
};

async function runDocker(args: string[], env?: Record<string, string>): Promise<ProcessStatus> {
    return await spawnProcess("docker", {
        args,
        cwd: repositoryRoot,
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    }).status;
}

let testStatus: ProcessStatus | undefined;
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
            process.exit(cleanupStatus.code);
        }
    }
}

if (!testStatus?.success) {
    const code = testStatus?.code ?? 1;
    console.error(`[CLI E2E] Compose P2P suite failed with exit code ${code}.`);
    process.exit(code);
}

console.log("\n[CLI E2E] Compose P2P suite passed.");
