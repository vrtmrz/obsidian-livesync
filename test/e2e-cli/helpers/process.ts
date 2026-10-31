import { spawn } from "node:child_process";
import { constants } from "node:os";
import { Readable, Writable } from "node:stream";

export type ProcessStatus = { code: number; success: boolean; signal: NodeJS.Signals | null };
export type ProcessOutput = ProcessStatus & { stdout: Uint8Array; stderr: Uint8Array };
export type ProcessOptions = {
    args?: string[];
    cwd?: string | URL;
    env?: NodeJS.ProcessEnv;
    stdin?: "null" | "piped" | "inherit";
    stdout?: "piped" | "inherit";
    stderr?: "piped" | "inherit";
};
export type RunningProcess = {
    readonly pid: number;
    readonly stdin: WritableStream<Uint8Array>;
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    readonly status: Promise<ProcessStatus>;
    kill(signal?: NodeJS.Signals): void;
};

export function spawnProcess(command: string, options: ProcessOptions = {}): RunningProcess {
    const child = spawn(command, options.args ?? [], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: [
            options.stdin === "inherit" ? "inherit" : options.stdin === "piped" ? "pipe" : "ignore",
            options.stdout === "inherit" ? "inherit" : "pipe",
            options.stderr === "inherit" ? "inherit" : "pipe",
        ],
        windowsHide: true,
    });
    const status = new Promise<ProcessStatus>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) =>
            resolve({
                code: code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1),
                success: code === 0 && signal === null,
                signal,
            })
        );
    });
    return {
        pid: child.pid ?? 0,
        get stdin() {
            if (!child.stdin) throw new Error("The child process stdin is not piped");
            return Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
        },
        get stdout() {
            if (!child.stdout) throw new Error("The child process stdout is not piped");
            return Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
        },
        get stderr() {
            if (!child.stderr) throw new Error("The child process stderr is not piped");
            return Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>;
        },
        status,
        kill(signal = "SIGTERM") {
            child.kill(signal);
        },
    };
}

export async function runProcess(command: string, options: ProcessOptions = {}): Promise<ProcessOutput> {
    const child = spawnProcess(command, options);
    const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> =>
        new Uint8Array(await new Response(stream).arrayBuffer());
    const [status, stdout, stderr] = await Promise.all([
        child.status,
        options.stdout === "inherit" ? new Uint8Array() : collect(child.stdout),
        options.stderr === "inherit" ? new Uint8Array() : collect(child.stderr),
    ]);
    return { ...status, stdout, stderr };
}
