import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";

type CommandResult = { code: number; signal: NodeJS.Signals | null };

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
    return new Promise((resolveResult, reject) => {
        const child = spawn(command, [...args], { cwd: process.cwd(), env, stdio: "inherit" });
        child.once("error", reject);
        child.once("close", (code, signal) => resolveResult({ code: code ?? 1, signal }));
    });
}

function pathInside(root: string, candidate: string): string {
    const localPath = relative(root, candidate);
    if (localPath === ".." || localPath.startsWith(".." + sep) || isAbsolute(localPath)) {
        throw new Error(
            "The discovered Obsidian executable paths must share one extracted application directory. " +
                "Set E2E_P2P_NFC_OBSIDIAN_DIR to their common root."
        );
    }
    return localPath.split(sep).join("/");
}

async function main(): Promise<void> {
    const repoRoot = resolve(process.cwd());
    const binary = await realpath(requireObsidianBinary());
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error("Could not find obsidian-cli. Checked paths: " + cli.checked.join(", "));
    }
    const cliBinary = await realpath(cli.binary);
    const appDirectory = await realpath(resolve(process.env.E2E_P2P_NFC_OBSIDIAN_DIR?.trim() || dirname(binary)));
    if (!(await stat(appDirectory)).isDirectory()) {
        throw new Error("The selected Obsidian application root is not a directory: " + appDirectory);
    }
    const containerBinary = "/opt/obsidian/" + pathInside(appDirectory, binary);
    const containerCli = "/opt/obsidian/" + pathInside(appDirectory, cliBinary);

    const build = await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
    if (build.code !== 0) {
        throw new Error("The host plug-in build failed with exit code " + build.code + ".");
    }

    const artifactsDirectory = await mkdtemp(join(tmpdir(), "livesync-e2e-p2p-nfc-"));
    const projectName = "livesync-p2p-nfc-" + process.pid + "-" + Date.now() + "-" + randomBytes(4).toString("hex");
    const composeFile = join(repoRoot, "test/e2e-obsidian/compose.p2p.yml");
    const composeArgs = ["compose", "--project-name", projectName, "--file", composeFile];
    const composeEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        E2E_P2P_NFC_OBSIDIAN_DIR: appDirectory,
        E2E_P2P_NFC_OBSIDIAN_BINARY: containerBinary,
        E2E_P2P_NFC_OBSIDIAN_CLI: containerCli,
        E2E_P2P_NFC_ARTIFACT_DIR: artifactsDirectory,
    };
    let exitCode = 0;
    let failure: unknown;

    try {
        const result = await run(
            "docker",
            [...composeArgs, "run", "--rm", "--build", "p2p-nfc", ...process.argv.slice(2)],
            composeEnvironment
        );
        exitCode = result.code;
        if (result.signal) exitCode = 1;
    } catch (error) {
        failure = error;
        exitCode = 1;
    } finally {
        try {
            const teardown = await run(
                "docker",
                [...composeArgs, "down", "--volumes", "--remove-orphans"],
                composeEnvironment
            );
            if (teardown.code !== 0 && exitCode === 0) exitCode = teardown.code;
        } catch (error) {
            if (exitCode === 0) {
                failure = error;
                exitCode = 1;
            }
        }
        if (exitCode === 0 && process.env.E2E_P2P_NFC_KEEP_ARTIFACTS !== "1") {
            await rm(artifactsDirectory, { recursive: true, force: true });
        } else {
            console.log("P2P NFC diagnostics were retained at " + artifactsDirectory);
        }
    }

    if (failure) throw failure;
    if (exitCode !== 0) process.exitCode = exitCode;
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
