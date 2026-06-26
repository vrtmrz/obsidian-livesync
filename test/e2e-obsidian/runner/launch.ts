import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { platform } from "node:process";

export type ObsidianProcess = {
    process: ChildProcess;
    stop: () => Promise<void>;
};

export type LaunchObsidianOptions = {
    binary: string;
    vaultPath: string;
    homePath?: string;
    xdgConfigPath?: string;
    userDataPath?: string;
    startupGraceMs?: number;
};

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
        ...(process.env.E2E_OBSIDIAN_USE_USER_DATA_DIR === "true" && options.userDataPath
            ? [`--user-data-dir=${options.userDataPath}`]
            : []),
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

export async function launchObsidian(options: LaunchObsidianOptions): Promise<ObsidianProcess> {
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
        stop: async () => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }
            if (child.pid) {
                process.kill(-child.pid, "SIGTERM");
            } else {
                child.kill("SIGTERM");
            }
            const stopTimer = new Promise<"timeout">((resolve) => {
                setTimeout(() => resolve("timeout"), 5000);
            });
            const stopResult = await Promise.race([exitPromise, stopTimer]);
            if (stopResult === "timeout") {
                if (child.pid) {
                    process.kill(-child.pid, "SIGKILL");
                } else {
                    child.kill("SIGKILL");
                }
                await exitPromise;
            }
        },
    };
}
