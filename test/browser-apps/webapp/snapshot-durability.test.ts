import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Use the esbuild installation pinned by the npm workspace from the Deno test runner.
const { build }: typeof import("esbuild") = createRequire(import.meta.url)("esbuild");
const origin = "https://webapp-snapshot.test";

test("WebApp IndexedDB snapshot survives same-origin reload and a native transaction abort", async () => {
    const { outputFiles } = await build({
        stdin: {
            resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
            contents: `
                import { FSAPIStorageEventManagerAdapter } from "./src/apps/webapp/managers/FSAPIStorageEventManagerAdapter.ts";
                globalThis.createSnapshotPersistence = async (logs) => {
                    const root = await navigator.storage.getDirectory();
                    return new FSAPIStorageEventManagerAdapter(
                        root, (message, level, key) => logs.push({ message, key })
                    ).persistence;
                };
            `,
        },
        bundle: true,
        format: "iife",
        platform: "browser",
        write: false,
    });
    const script = outputFiles[0].text.replace(/<\/script/giu, "<\\/script");
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(`${origin}/**`, (route) =>
            route.fulfill({ contentType: "text/html", body: `<!doctype html><script>${script}</script>` })
        );
        const committed = [
            {
                type: "CHANGED",
                args: {
                    file: {
                        path: "committed.md",
                        name: "committed.md",
                        isFolder: false,
                        stat: { type: "file", size: 5, mtime: 1, ctime: 1 },
                    },
                },
            },
            { type: "SENTINEL_FLUSH" },
        ];
        const restored = [{ ...committed[0], key: "committed.md" }, committed[1]];
        await page.goto(origin);
        await page.evaluate(async (entries) => {
            const persistence = await window.createSnapshotPersistence([]);
            await persistence.saveSnapshot(entries);
        }, committed);

        await page.reload();
        const result = await page.evaluate(async () => {
            const logs: Array<{ message: string; key: string }> = [];
            const persistence = await window.createSnapshotPersistence(logs);
            const before = await persistence.loadSnapshot();
            const put = IDBObjectStore.prototype.put;
            let requestSucceeded = false;
            IDBObjectStore.prototype.put = function (value, key) {
                const request = put.call(this, value, key);
                if (this.name === "snapshots" && key === "file-events") {
                    request.addEventListener(
                        "success",
                        () => {
                            requestSucceeded = true;
                            this.transaction.abort();
                        },
                        { once: true }
                    );
                }
                return request;
            };
            let failure: string | undefined;
            try {
                await persistence.saveSnapshot([{ type: "SENTINEL_FLUSH" }]);
            } catch (error) {
                failure = String(error);
            } finally {
                IDBObjectStore.prototype.put = put;
            }
            return { before, requestSucceeded, failure, logs, after: await persistence.loadSnapshot() };
        });
        assert.deepEqual(result.before, restored);
        assert.equal(result.requestSucceeded, true, "The write request must succeed before the transaction aborts");
        assert.match(result.failure ?? "", /Failed to save the WebApp storage-event snapshot|AbortError/);
        assert.equal(result.logs.length, 1);
        assert.equal(result.logs[0].key, "fsapi-snapshot");
        assert.match(result.logs[0].message, /Failed to save snapshot/);
        assert.deepEqual(result.after, restored);

        await page.reload();
        const reopened = await page.evaluate(async () => {
            const persistence = await window.createSnapshotPersistence([]);
            return await persistence.loadSnapshot();
        });
        assert.deepEqual(reopened, restored);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});

declare global {
    interface Window {
        createSnapshotPersistence(logs: unknown[]): Promise<{
            saveSnapshot(events: Array<{ type: string; args?: unknown }>): Promise<void>;
            loadSnapshot(): Promise<unknown>;
        }>;
    }
}
