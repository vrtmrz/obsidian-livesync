import { join } from "@std/path";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
// This file lives at: src/apps/cli/testdeno/helpers/cli.ts
// CLI root (src/apps/cli/) is two levels up.
// import.meta.dirname is available in Deno 1.40+ as an OS-native path string.
export const CLI_DIR: string = join(import.meta.dirname!, "..", "..");
const CLI_DIST = join(CLI_DIR, "dist", "index.cjs");

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------
export interface CliResult {
    stdout: string;
    stderr: string;
    /** stdout + stderr concatenated — useful for assertion messages. */
    combined: string;
    code: number;
}

export const TEE_ENABLED = Deno.env.get("LIVESYNC_TEST_TEE") === "1";
const VERBOSE_ENABLED = Deno.env.get("LIVESYNC_CLI_VERBOSE") === "1";
const DEBUG_ENABLED = Deno.env.get("LIVESYNC_CLI_DEBUG") === "1";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

export function formatTeeCommand(args: string[]): string {
    return ["node", CLI_DIST, ...args].map((part) => JSON.stringify(part)).join(" ");
}

export function createLineTeeWriter(
    pid: number,
    streamName: "stdout" | "stderr",
    writer: (chunk: Uint8Array) => void
): { write: (chunk: Uint8Array) => void; close: () => void } {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let pending = "";
    let headerWritten = false;
    const emitLine = (line: string) => {
        if (!headerWritten) {
            writer(enc.encode(`[CLI tee pid=${pid}:${streamName}]\n`));
            headerWritten = true;
        }
        writer(enc.encode(`[CLI tee pid=${pid}:${streamName}] ${line}\n`));
    };

    const flush = (final = false) => {
        let index = pending.indexOf("\n");
        while (index >= 0) {
            const line = pending.slice(0, index).replace(/\r$/, "");
            pending = pending.slice(index + 1);
            emitLine(line);
            index = pending.indexOf("\n");
        }
        if (final && pending.length > 0) {
            emitLine(pending.replace(/\r$/, ""));
            pending = "";
        }
    };

    return {
        write(chunk: Uint8Array) {
            pending += dec.decode(chunk, { stream: true });
            flush(false);
        },
        close() {
            pending += dec.decode();
            flush(true);
        },
    };
}

async function collectStream(
    stream: ReadableStream<Uint8Array>,
    teeTarget: { write: (chunk: Uint8Array) => void; close: () => void } | null
): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                if (teeTarget) {
                    teeTarget.write(value);
                }
            }
        }
    } finally {
        if (teeTarget) {
            teeTarget.close();
        }
        reader.releaseLock();
    }
    return concatChunks(chunks);
}

async function runNodeCommand(args: string[], stdinData?: Uint8Array): Promise<CliResult> {
    const cliArgs = DEBUG_ENABLED ? ["-d", ...args] : VERBOSE_ENABLED ? ["-v", ...args] : args;
    const child = new Deno.Command("node", {
        args: [CLI_DIST, ...cliArgs],
        cwd: CLI_DIR,
        stdin: stdinData ? "piped" : "null",
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    if (TEE_ENABLED) {
        Deno.stdout.writeSync(
            new TextEncoder().encode(`[CLI tee pid=${child.pid}] process: ${formatTeeCommand(cliArgs)}\n`)
        );
    }

    const stdoutPromise = collectStream(
        child.stdout,
        TEE_ENABLED ? createLineTeeWriter(child.pid, "stdout", (chunk) => Deno.stdout.writeSync(chunk)) : null
    );
    const stderrPromise = collectStream(
        child.stderr,
        TEE_ENABLED ? createLineTeeWriter(child.pid, "stderr", (chunk) => Deno.stderr.writeSync(chunk)) : null
    );

    if (stdinData) {
        const w = child.stdin.getWriter();
        await w.write(stdinData);
        await w.close();
    }

    const [status, stdout, stderr] = await Promise.all([child.status, stdoutPromise, stderrPromise]);

    const dec = new TextDecoder();
    const out = dec.decode(stdout);
    const err = dec.decode(stderr);
    return { stdout: out, stderr: err, combined: out + err, code: status.code };
}

function isTransientNetworkError(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes("fetch failed") ||
        m.includes("econnreset") ||
        m.includes("econnrefused") ||
        m.includes("und_err_socket") ||
        m.includes("other side closed")
    );
}

// ---------------------------------------------------------------------------
// Core runners
// ---------------------------------------------------------------------------

/**
 * Run the CLI (node dist/index.cjs) with the supplied arguments.
 * Pass the vault / DB path as the first argument, exactly as the bash helpers
 * do.  Does NOT throw on non-zero exit — check `.code` yourself.
 */
export async function runCli(...args: string[]): Promise<CliResult> {
    const retries = Number(Deno.env.get("LIVESYNC_CLI_RETRY") ?? "0");
    for (let attempt = 0; ; attempt++) {
        const result = await runNodeCommand(args);
        if (result.code === 0) return result;

        if (attempt >= retries || !isTransientNetworkError(result.combined)) {
            return result;
        }
        const waitMs = 400 * (attempt + 1);
        console.warn(`[WARN] transient CLI failure, retrying (${attempt + 1}/${retries}) in ${waitMs}ms`);
        await sleep(waitMs);
    }
}

/**
 * Run the CLI and throw if it exits non-zero.  Returns stdout.
 */
export async function runCliOrFail(...args: string[]): Promise<string> {
    const r = await runCli(...args);
    if (r.code !== 0) {
        throw new Error(`CLI exited with code ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    }
    return r.stdout;
}

/**
 * Run the CLI with data piped to stdin (equivalent to `echo … | run_cli …`
 * or `cat file | run_cli …`).
 */
export async function runCliWithInput(input: string | Uint8Array, ...args: string[]): Promise<CliResult> {
    const data = typeof input === "string" ? new TextEncoder().encode(input) : input;

    const retries = Number(Deno.env.get("LIVESYNC_CLI_RETRY") ?? "0");
    for (let attempt = 0; ; attempt++) {
        const result = await runNodeCommand(args, data);
        if (result.code === 0) return result;

        if (attempt >= retries || !isTransientNetworkError(result.combined)) {
            return result;
        }
        const waitMs = 400 * (attempt + 1);
        console.warn(`[WARN] transient CLI(stdin) failure, retrying (${attempt + 1}/${retries}) in ${waitMs}ms`);
        await sleep(waitMs);
    }
}

/**
 * runCliWithInput — throws on non-zero exit, returns stdout.
 */
export async function runCliWithInputOrFail(input: string | Uint8Array, ...args: string[]): Promise<string> {
    const r = await runCliWithInput(input, ...args);
    if (r.code !== 0) {
        throw new Error(`CLI (with stdin) exited with code ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    }
    return r.stdout;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/** Strip the CLIWatchAdapter banner line that `cat` emits. */
export function sanitiseCatStdout(raw: string): string {
    return raw
        .split("\n")
        .filter((l) => l !== "[CLIWatchAdapter] File watching is not enabled in CLI version")
        .join("\n");
}

// ---------------------------------------------------------------------------
// Assertions (parity with test-helpers.sh)
// ---------------------------------------------------------------------------

export function assertContains(haystack: string, needle: string, message: string): void {
    if (!haystack.includes(needle)) {
        throw new Error(`[FAIL] ${message}\nExpected to find: ${JSON.stringify(needle)}\nActual output:\n${haystack}`);
    }
}

export function assertNotContains(haystack: string, needle: string, message: string): void {
    if (haystack.includes(needle)) {
        throw new Error(`[FAIL] ${message}\nDid NOT expect: ${JSON.stringify(needle)}\nActual output:\n${haystack}`);
    }
}

export async function assertFilesEqual(expectedPath: string, actualPath: string, message: string): Promise<void> {
    const [expected, actual] = await Promise.all([Deno.readFile(expectedPath), Deno.readFile(actualPath)]);
    if (expected.length !== actual.length || expected.some((b, i) => b !== actual[i])) {
        const hex = async (d: Uint8Array<ArrayBuffer>) => {
            const h = await crypto.subtle.digest("SHA-256", d);
            return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
        };
        throw new Error(
            `[FAIL] ${message}\nexpected SHA-256: ${await hex(expected)}\nactual   SHA-256: ${await hex(actual)}`
        );
    }
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export async function readJsonFile<T = Record<string, unknown>>(filePath: string): Promise<T> {
    return JSON.parse(await Deno.readTextFile(filePath)) as T;
}

export function jsonStringField(jsonText: string, field: string): string {
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const value = data[field];
    return typeof value === "string" ? value : "";
}

export function jsonFieldIsNa(data: Record<string, unknown>, field: string): boolean {
    return data[field] === "N/A";
}
