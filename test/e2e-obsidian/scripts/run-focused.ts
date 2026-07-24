import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep the public wrapper deliberately narrower than package.json. Discovery,
// installation, runner contracts, and the complete suite have different setup
// requirements and remain separate entry points.
const focusedScenarios = new Set([
    "smoke",
    "onboarding-invitation",
    "dialog-mounts",
    "revision-repair",
    "settings-ui",
    "review-harness",
    "p2p-pane",
    "vault-reflection",
    "couchdb-upload",
    "couchdb-manual-setup-workflow",
    "cli-to-obsidian-sync",
    "minio-upload",
    "object-storage-setup-uri-workflow",
    "p2p-setup-uri-workflow",
    "startup-scan",
    "setup-uri-workflow",
    "two-vault-sync",
    "hidden-file-snippet-sync",
    "customisation-sync",
    "setting-markdown-export",
    "upgrade-from-stable",
]);

function usage(): string {
    return `Usage: npm run test:e2e:obsidian:focused -- <scenario> [scenario arguments]

Builds the current Self-hosted LiveSync plug-in before running one maintained
real-Obsidian scenario. Supported scenarios:

${[...focusedScenarios].map((scenario) => `  ${scenario}`).join("\n")}

This wrapper does not start CouchDB, Object Storage, or the P2P signalling
relay. Use the documented service commands or the complete
local-suite:services wrapper when required.`;
}

// npm receives each argument directly. In particular, environment values and
// scenario arguments never pass through a shell for re-interpretation.
function runNpm(args: string[]): void {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, args, {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
    }
}

function main(): void {
    const [scenario, ...scenarioArguments] = process.argv.slice(2);
    if (!scenario || scenario === "-h" || scenario === "--help") {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (!focusedScenarios.has(scenario)) {
        throw new Error(`Unsupported focused real-Obsidian scenario: ${scenario}\n\n${usage()}`);
    }

    // Individual scenario scripts intentionally remain fast, raw entry points.
    // The wrapper owns the freshness guarantee which was previously easy to
    // miss after changing TypeScript source.
    runNpm(["run", "build"]);

    // The compatibility scenario defaults to the repository CLI. Build it only
    // when the caller has not selected an external CLI distribution.
    if (scenario === "cli-to-obsidian-sync" && !process.env.LIVESYNC_CLI_COMMAND) {
        runNpm(["run", "build", "--workspace", "self-hosted-livesync-cli"]);
    }

    const script = `test:e2e:obsidian:${scenario}`;
    runNpm(["run", script, ...(scenarioArguments.length > 0 ? ["--", ...scenarioArguments] : [])]);
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
