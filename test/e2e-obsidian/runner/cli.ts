import { spawn } from "node:child_process";

export type ObsidianCliResult = {
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
};

function parseEvalJson(stdout: string): unknown {
    const marker = "=> ";
    const markerIndex = stdout.indexOf(marker);
    const text = markerIndex >= 0 ? stdout.slice(markerIndex + marker.length) : stdout;
    return JSON.parse(text.trim());
}

export async function runObsidianCli(
    cliBinary: string,
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ?? 10000)
): Promise<ObsidianCliResult> {
    return await new Promise((resolve, reject) => {
        const child = spawn(cliBinary, args, {
            stdio: ["ignore", "pipe", "pipe"],
            env,
        });
        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Obsidian CLI timed out: ${cliBinary} ${args.join(" ")}`));
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on("exit", (code, signal) => {
            clearTimeout(timeout);
            resolve({ code, signal, stdout, stderr });
        });
    });
}

export async function openVaultWithObsidianCli(
    cliBinary: string,
    vaultPath: string,
    env: NodeJS.ProcessEnv = process.env
): Promise<void> {
    const result = await runObsidianCli(cliBinary, [`obsidian://open?path=${encodeURIComponent(vaultPath)}`], env);
    if (result.code !== 0) {
        throw new Error(
            [
                `Failed to open Obsidian vault through CLI. code=${result.code}, signal=${result.signal}`,
                result.stdout ? `stdout:\n${result.stdout}` : undefined,
                result.stderr ? `stderr:\n${result.stderr}` : undefined,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
}

export async function evalObsidianJson<T>(
    cliBinary: string,
    code: string,
    env: NodeJS.ProcessEnv = process.env,
    timeoutMs?: number
): Promise<T> {
    const result = await runObsidianCli(cliBinary, ["eval", `code=${code}`], env, timeoutMs);
    if (result.code !== 0) {
        throw new Error(
            [
                `Failed to evaluate Obsidian JavaScript through CLI. code=${result.code}, signal=${result.signal}`,
                result.stdout ? `stdout:\n${result.stdout}` : undefined,
                result.stderr ? `stderr:\n${result.stderr}` : undefined,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
    try {
        return parseEvalJson(result.stdout) as T;
    } catch (error) {
        throw new Error(
            [
                `Failed to parse Obsidian CLI eval JSON. code=${result.code}, signal=${result.signal}`,
                error instanceof Error ? `parse error: ${error.message}` : undefined,
                result.stdout ? `stdout:\n${result.stdout}` : undefined,
                result.stderr ? `stderr:\n${result.stderr}` : undefined,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
}
