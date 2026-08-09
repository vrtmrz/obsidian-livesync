import { assertEquals } from "@std/assert";
import { extname, relative, resolve } from "@std/path";
import type { Page } from "playwright";

function contentType(path: string): string {
    switch (extname(path)) {
        case ".css":
            return "text/css; charset=utf-8";
        case ".html":
            return "text/html; charset=utf-8";
        case ".js":
            return "text/javascript; charset=utf-8";
        case ".json":
        case ".map":
            return "application/json; charset=utf-8";
        case ".svg":
            return "image/svg+xml";
        default:
            return "application/octet-stream";
    }
}

function resolveStaticPath(root: string, pathname: string): string | undefined {
    const requested = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
    const candidate = resolve(root, requested);
    const relativePath = relative(root, candidate);
    if (relativePath.startsWith("..") || relativePath.includes("\0")) {
        return undefined;
    }
    return candidate;
}

export async function startStaticServer(root: string): Promise<{
    readonly baseUrl: string;
    close(): Promise<void>;
}> {
    let reportListening!: (port: number) => void;
    const listening = new Promise<number>((resolvePromise) => {
        reportListening = resolvePromise;
    });
    const server = Deno.serve(
        {
            hostname: "127.0.0.1",
            onListen: ({ port }) => reportListening(port),
            port: 0,
        },
        async (request) => {
            const path = resolveStaticPath(root, new URL(request.url).pathname);
            if (path === undefined) {
                return new Response("Not found", { status: 404 });
            }
            try {
                const stat = await Deno.stat(path);
                const filePath = stat.isDirectory ? resolve(path, "index.html") : path;
                const file = await Deno.open(filePath, { read: true });
                return new Response(file.readable, {
                    headers: {
                        "content-type": contentType(filePath),
                    },
                });
            } catch (error) {
                if (error instanceof Deno.errors.NotFound) {
                    return new Response("Not found", { status: 404 });
                }
                throw error;
            }
        }
    );
    const port = await listening;
    return {
        baseUrl: `http://127.0.0.1:${port}/`,
        close: async () => {
            await server.shutdown();
        },
    };
}

export function observePageFailures(page: Page): () => void {
    const failures: string[] = [];
    page.on("pageerror", (error) => {
        failures.push(`pageerror: ${error.stack ?? error.message}`);
    });
    page.on("console", (message) => {
        if (message.type() === "error") {
            failures.push(`console.error: ${message.text()}`);
        }
    });
    return () => assertEquals(failures, [], failures.join("\n"));
}

export async function waitFor(
    predicate: () => Promise<boolean>,
    message: string,
    timeoutMilliseconds = 5_000
): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error(message);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
}
