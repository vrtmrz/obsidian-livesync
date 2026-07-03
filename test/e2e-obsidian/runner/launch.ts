import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { platform } from "node:process";
import { promisify } from "node:util";

export type ObsidianProcess = {
    process: ChildProcess;
    output: () => { stdout: string; stderr: string };
    stop: () => Promise<void>;
};

export type LaunchObsidianOptions = {
    binary: string;
    vaultPath: string;
    homePath?: string;
    xdgConfigPath?: string;
    xdgCachePath?: string;
    xdgDataPath?: string;
    userDataPath?: string;
    startupGraceMs?: number;
};

const execFileAsync = promisify(execFile);

function splitArgs(args: string): string[] {
    return args.split(" ").filter((arg) => arg.length > 0);
}

function launchArgs(options: LaunchObsidianOptions): string[] {
    const explicitArgs = process.env.E2E_OBSIDIAN_ARGS;
    if (explicitArgs) {
        return splitArgs(explicitArgs);
    }
    return [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
        ...(process.env.E2E_OBSIDIAN_USE_USER_DATA_DIR !== "false" && options.userDataPath
            ? [`--user-data-dir=${options.userDataPath}`]
            : []),
        ...(process.env.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT
            ? [`--remote-debugging-port=${process.env.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT}`]
            : []),
        `obsidian://open?path=${encodeURIComponent(options.vaultPath)}`,
    ];
}

function shouldUseXvfb(): boolean {
    if (process.env.E2E_OBSIDIAN_USE_XVFB === "false") {
        return false;
    }
    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        return false;
    }
    return platform === "linux" && existsSync("/usr/bin/xvfb-run");
}

async function listChildPids(pid: number): Promise<number[]> {
    if (platform === "win32") {
        return [];
    }
    const { stdout } = await execFileAsync("ps", ["-o", "pid=", "--ppid", String(pid)]).catch(() => ({
        stdout: "",
    }));
    const directChildren = stdout
        .split("\n")
        .map((line) => Number(line.trim()))
        .filter((childPid) => Number.isInteger(childPid) && childPid > 0);
    const descendants = await Promise.all(directChildren.map((childPid) => listChildPids(childPid)));
    return [...directChildren, ...descendants.flat()];
}

async function killPids(pids: number[], signal: NodeJS.Signals): Promise<void> {
    for (const pid of pids) {
        if (pid === process.pid) {
            continue;
        }
        try {
            process.kill(pid, signal);
        } catch {
            // The process may have exited between discovery and signalling.
        }
    }
}

async function waitForExit(exitPromise: Promise<unknown>, timeoutMs: number): Promise<"exited" | "timeout"> {
    const stopTimer = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const stopResult = await Promise.race([exitPromise.then(() => "exited" as const), stopTimer]);
    return stopResult;
}

export async function cleanupStaleObsidianE2EProcesses(): Promise<void> {
    if (process.env.E2E_OBSIDIAN_CLEANUP_STALE_PROCESSES === "false" || platform === "win32") {
        return;
    }
    const { stdout } = await execFileAsync("pgrep", ["-f", "obsidian-livesync-e2e-state"]).catch(() => ({
        stdout: "",
    }));
    const pids = stdout
        .split("\n")
        .map((line) => Number(line.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    if (pids.length === 0) {
        return;
    }
    await killPids(pids, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await killPids(pids, "SIGKILL");
}

export async function launchObsidian(options: LaunchObsidianOptions): Promise<ObsidianProcess> {
    await cleanupStaleObsidianE2EProcesses();
    const startupGraceMs = options.startupGraceMs ?? 1000;
    const args = launchArgs(options);
    const useXvfb = shouldUseXvfb();
    const command = useXvfb ? "/usr/bin/xvfb-run" : options.binary;
    const commandArgs = useXvfb ? ["-a", options.binary, ...args] : args;
    const child = spawn(command, commandArgs, {
        cwd: dirname(options.binary),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            ...(options.homePath ? { HOME: options.homePath } : {}),
            ...(options.xdgConfigPath ? { XDG_CONFIG_HOME: options.xdgConfigPath } : {}),
            ...(options.xdgCachePath ? { XDG_CACHE_HOME: options.xdgCachePath } : {}),
            ...(options.xdgDataPath ? { XDG_DATA_HOME: options.xdgDataPath } : {}),
            OBSIDIAN_DISABLE_GPU: process.env.OBSIDIAN_DISABLE_GPU ?? "1",
        },
    });

    let stderr = "";
    let stdout = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
    });

    const exitPromise = once(child, "exit").then(([code, signal]) => ({ code, signal }));
    const timer = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), startupGraceMs);
    });
    const firstResult = await Promise.race([exitPromise, timer]);
    if (firstResult !== "timeout") {
        throw new Error(
            [
                `Obsidian exited before the smoke timeout. code=${firstResult.code}, signal=${firstResult.signal}`,
                stdout ? `stdout:\n${stdout}` : undefined,
                stderr ? `stderr:\n${stderr}` : undefined,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }

    return {
        process: child,
        output: () => ({ stdout, stderr }),
        stop: async () => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }
            const descendantPids = child.pid ? await listChildPids(child.pid) : [];
            if (child.pid) {
                try {
                    process.kill(-child.pid, "SIGTERM");
                } catch {
                    child.kill("SIGTERM");
                }
            } else {
                child.kill("SIGTERM");
            }
            await killPids(descendantPids.reverse(), "SIGTERM");
            const stopResult = await waitForExit(exitPromise, 5000);
            if (stopResult === "timeout") {
                if (child.pid) {
                    try {
                        process.kill(-child.pid, "SIGKILL");
                    } catch {
                        child.kill("SIGKILL");
                    }
                } else {
                    child.kill("SIGKILL");
                }
                await killPids(descendantPids, "SIGKILL");
                await exitPromise;
            }
        },
    };
}
