/**
 * LiveSync WebApp E2E test entry point.
 *
 * When served by vite dev server (at /test.html), this module wires up
 * `window.livesyncTest`, a plain JS API that Playwright tests can call via
 * `page.evaluate()`.  All methods are async and serialisation-safe.
 *
 * Vault storage is backed by OPFS so no `showDirectoryPicker()` interaction
 * is required, making it fully headless-compatible.
 */

import { LiveSyncWebApp } from "./main";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
import type { FilePathWithPrefix } from "@lib/common/types";

// --------------------------------------------------------------------------
// Internal state – one app instance per page / browser context
// --------------------------------------------------------------------------
let app: LiveSyncWebApp | null = null;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Strip the "plain:" / "enc:" / … prefix used internally in PouchDB paths. */
function stripPrefix(raw: string): string {
    return raw.replace(/^[^:]+:/, "");
}

/**
 * Poll every 300 ms until all known processing queues are drained, or until
 * the timeout elapses.  Mirrors `waitForIdle` in the existing vitest harness.
 */
async function waitForIdle(core: any, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const q =
            (core.services?.replication?.databaseQueueCount?.value ?? 0) +
            (core.services?.fileProcessing?.totalQueued?.value ?? 0) +
            (core.services?.fileProcessing?.batched?.value ?? 0) +
            (core.services?.fileProcessing?.processing?.value ?? 0) +
            (core.services?.replication?.storageApplyingCount?.value ?? 0);
        if (q === 0) return;
        await new Promise<void>((r) => setTimeout(r, 300));
    }
    throw new Error(`waitForIdle timed out after ${timeoutMs} ms`);
}

function getCore(): any {
    const core = (app as any)?.core;
    if (!core) throw new Error("Vault not initialised – call livesyncTest.init() first");
    return core;
}

// --------------------------------------------------------------------------
// Public test API
// --------------------------------------------------------------------------

export interface LiveSyncTestAPI {
    /**
     * Initialise a vault in OPFS under the given name and apply `settings`.
     * Any previous contents of the OPFS directory are wiped first so each
     * test run starts clean.
     */
    init(vaultName: string, settings: Partial<ObsidianLiveSyncSettings>): Promise<void>;

    /**
     * Write `content` to the local PouchDB under `vaultPath` (equivalent to
     * the CLI `put` command).  Waiting for the DB write to finish is
     * included; you still need to call `replicate()` to push to remote.
     */
    putFile(vaultPath: string, content: string): Promise<boolean>;

    /**
     * Mark `vaultPath` as deleted in the local PouchDB (equivalent to CLI
     * `rm`).  Call `replicate()` afterwards to propagate to remote.
     */
    deleteFile(vaultPath: string): Promise<boolean>;

    /**
     * Run one full replication cycle (push + pull) against the remote CouchDB,
     * then wait for the local storage-application queue to drain.
     */
    replicate(): Promise<boolean>;

    /**
     * Wait until all processing queues are idle.  Usually not needed after
     * `putFile` / `deleteFile` since those already await, but useful when
     * testing results after `replicate()`.
     */
    waitForIdle(timeoutMs?: number): Promise<void>;

    /**
     * Return metadata for `vaultPath` from the local database, or `null` if
     * not found / deleted.
     */
    getInfo(vaultPath: string): Promise<{
        path: string;
        revision: string;
        conflicts: string[];
        size: number;
        mtime: number;
    } | null>;

    /** Convenience wrapper: returns true when the doc has ≥1 conflict revision. */
    hasConflict(vaultPath: string): Promise<boolean>;

    /** Tear down the current app instance. */
    shutdown(): Promise<void>;
}

// --------------------------------------------------------------------------
// Implementation
// --------------------------------------------------------------------------

const livesyncTest: LiveSyncTestAPI = {
    async init(vaultName: string, settings: Partial<ObsidianLiveSyncSettings>): Promise<void> {
        // Clean up any stale OPFS data from previous runs.
        const opfsRoot = await navigator.storage.getDirectory();
        try {
            await opfsRoot.removeEntry(vaultName, { recursive: true });
        } catch {
            // directory did not exist – that's fine
        }
        const vaultDir = await opfsRoot.getDirectoryHandle(vaultName, { create: true });

        // Pre-write settings so they are loaded during initialise().
        const livesyncDir = await vaultDir.getDirectoryHandle(".livesync", { create: true });
        const settingsFile = await livesyncDir.getFileHandle("settings.json", { create: true });
        const writable = await settingsFile.createWritable();
        await writable.write(JSON.stringify(settings));
        await writable.close();

        app = new LiveSyncWebApp(vaultDir);
        await app.initialize();

        // Give background startup tasks a moment to settle.
        await waitForIdle(getCore(), 30_000);
    },

    async putFile(vaultPath: string, content: string): Promise<boolean> {
        const core = getCore();
        const result = await core.serviceModules.databaseFileAccess.storeContent(
            vaultPath as FilePathWithPrefix,
            content
        );
        await waitForIdle(core);
        return result !== false;
    },

    async deleteFile(vaultPath: string): Promise<boolean> {
        const core = getCore();
        const result = await core.serviceModules.databaseFileAccess.delete(vaultPath as FilePathWithPrefix);
        await waitForIdle(core);
        return result !== false;
    },

    async replicate(): Promise<boolean> {
        const core = getCore();
        const result = await core.services.replication.replicate(true);
        // After replicate() resolves, remote docs may still be queued for
        // local storage application – wait until all queues are drained.
        await waitForIdle(core);
        return result !== false;
    },

    async waitForIdle(timeoutMs?: number): Promise<void> {
        await waitForIdle(getCore(), timeoutMs ?? 60_000);
    },

    async getInfo(vaultPath: string) {
        const core = getCore();
        const db = core.services?.database;
        for await (const doc of db.localDatabase.findAllNormalDocs({ conflicts: true })) {
            if (doc._deleted || doc.deleted) continue;
            const docPath = stripPrefix(doc.path ?? "");
            if (docPath !== vaultPath) continue;
            return {
                path: docPath,
                revision: (doc._rev as string) ?? "",
                conflicts: (doc._conflicts as string[]) ?? [],
                size: (doc.size as number) ?? 0,
                mtime: (doc.mtime as number) ?? 0,
            };
        }
        return null;
    },

    async hasConflict(vaultPath: string): Promise<boolean> {
        const info = await livesyncTest.getInfo(vaultPath);
        return (info?.conflicts?.length ?? 0) > 0;
    },

    async shutdown(): Promise<void> {
        if (app) {
            await app.shutdown();
            app = null;
        }
    },
};

// Expose on window for Playwright page.evaluate() calls.
(window as any).livesyncTest = livesyncTest;
