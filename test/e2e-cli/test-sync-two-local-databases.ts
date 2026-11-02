/**
 * Node.js port of test-sync-two-local-databases-linux.sh
 *
 * Tests two-vault synchronisation via CouchDB including conflict detection
 * and resolution.
 *
 * Requires CouchDB connection details.  Provide them via environment variables
 * OR place a .test.env file at src/apps/cli/.test.env.
 *
 * By default, a CouchDB Docker container is started automatically
 * (LIVESYNC_START_DOCKER=1).  Set LIVESYNC_START_DOCKER=0 to use an existing
 * CouchDB instance instead.
 *
 * Run:
 *   node --test test-sync-two-local-databases.ts
 *
 * With an existing CouchDB:
 *   COUCHDB_URI=http://127.0.0.1:5984 \
 *   COUCHDB_USER=admin \
 *   COUCHDB_PASSWORD=password \
 *   COUCHDB_DBNAME=livesync-test \
 *   LIVESYNC_START_DOCKER=0 \
 *   node --test test-sync-two-local-databases.ts
 */

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { TempDir } from "./helpers/temp.ts";
import { runCliOrFail, jsonFieldIsNa } from "./helpers/cli.ts";
import { applyCouchdbSettings, initSettingsFile } from "./helpers/settings.ts";
import { startCouchdb, stopCouchdb } from "./helpers/docker.ts";

// ---------------------------------------------------------------------------
// Load configuration
// ---------------------------------------------------------------------------

async function resolveConfig(): Promise<{
    uri: string;
    user: string;
    password: string;
    baseDbname: string;
} | null> {
    const env = { ...process.env };

    const uri = (env["COUCHDB_URI"] ?? env["hostname"] ?? "").replace(/\/$/, "");
    const user = env["COUCHDB_USER"] ?? env["username"] ?? "";
    const password = env["COUCHDB_PASSWORD"] ?? env["password"] ?? "";
    const baseDbname = env["COUCHDB_DBNAME"] ?? env["dbname"] ?? "livesync-test";

    if (!uri || !user || !password) return null;
    return { uri, user, password, baseDbname };
}

const config = await resolveConfig();
const START_DOCKER = process.env["LIVESYNC_START_DOCKER"] !== "0";
const KEEP_DOCKER = process.env["LIVESYNC_DEBUG_KEEP_DOCKER"] === "1";
const SYNC_RETRY = Number(process.env["LIVESYNC_SYNC_RETRY"] ?? "8");

// Provide a sane default for flaky remote connectivity in Docker-on-WSL
// environments. Users can override explicitly if needed.
if (!Object.hasOwn(process.env, "LIVESYNC_CLI_RETRY")) {
    (process.env["LIVESYNC_CLI_RETRY"] = "2");
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test(
    "sync two local databases: sync + conflict detection + resolution",
    { skip: config === null },
    async (t) => {
        if (!config) return; // narrowing for TypeScript

        const suffix = `${Date.now()}-${Math.floor(Math.random() * 65535)}`;
        const dbname = `${config.baseDbname}-${suffix}`;

        await using workDir = await TempDir.create("livesync-cli-two-db-test");

        // ------------------------------------------------------------------
        // Docker lifecycle
        // ------------------------------------------------------------------
        if (START_DOCKER) {
            await startCouchdb(config.uri, config.user, config.password, dbname);
        }

        try {
            await runSuite(t, workDir, config, dbname);
        } finally {
            if (START_DOCKER && !KEEP_DOCKER) {
                await stopCouchdb().catch(() => {});
            }
            if (START_DOCKER && KEEP_DOCKER) {
                console.log("[INFO] LIVESYNC_DEBUG_KEEP_DOCKER=1, keeping couchdb-test container");
            }
            console.log(`[INFO] test database '${dbname}' is preserved for debugging.`);
        }
    }
);

// ---------------------------------------------------------------------------
// Suite implementation
// ---------------------------------------------------------------------------

async function runSuite(
    t: TestContext,
    workDir: TempDir,
    config: { uri: string; user: string; password: string },
    dbname: string
): Promise<void> {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const runWithRetry = async <T>(label: string, fn: () => Promise<T>, retries = SYNC_RETRY): Promise<T> => {
        let lastErr: unknown;
        for (let i = 0; i <= retries; i++) {
            try {
                return await fn();
            } catch (err) {
                lastErr = err;
                if (i === retries) break;
                const delayMs = 500 * (i + 1);
                console.warn(`[WARN] ${label} failed, retrying (${i + 1}/${retries}) in ${delayMs}ms`);
                await sleep(delayMs);
            }
        }
        throw lastErr;
    };

    const vaultA = workDir.join("vault-a");
    const vaultB = workDir.join("vault-b");
    const settingsA = workDir.join("a-settings.json");
    const settingsB = workDir.join("b-settings.json");
    await mkdir(vaultA, { recursive: true });
    await mkdir(vaultB, { recursive: true });

    await initSettingsFile(settingsA);
    await initSettingsFile(settingsB);

    const applySettings = async (f: string) =>
        applyCouchdbSettings(f, config.uri, config.user, config.password, dbname, /* liveSync */ true);
    await applySettings(settingsA);
    await applySettings(settingsB);

    const runA = (...args: string[]) => runCliOrFail(vaultA, "--settings", settingsA, ...args);
    const runB = (...args: string[]) => runCliOrFail(vaultB, "--settings", settingsB, ...args);

    const syncA = () => runWithRetry("syncA", () => runA("sync"));
    const syncB = () => runWithRetry("syncB", () => runB("sync"));
    const catA = (path: string) => runA("cat", path);
    const catB = (path: string) => runB("cat", path);

    // ------------------------------------------------------------------
    // Case 1: A creates file, B reads after sync
    // ------------------------------------------------------------------
    await t.test("case 1: A creates file -> B can read after sync", async () => {
        const srcA = workDir.join("from-a-src.txt");
        await writeFile(srcA, "from-a\n");
        await runA("push", srcA, "shared/from-a.txt");
        await syncA();
        await syncB();
        const value = (await catB("shared/from-a.txt")).replace(/\r\n/g, "\n").trimEnd();
        assert.deepStrictEqual(value, "from-a", "B could not read file created on A");
        console.log("[PASS] case 1 passed");
    });

    // ------------------------------------------------------------------
    // Case 2: B creates file, A reads after sync
    // ------------------------------------------------------------------
    await t.test("case 2: B creates file -> A can read after sync", async () => {
        const srcB = workDir.join("from-b-src.txt");
        await writeFile(srcB, "from-b\n");
        await runB("push", srcB, "shared/from-b.txt");
        await syncB();
        await syncA();
        const value = (await catA("shared/from-b.txt")).replace(/\r\n/g, "\n").trimEnd();
        assert.deepStrictEqual(value, "from-b", "A could not read file created on B");
        console.log("[PASS] case 2 passed");
    });

    // ------------------------------------------------------------------
    // Case 3: concurrent edits create a conflict
    // ------------------------------------------------------------------
    await t.test("case 3: concurrent edits create conflict", async () => {
        const baseSrc = workDir.join("base-src.txt");
        await writeFile(baseSrc, "base\n");
        await runA("push", baseSrc, "shared/conflicted.txt");
        await syncA();
        await syncB();

        const aEdit = workDir.join("edit-a.txt");
        const bEdit = workDir.join("edit-b.txt");
        await writeFile(aEdit, "edit-from-a\n");
        await writeFile(bEdit, "edit-from-b\n");
        await runA("push", aEdit, "shared/conflicted.txt");
        await runB("push", bEdit, "shared/conflicted.txt");

        const infoFileA = workDir.join("info-a.json");
        const infoFileB = workDir.join("info-b.json");

        let conflictDetected = false;
        for (const side of ["a", "b"] as const) {
            if (side === "a") await syncA();
            else await syncB();
            await writeFile(infoFileA, await runA("info", "shared/conflicted.txt"));
            await writeFile(infoFileB, await runB("info", "shared/conflicted.txt"));
            const da = JSON.parse(await readFile(infoFileA, "utf8")) as Record<string, unknown>;
            const db = JSON.parse(await readFile(infoFileB, "utf8")) as Record<string, unknown>;
            if (!jsonFieldIsNa(da, "conflicts") || !jsonFieldIsNa(db, "conflicts")) {
                conflictDetected = true;
                break;
            }
        }
        assert(conflictDetected, "expected conflict after concurrent edits, but both sides show N/A");
        console.log("[PASS] case 3 conflict detected");
    });

    // ------------------------------------------------------------------
    // Case 4: resolve on A, verify B has no conflict after sync
    // ------------------------------------------------------------------
    await t.test("case 4: resolve on A propagates to B", async () => {
        const infoFileA = workDir.join("info-a-resolve.json");
        const infoFileB = workDir.join("info-b-resolve.json");

        // Ensure A sees the conflict
        for (let i = 0; i < 5; i++) {
            const raw = await runA("info", "shared/conflicted.txt");
            await writeFile(infoFileA, raw);
            const da = JSON.parse(raw) as Record<string, unknown>;
            if (!jsonFieldIsNa(da, "conflicts")) break;
            await syncB();
            await syncA();
        }

        const rawA = await runA("info", "shared/conflicted.txt");
        await writeFile(infoFileA, rawA);
        const dataA = JSON.parse(rawA) as Record<string, unknown>;
        assert(!jsonFieldIsNa(dataA, "conflicts"), "A does not see conflict, cannot resolve from A only");

        const keepRev = dataA["revision"] as string;
        assert(keepRev?.length > 0, "could not read revision from A info output");

        await runA("resolve", "shared/conflicted.txt", keepRev);

        let resolved = false;
        for (let i = 0; i < 6; i++) {
            await syncA();
            await syncB();
            const rawA2 = await runA("info", "shared/conflicted.txt");
            const rawB2 = await runB("info", "shared/conflicted.txt");
            await writeFile(infoFileA, rawA2);
            await writeFile(infoFileB, rawB2);
            const da2 = JSON.parse(rawA2) as Record<string, unknown>;
            const db2 = JSON.parse(rawB2) as Record<string, unknown>;
            if (jsonFieldIsNa(da2, "conflicts") && jsonFieldIsNa(db2, "conflicts")) {
                resolved = true;
                break;
            }
            // If A still sees a conflict, resolve it again
            if (!jsonFieldIsNa(da2, "conflicts")) {
                const rev2 = da2["revision"] as string;
                if (rev2) await runA("resolve", "shared/conflicted.txt", rev2).catch(() => {});
            }
        }
        assert(resolved, "conflicts should be resolved on both A and B");

        const contentA = (await catA("shared/conflicted.txt")).replace(/\r\n/g, "\n");
        const contentB = (await catB("shared/conflicted.txt")).replace(/\r\n/g, "\n");
        assert.deepStrictEqual(contentA, contentB, "resolved content mismatch between A and B");
        console.log("[PASS] case 4 passed");
        console.log("[PASS] all sync/resolve scenarios passed");
    });
}
