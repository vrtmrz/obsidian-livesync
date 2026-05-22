type WaitForPortOptions = {
    timeoutMs?: number;
    intervalMs?: number;
    connectTimeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithTimeout(hostname: string, port: number, timeoutMs: number): Promise<void> {
    let timer: number | undefined;
    try {
        const connPromise = Deno.connect({ hostname, port });
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`connect timeout after ${timeoutMs}ms`)), timeoutMs);
        });
        const conn = await Promise.race([connPromise, timeoutPromise]);
        conn.close();
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

export async function waitForPort(hostname: string, port: number, options: WaitForPortOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const intervalMs = options.intervalMs ?? 250;
    const connectTimeoutMs = options.connectTimeoutMs ?? 1000;

    const started = Date.now();
    let lastError: unknown;

    while (Date.now() - started < timeoutMs) {
        try {
            await connectWithTimeout(hostname, port, connectTimeoutMs);
            return;
        } catch (error) {
            lastError = error;
            await sleep(intervalMs);
        }
    }

    throw new Error(
        `Port ${hostname}:${port} did not become ready within ${timeoutMs}ms` +
            (lastError ? ` (last error: ${String(lastError)})` : "")
    );
}
