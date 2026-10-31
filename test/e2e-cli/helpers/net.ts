import { createConnection, createServer } from "node:net";

type WaitForPortOptions = { timeoutMs?: number; intervalMs?: number; connectTimeoutMs?: number };

async function connectWithTimeout(hostname: string, port: number, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: hostname, port });
        socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`connect timeout after ${timeoutMs}ms`)));
        socket.once("error", reject);
        socket.once("connect", () => {
            socket.destroy();
            resolve();
        });
    });
}

export async function waitForPort(hostname: string, port: number, options: WaitForPortOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const intervalMs = options.intervalMs ?? 250;
    const started = Date.now();
    let lastError: unknown;
    while (Date.now() - started < timeoutMs) {
        try {
            await connectWithTimeout(hostname, port, options.connectTimeoutMs ?? 1000);
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }
    throw new Error(
        `Port ${hostname}:${port} did not become ready within ${timeoutMs}ms` +
            (lastError ? ` (last error: ${String(lastError)})` : "")
    );
}

export async function getFreePort(hostname = "127.0.0.1"): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, hostname, resolve);
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (!address || typeof address === "string") throw new Error("The listener did not bind a TCP port");
    return address.port;
}

export async function getOptimalLoopbackIp(): Promise<string> {
    for (const hostname of ["127.0.0.1", "::1"]) {
        try {
            await getFreePort(hostname);
            return hostname;
        } catch {
            /* Try the other loopback family. */
        }
    }
    return "127.0.0.1";
}
