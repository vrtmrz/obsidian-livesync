import { resolve } from "@std/path";

const repositoryRoot = resolve(import.meta.dirname!, "../../..");
const cliDirectory = resolve(repositoryRoot, "src/apps/cli");
const cliDist = resolve(cliDirectory, "dist/index.cjs");

export interface CliResult {
    readonly code: number;
    readonly combined: string;
    readonly stderr: string;
    readonly stdout: string;
}

export class TemporaryDirectory implements AsyncDisposable {
    private constructor(readonly path: string) {}

    static async create(prefix: string): Promise<TemporaryDirectory> {
        return new TemporaryDirectory(await Deno.makeTempDir({ prefix: `${prefix}.` }));
    }

    resolve(...parts: string[]): string {
        return resolve(this.path, ...parts);
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await Deno.remove(this.path, { recursive: true }).catch(() => {});
    }
}

async function collectStream(stream: ReadableStream<Uint8Array>, append: (text: string) => void): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                append(decoder.decode());
                return;
            }
            if (value !== undefined) {
                append(decoder.decode(value, { stream: true }));
            }
        }
    } finally {
        reader.releaseLock();
    }
}

export async function runCli(...args: string[]): Promise<CliResult> {
    const output = await new Deno.Command("node", {
        args: [cliDist, ...args],
        cwd: cliDirectory,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    return {
        code: output.code,
        combined: stdout + stderr,
        stderr,
        stdout,
    };
}

export async function initSettingsFile(path: string): Promise<void> {
    const result = await runCli("init-settings", "--force", path);
    if (result.code !== 0) {
        throw new Error(`CLI settings initialisation failed with code ${result.code}\n${result.combined}`);
    }
}

export function sanitiseCatStdout(raw: string): string {
    return raw
        .split("\n")
        .filter((line) => line !== "[CLIWatchAdapter] File watching is not enabled in CLI version")
        .join("\n");
}

export class BackgroundCliProcess {
    #stdout = "";
    #stderr = "";
    readonly #stdoutDone: Promise<void>;
    readonly #stderrDone: Promise<void>;

    constructor(readonly child: Deno.ChildProcess) {
        this.#stdoutDone = collectStream(child.stdout, (text) => {
            this.#stdout += text;
        });
        this.#stderrDone = collectStream(child.stderr, (text) => {
            this.#stderr += text;
        });
    }

    get combined(): string {
        return this.#stdout + this.#stderr;
    }

    async stop(): Promise<number> {
        try {
            this.child.kill("SIGTERM");
        } catch {
            // The process has already exited.
        }
        const status = await this.child.status;
        await Promise.all([this.#stdoutDone, this.#stderrDone]);
        return status.code;
    }
}

export function startCliInBackground(...args: string[]): BackgroundCliProcess {
    return new BackgroundCliProcess(
        new Deno.Command("node", {
            args: [cliDist, ...args],
            cwd: cliDirectory,
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
        }).spawn()
    );
}

type WaitForPortOptions = {
    timeoutMs?: number;
    intervalMs?: number;
    connectTimeoutMs?: number;
};

async function connectWithTimeout(hostname: string, port: number, timeoutMs: number): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const connection = await Promise.race([
            Deno.connect({ hostname, port }),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs} ms`)), timeoutMs);
            }),
        ]);
        connection.close();
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}

export async function waitForPort(
    hostname: string,
    port: number,
    options: WaitForPortOptions = {}
): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const intervalMs = options.intervalMs ?? 250;
    const connectTimeoutMs = options.connectTimeoutMs ?? 1_000;
    const started = Date.now();
    let lastError: unknown;

    while (Date.now() - started < timeoutMs) {
        try {
            await connectWithTimeout(hostname, port, connectTimeoutMs);
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
        }
    }
    throw new Error(
        `Port ${hostname}:${port} did not become ready within ${timeoutMs} ms` +
            (lastError === undefined ? "" : ` (last error: ${String(lastError)})`)
    );
}
