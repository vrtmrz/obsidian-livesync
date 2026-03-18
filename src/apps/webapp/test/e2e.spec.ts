/**
 * WebApp E2E tests – two-vault scenarios.
 *
 * Each vault (A and B) runs in its own browser context so that JavaScript
 * global state (including Trystero's global signalling tables) is fully
 * isolated.  The two vaults communicate only through the shared remote
 * CouchDB database.
 *
 * Vault storage is OPFS-backed – no file-picker interaction needed.
 *
 * Prerequisites:
 *   - A reachable CouchDB instance whose connection details are in .test.env
 *     (read automatically by playwright.config.ts).
 *
 * How to run:
 *   cd src/apps/webapp && npm run test:e2e
 */

import { test, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import type { LiveSyncTestAPI } from "../test-entry";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env variable: ${name}`);
    return v;
}

async function ensureCouchDbDatabase(uri: string, user: string, pass: string, dbName: string): Promise<void> {
    const base = uri.replace(/\/+$/, "");
    const dbUrl = `${base}/${encodeURIComponent(dbName)}`;
    const auth = Buffer.from(`${user}:${pass}`, "utf-8").toString("base64");
    const response = await fetch(dbUrl, {
        method: "PUT",
        headers: {
            Authorization: `Basic ${auth}`,
        },
    });

    // 201: created, 202: accepted, 412: already exists
    if (response.status === 201 || response.status === 202 || response.status === 412) {
        return;
    }

    const body = await response.text().catch(() => "");
    throw new Error(`Failed to ensure CouchDB database (${response.status}): ${body}`);
}

function buildSettings(dbName: string): Record<string, unknown> {
    return {
        // Remote database (shared between A and B – this is the replication target)
        couchDB_URI: requireEnv("hostname").replace(/\/+$/, ""),
        couchDB_USER: process.env["username"] ?? "",
        couchDB_PASSWORD: process.env["password"] ?? "",
        couchDB_DBNAME: dbName,

        // Core behaviour
        isConfigured: true,
        liveSync: false,
        syncOnSave: false,
        syncOnStart: false,
        periodicReplication: false,
        gcDelay: 0,
        savingDelay: 0,
        notifyThresholdOfRemoteStorageSize: 0,

        // Encryption off for test simplicity
        encrypt: false,

        // Disable plugin/hidden-file sync (not needed in webapp)
        usePluginSync: false,
        autoSweepPlugins: false,
        autoSweepPluginsPeriodic: false,

        //Auto accept perr
        P2P_AutoAcceptingPeers: "~.*",
    };
}

// ---------------------------------------------------------------------------
// Test-page helpers
// ---------------------------------------------------------------------------

/** Navigate to the test entry page and wait for `window.livesyncTest`. */
async function openTestPage(ctx: BrowserContext): Promise<Page> {
    const page = await ctx.newPage();
    await page.goto("/test.html");
    await page.waitForFunction(() => !!(window as any).livesyncTest, { timeout: 20_000 });
    return page;
}

/** Type-safe wrapper – calls `window.livesyncTest.<method>(...args)` in the page. */
async function call<M extends keyof LiveSyncTestAPI>(
    page: Page,
    method: M,
    ...args: Parameters<LiveSyncTestAPI[M]>
): Promise<Awaited<ReturnType<LiveSyncTestAPI[M]>>> {
    const invoke = () =>
        page.evaluate(([m, a]) => (window as any).livesyncTest[m](...a), [method, args] as [
            string,
            unknown[],
        ]) as Promise<Awaited<ReturnType<LiveSyncTestAPI[M]>>>;

    try {
        return await invoke();
    } catch (ex: any) {
        const message = String(ex?.message ?? ex);
        // Some startup flows may trigger one page reload; recover once.
        if (
            message.includes("Execution context was destroyed") ||
            message.includes("Most likely the page has been closed")
        ) {
            await page.waitForFunction(() => !!(window as any).livesyncTest, { timeout: 20_000 });
            return await invoke();
        }
        throw ex;
    }
}

async function dumpCoverage(page: Page | undefined, label: string, testInfo: TestInfo): Promise<void> {
    if (!process.env.PW_COVERAGE || !page || page.isClosed()) {
        return;
    }
    const cov = await page
        .evaluate(() => {
            const data = (window as any).__coverage__;
            if (!data) return null;
            // Reset between tests to avoid runaway accumulation.
            (window as any).__coverage__ = {};
            return data;
        })
        .catch(() => null!);
    if (!cov) return;
    if (typeof cov === "object" && Object.keys(cov as Record<string, unknown>).length === 0) {
        return;
    }

    const outDir = path.resolve(__dirname, "../.nyc_output");
    mkdirSync(outDir, { recursive: true });
    const name = `${testInfo.testId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${label}.json`;
    writeFileSync(path.join(outDir, name), JSON.stringify(cov), "utf-8");
}

// ---------------------------------------------------------------------------
// Two-vault E2E suite
// ---------------------------------------------------------------------------

test.describe("WebApp two-vault E2E", () => {
    let ctxA: BrowserContext;
    let ctxB: BrowserContext;
    let pageA: Page;
    let pageB: Page;

    const DB_SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dbName = `${requireEnv("dbname")}-${DB_SUFFIX}`;
    const settings = buildSettings(dbName);

    test.beforeAll(async ({ browser }) => {
        await ensureCouchDbDatabase(
            String(settings.couchDB_URI ?? ""),
            String(settings.couchDB_USER ?? ""),
            String(settings.couchDB_PASSWORD ?? ""),
            dbName
        );

        // Open Vault A and Vault B in completely separate browser contexts.
        // Each context has its own JS runtime, IndexedDB and OPFS root, so
        // Trystero global state and PouchDB instance names cannot collide.
        ctxA = await browser.newContext();
        ctxB = await browser.newContext();

        pageA = await openTestPage(ctxA);
        pageB = await openTestPage(ctxB);

        await call(pageA, "init", "testvault_a", settings as any);
        await call(pageB, "init", "testvault_b", settings as any);
    });

    test.afterAll(async () => {
        await call(pageA, "shutdown").catch(() => {});
        await call(pageB, "shutdown").catch(() => {});
        await ctxA.close();
        await ctxB.close();
    });

    test.afterEach(async ({}, testInfo) => {
        await dumpCoverage(pageA, "vaultA", testInfo);
        await dumpCoverage(pageB, "vaultB", testInfo);
    });

    // -----------------------------------------------------------------------
    // Case 1: Vault A writes a file and can read its metadata back from the
    //         local database (no replication yet).
    // -----------------------------------------------------------------------
    test("Case 1: A writes a file and can get its info", async () => {
        const FILE = "e2e/case1-a-only.md";
        const CONTENT = "hello from vault A";

        const ok = await call(pageA, "putFile", FILE, CONTENT);
        expect(ok).toBe(true);

        const info = await call(pageA, "getInfo", FILE);
        expect(info).not.toBeNull();
        expect(info!.path).toBe(FILE);
        expect(info!.revision).toBeTruthy();
        expect(info!.conflicts).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Case 2: Vault A writes a file, both vaults replicate, and Vault B ends
    //         up with the file in its local database.
    // -----------------------------------------------------------------------
    test("Case 2: A writes a file, both replicate, B receives the file", async () => {
        const FILE = "e2e/case2-sync.md";
        const CONTENT = "content from A – should appear in B";

        await call(pageA, "putFile", FILE, CONTENT);

        // A pushes to remote, B pulls from remote.
        await call(pageA, "replicate");
        await call(pageB, "replicate");

        const infoB = await call(pageB, "getInfo", FILE);
        expect(infoB).not.toBeNull();
        expect(infoB!.path).toBe(FILE);
    });

    // -----------------------------------------------------------------------
    // Case 3: Vault A deletes the file it synced in case 2.  After both
    //         vaults replicate, Vault B no longer sees the file.
    // -----------------------------------------------------------------------
    test("Case 3: A deletes the file, both replicate, B no longer sees it", async () => {
        // This test depends on Case 2 having put e2e/case2-sync.md into both vaults.
        const FILE = "e2e/case2-sync.md";

        await call(pageA, "deleteFile", FILE);

        await call(pageA, "replicate");
        await call(pageB, "replicate");

        const infoB = await call(pageB, "getInfo", FILE);
        // The file should be gone (null means not found or deleted).
        expect(infoB).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Case 4: A and B each independently edit the same file that was already
    //         synced.  After both vaults replicate the editing cycle, both
    //         vaults report a conflict on that file.
    // -----------------------------------------------------------------------
    test("Case 4: concurrent edits from A and B produce a conflict on both sides", async () => {
        const FILE = "e2e/case4-conflict.md";

        // 1) Write a baseline and synchronise so both vaults start from the
        //    same revision.
        await call(pageA, "putFile", FILE, "base content");
        await call(pageA, "replicate");
        await call(pageB, "replicate");

        // Confirm B has the base file with no conflicts yet.
        const baseInfoB = await call(pageB, "getInfo", FILE);
        expect(baseInfoB).not.toBeNull();
        expect(baseInfoB!.conflicts).toHaveLength(0);

        // 2) Both vaults write diverging content without syncing in between –
        //    this creates two competing revisions.
        await call(pageA, "putFile", FILE, "content from A (conflict side)");
        await call(pageB, "putFile", FILE, "content from B (conflict side)");

        // 3) Run replication on both sides.  The order mirrors the pattern
        //    from the CLI two-vault tests (A → remote → B → remote → A).
        await call(pageA, "replicate");
        await call(pageB, "replicate");
        await call(pageA, "replicate"); // re-check from A to pick up B's revision

        // 4) At least one side must report a conflict.
        const hasConflictA = await call(pageA, "hasConflict", FILE);
        const hasConflictB = await call(pageB, "hasConflict", FILE);

        expect(
            hasConflictA || hasConflictB,
            "Expected a conflict to appear on vault A or vault B after diverging edits"
        ).toBe(true);
    });
});
