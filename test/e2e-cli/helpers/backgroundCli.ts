import { writeSync } from "node:fs";
import { spawnProcess, type RunningProcess } from "./process.ts";
import { CLI_DIR, TEE_ENABLED, formatTeeCommand, createLineTeeWriter } from "./cli.ts";
import { join } from "node:path";

const CLI_DIST = join(CLI_DIR, "dist", "index.cjs");
const VERBOSE_ENABLED = process.env.LIVESYNC_CLI_VERBOSE === "1";
const DEBUG_ENABLED = process.env.LIVESYNC_CLI_DEBUG === "1";

function decorateArgs(args: string[]): string[] {
    return DEBUG_ENABLED ? ["-d", ...args] : VERBOSE_ENABLED ? ["-v", ...args] : args;
}

async function pump(
    stream: ReadableStream<Uint8Array>,
    sink: (text: string) => void,
    teeTarget: { write: (chunk: Uint8Array) => void; close: () => void } | null
): Promise<void> {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            sink(dec.decode(value, { stream: true }));
            if (teeTarget) {
                teeTarget.write(value);
            }
        }
    } finally {
        if (teeTarget) teeTarget.close();
        reader.releaseLock();
    }
}

export class BackgroundCliProcess {
    #stdout = "";
    #stderr = "";
    #stdoutDone: Promise<void>;
    #stderrDone: Promise<void>;

    readonly child: RunningProcess;
    readonly args: string[];

    constructor(child: RunningProcess, args: string[]) {
        this.child = child;
        this.args = args;
        const cliArgs = decorateArgs(args);
        this.#stdoutDone = pump(
            child.stdout,
            (text) => {
                this.#stdout += text;
            },
            TEE_ENABLED ? createLineTeeWriter(child.pid, "stdout", (chunk) => writeSync(1, chunk)) : null
        );
        this.#stderrDone = pump(
            child.stderr,
            (text) => {
                this.#stderr += text;
            },
            TEE_ENABLED ? createLineTeeWriter(child.pid, "stderr", (chunk) => writeSync(2, chunk)) : null
        );
    }

    get stdout(): string {
        return this.#stdout;
    }

    get stderr(): string {
        return this.#stderr;
    }

    get combined(): string {
        return this.#stdout + this.#stderr;
    }

    async waitUntilContains(needle: string, timeoutMs = 15000): Promise<void> {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (this.combined.includes(needle)) return;
            const status = await Promise.race([
                this.child.status.then((s) => ({ type: "status" as const, status: s })),
                new Promise<{ type: "tick" }>((resolve) => setTimeout(() => resolve({ type: "tick" }), 100)),
            ]);
            if (status.type === "status") {
                throw new Error(
                    `Background CLI exited before '${needle}' appeared (code ${status.status.code})\n${this.combined}`
                );
            }
        }
        throw new Error(`Timed out waiting for '${needle}'\n${this.combined}`);
    }

    async stop(): Promise<number> {
        try {
            this.child.kill("SIGTERM");
        } catch {
            // ignore already-exited processes
        }
        const status = await this.child.status;
        await Promise.all([this.#stdoutDone, this.#stderrDone]);
        return status.code;
    }
}

export function startCliInBackground(...args: string[]): BackgroundCliProcess {
    const cliArgs = decorateArgs(args);
    const child = spawnProcess(process.execPath, {
        args: [CLI_DIST, ...cliArgs],
        cwd: CLI_DIR,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
    });

    if (TEE_ENABLED) {
        writeSync(
            1,
            new TextEncoder().encode(`[CLI tee pid=${child.pid}] process(bg): ${formatTeeCommand(cliArgs)}\n`)
        );
    }

    return new BackgroundCliProcess(child, args);
}
