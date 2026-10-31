import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProcess } from "./helpers/process.ts";
import { CLI_DIR, REPOSITORY_ROOT } from "./helpers/paths.ts";

const require = createRequire(import.meta.url);
const reportDirectory = join(REPOSITORY_ROOT, "coverage", "cli-e2e");
const task = process.argv[2] ?? "test:local";

async function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
    const result = await spawnProcess(process.execPath, {
        args,
        cwd,
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    }).status;
    if (!result.success) throw new Error(`Coverage command failed with exit code ${result.code}`);
}

if (task === "test:p2p:compose" || task === "test:e2e:all") {
    throw new Error("CLI coverage collects host processes; select a host-direct task such as test:local or test:ci");
}
const viteCli = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
await run([viteCli, "build"], CLI_DIR, { LIVESYNC_CLI_COVERAGE: "1" });
const c8Cli = require.resolve("c8/bin/c8.js");
await run(
    [
        c8Cli,
        "--all",
        "--src=src/apps/cli",
        // Match native paths and Node's file URL source-map cache.
        "--include=**/src/**/*.ts",
        "--exclude-after-remap",
        "--exclude=**/test-support/**",
        "--exclude=**/test/**",
        "--exclude=**/*.unit.spec.ts",
        "--exclude=**/*.test.ts",
        "--reporter=text",
        "--reporter=json",
        "--reporter=html",
        `--reports-dir=${reportDirectory}`,
        `--temp-directory=${join(reportDirectory, "raw")}`,
        process.execPath,
        fileURLToPath(new URL("./run-task.ts", import.meta.url)),
        task,
        ...process.argv.slice(3),
    ],
    REPOSITORY_ROOT
);
await run(
    ["--test", "--test-concurrency=1", fileURLToPath(new URL("./coverage-report.test.ts", import.meta.url))],
    REPOSITORY_ROOT,
    {
        LIVESYNC_CLI_COVERAGE_REPORT: join(reportDirectory, "coverage-final.json"),
        LIVESYNC_CLI_COVERAGE_TASK: task,
    }
);
console.log(`CLI E2E coverage: ${reportDirectory}`);
