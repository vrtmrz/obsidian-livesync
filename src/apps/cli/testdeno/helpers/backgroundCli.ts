import { CLI_DIR } from "./cli.ts";
import { join } from "@std/path";

const CLI_DIST = join(CLI_DIR, "dist", "index.cjs");
const VERBOSE_ENABLED = Deno.env.get("LIVESYNC_CLI_VERBOSE") === "1";
const DEBUG_ENABLED = Deno.env.get("LIVESYNC_CLI_DEBUG") === "1";

function decorateArgs(args: string[]): string[] {
    return DEBUG_ENABLED ? ["-d", ...args] : VERBOSE_ENABLED ? ["-v", ...args] : args;
}

async function pump(
    stream: ReadableStream<Uint8Array>,
    sink: (text: string) => void,
    teeTarget: WritableStream<Uint8Array> | null
): Promise<void> {
    const reader = stream.getReader();
    const writer = teeTarget?.getWriter();
    const dec = new TextDecoder();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            sink(dec.decode(value, { stream: true }));
            if (writer) {
                await writer.write(value);
            }
        }
    } finally {
        if (writer) writer.releaseLock();
        reader.releaseLock();
    }
}

export class BackgroundCliProcess {
    #stdout = "";
    #stderr = "";
    #stdoutDone: Promise<void>;
    #stderrDone: Promise<void>;

    constructor(
        readonly child: Deno.ChildProcess,
        readonly args: string[]
    ) {
        this.#stdoutDone = pump(
            child.stdout,
            (text) => {
                this.#stdout += text;
            },
            null
        );
        this.#stderrDone = pump(
            child.stderr,
            (text) => {
                this.#stderr += text;
            },
            null
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
    const child = new Deno.Command("node", {
        args: [CLI_DIST, ...decorateArgs(args)],
        cwd: CLI_DIR,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    return new BackgroundCliProcess(child, args);
}
