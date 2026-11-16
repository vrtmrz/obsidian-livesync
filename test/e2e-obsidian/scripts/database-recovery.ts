import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    createTemporaryVault,
    installBuiltPlugin,
    launchObsidian,
    preseedTrustedVaultState,
    trustVaultIfPrompted,
    waitForObsidianVault,
    withObsidianPage,
    requireObsidianBinary,
    type ObsidianProcess,
} from "@vrtmrz/obsidian-test-session";
import { CURRENT_SETTING_VERSION } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import { DoctorRegulation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import type { App } from "obsidian";
import type { DocumentID, EntryDoc, FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

const vault = await createTemporaryVault({ prefix: "livesync-database-recovery-", pluginIds: ["obsidian-livesync"] });
const port = Number(process.env.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT ?? 19361);
const receivedPath = "received-after-connection-recovery.md";
const receivedContent = "Received ordinary content after local database recovery.\n";
const receivedContentHash = `sha256:${createHash("sha256").update(receivedContent, "utf8").digest("hex")}`;
const receivedContentSize = Buffer.byteLength(receivedContent, "utf8");
const recoveryTimeoutMs = Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000);
let application: ObsidianProcess | undefined;
try {
    await installBuiltPlugin(vault.path, {
        pluginId: "obsidian-livesync",
        artifactRoot: process.env.E2E_OBSIDIAN_ARTIFACT_ROOT?.trim() || process.cwd(),
        pluginData: {
            isConfigured: true,
            settingVersion: CURRENT_SETTING_VERSION,
            doctorProcessedVersion: DoctorRegulation.version,
            versionUpFlash: "",
            useIndexedDBAdapter: false,
            syncOnStart: false,
            liveSync: false,
            periodicReplication: false,
            P2P_Enabled: false,
            P2P_AutoStart: false,
            notifyThresholdOfRemoteStorageSize: 0,
        },
    });
    application = await launchObsidian({
        binary: requireObsidianBinary(),
        vaultPath: vault.path,
        homePath: vault.homePath,
        xdgConfigPath: vault.xdgConfigPath,
        xdgCachePath: vault.xdgCachePath,
        xdgDataPath: vault.xdgDataPath,
        userDataPath: vault.userDataPath,
        remoteDebuggingPort: port,
        staleProcessPattern: vault.processMarker,
    });
    await preseedTrustedVaultState(port, vault.id);
    await waitForObsidianVault(port, vault.path);
    await trustVaultIfPrompted(port);
    await withObsidianPage(port, async (page) => {
        await page.waitForFunction(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, ObsidianLiveSyncPlugin> } };
            };
            return Boolean(host.app?.plugins?.plugins?.["obsidian-livesync"]);
        });
        await page.evaluate(() => {
            const host = window as unknown as {
                app: App & { plugins: { plugins: Record<string, ObsidianLiveSyncPlugin> } };
            };
            const key = "__livesyncDatabaseRecoveryStartupScan";
            const state: { complete: boolean; remove?: () => void } = { complete: false };
            state.remove = host.app.plugins.plugins[
                "obsidian-livesync"
            ].core.services.appLifecycle.onScanningStartupIssues.addHandler(async () => {
                state.complete = true;
                return true;
            });
            (window as unknown as Record<string, unknown>)[key] = state;
        });
        await page.waitForFunction(() => {
            const { app } = window as unknown as {
                app: { plugins: { plugins: Record<string, ObsidianLiveSyncPlugin> } };
            };
            const state = (window as unknown as Record<string, { complete?: boolean }>)[
                "__livesyncDatabaseRecoveryStartupScan"
            ];
            const core = app.plugins.plugins["obsidian-livesync"].core;
            return core.services.appLifecycle.isReady() && state?.complete === true;
        });
        await page.evaluate(() => {
            const key = "__livesyncDatabaseRecoveryStartupScan";
            const state = (window as unknown as Record<string, { remove?: () => void }>)[key];
            state?.remove?.();
            delete (window as unknown as Record<string, unknown>)[key];
        });
        // tsx preserves names in nested callbacks; evaluate runs in a separate JavaScript realm.
        await page.evaluate(
            "globalThis.__name ??= (target, value) => Object.defineProperty(target, 'name', { value, configurable: true })"
        );
        const runRecoveryProbe = async ({
            receivedFixturePath,
            content,
            contentHash,
            contentSize,
            timeoutMs,
        }: {
            receivedFixturePath: string;
            content: string;
            contentHash: string;
            contentSize: number;
            timeoutMs: number;
        }) => {
            const { app } = window as unknown as {
                app: App & { plugins: { plugins: Record<string, ObsidianLiveSyncPlugin> } };
            };
            const { core } = app.plugins.plugins["obsidian-livesync"];
            const before = core.services.database.localDatabase;
            const pouch = before.localDatabase as typeof before.localDatabase & { id(): Promise<string> };
            const id = await pouch.id();
            const receivedPath = receivedFixturePath as FilePathWithPrefix;
            const receivedFileWasMissing = app.vault.getAbstractFileByPath(receivedPath) === null;
            if (!receivedFileWasMissing) {
                throw new Error(`Received-note fixture already exists: ${receivedPath}`);
            }
            const receivedBlob = new Blob([content], { type: "text/plain" });
            const receivedId = await core.services.path.path2id(receivedPath);
            const now = Date.now();
            const savedMetadata = await before.putDBEntry({
                _id: receivedId,
                path: receivedPath,
                data: receivedBlob,
                ctime: now,
                mtime: now,
                size: receivedBlob.size,
                children: [],
                datatype: "plain",
                type: "plain",
                eden: {},
            });
            if (!savedMetadata || !savedMetadata.ok) {
                throw new Error(`Could not seed received Metadata and Chunks: ${receivedPath}`);
            }
            const receivedMetadata = await before.getRaw<PouchDB.Core.ExistingDocument<EntryDoc>>(receivedId);
            if (
                !receivedMetadata ||
                receivedMetadata._rev !== savedMetadata.rev ||
                !("children" in receivedMetadata) ||
                !receivedMetadata.children?.length
            ) {
                throw new Error(`Could not verify seeded Metadata and Chunks: ${receivedPath}`);
            }
            const seededContent = await before.getDBEntry(
                receivedPath,
                { rev: receivedMetadata._rev },
                false,
                true,
                true
            );
            const seededData = seededContent && "data" in seededContent ? seededContent.data : undefined;
            const seededBody = Array.isArray(seededData) ? seededData.join("") : seededData;
            if (seededBody !== content)
                throw new Error(`Seeded Chunks did not reproduce the received note: ${receivedPath}`);
            const leaf = {
                _id: "h:connection-recovery-fixture" as DocumentID,
                type: "leaf" as const,
                data: "Retained chunk",
            };
            const stored = await pouch.put(leaf);
            const originalTransaction = Object.getOwnPropertyDescriptor(IDBDatabase.prototype, "transaction")?.value;
            if (typeof originalTransaction !== "function") {
                throw new Error("IndexedDB transaction is unavailable in the renderer.");
            }
            const localDatabaseRuntime = before as unknown as {
                getRaw: (...args: unknown[]) => Promise<unknown>;
            };
            const getRawDescriptor = Object.getOwnPropertyDescriptor(before, "getRaw");
            const originalGetRaw = localDatabaseRuntime.getRaw.bind(before);
            let injected = false;
            let receivingMetadataRead = false;
            let receiverMetadataReadFailed = false;
            let recoveryGateReached = false;
            let pendingObservedBeforeReopen = false;
            let failure = "none";
            let releaseRecoveryGate: () => void = () => undefined;
            const recoveryGateOpen = new Promise<void>((resolve) => {
                releaseRecoveryGate = resolve;
            });
            const removeRecoveryGate = core.services.databaseEvents.onBeforeDatabaseRecovery.addHandler(async () => {
                recoveryGateReached = true;
                await recoveryGateOpen;
                return true;
            });
            // Close the retained native handle only inside the receiver's read for this Metadata.
            IDBDatabase.prototype.transaction = function (...args) {
                if (!injected && receivingMetadataRead && this.name === `_pouch_${pouch.name}`) {
                    injected = true;
                    this.close();
                }
                try {
                    return Reflect.apply(originalTransaction, this, args);
                } catch (error) {
                    if (injected) failure = (error as Error).name;
                    throw error;
                }
            };
            localDatabaseRuntime.getRaw = async (...args) => {
                if (args[0] !== receivedMetadata._id || receiverMetadataReadFailed) {
                    return await originalGetRaw(...args);
                }
                receivingMetadataRead = true;
                try {
                    return await originalGetRaw(...args);
                } catch (error) {
                    receiverMetadataReadFailed = true;
                    failure = (error as Error).name;
                    throw error;
                } finally {
                    receivingMetadataRead = false;
                }
            };
            try {
                // This invokes the actual received-document handler without a remote request.
                const parseAccepted = await core.services.replication.parseSynchroniseResult([receivedMetadata]);
                if (!parseAccepted) {
                    throw new Error(`The receiver rejected ${receivedPath}`);
                }
                const readDeadline = Date.now() + timeoutMs;
                while (Date.now() < readDeadline && (!injected || !receiverMetadataReadFailed)) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                if (!injected || !receiverMetadataReadFailed) {
                    throw new Error(
                        `The receiver did not fail while reading ${receivedPath}: injected=${injected}, failure=${failure}`
                    );
                }
                const recoveryGateDeadline = Date.now() + timeoutMs;
                while (!recoveryGateReached && Date.now() < recoveryGateDeadline) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                if (!recoveryGateReached) {
                    throw new Error("Automatic database recovery did not reach reopen.");
                }
                const pendingSnapshot = await core.kvDB.get<{
                    pendingReflections?: {
                        documentId: string;
                        revision: string;
                        source: string;
                        state: string;
                        reason: string;
                    }[];
                }>("replicationResultProcessorSnapshot");
                const pendingTarget = pendingSnapshot?.pendingReflections?.find(
                    (target) => target.documentId === receivedMetadata._id
                );
                pendingObservedBeforeReopen =
                    pendingTarget?.revision === receivedMetadata._rev &&
                    pendingTarget.source === "received" &&
                    pendingTarget.state === "waiting" &&
                    pendingTarget.reason === "local-database";
            } finally {
                releaseRecoveryGate();
                removeRecoveryGate();
                IDBDatabase.prototype.transaction = originalTransaction;
                if (getRawDescriptor) {
                    Object.defineProperty(before, "getRaw", getRawDescriptor);
                } else {
                    delete (before as unknown as { getRaw?: unknown }).getRaw;
                }
            }
            const until = Date.now() + timeoutMs;
            while (Date.now() < until) {
                if (core.services.database.localDatabaseDirect !== before && core.services.database.isDatabaseReady())
                    break;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            const after = core.services.database.localDatabase;
            const retained = await after.localDatabase.get(leaf._id);
            let receivedFileContent: string | undefined;
            let receivedDatabaseContent: string | undefined;
            let receivedRevision: string | undefined;
            let provenance: { revision?: string; contentHash?: string; contentSize?: number } | undefined;
            let receivedPending = true;
            let receivedQueued = true;
            let snapshotObserved = false;
            const reflectionStore = core.services.keyValueDB.openSimpleStore("file-reflection-provenance-v1");
            const reflectionDeadline = Date.now() + timeoutMs;
            while (Date.now() < reflectionDeadline) {
                const file = app.vault.getFileByPath(receivedPath);
                if (file) {
                    receivedFileContent = await app.vault.read(file);
                    const reflectedMetadata = await after.getDBEntryMeta(receivedPath, undefined, true);
                    if (reflectedMetadata) {
                        receivedRevision = reflectedMetadata._rev;
                        const reflectedEntry = await after.getDBEntry(
                            receivedPath,
                            { rev: reflectedMetadata._rev },
                            false,
                            true,
                            true
                        );
                        const reflectedData =
                            reflectedEntry && "data" in reflectedEntry ? reflectedEntry.data : undefined;
                        receivedDatabaseContent = Array.isArray(reflectedData) ? reflectedData.join("") : reflectedData;
                    }
                    provenance = (await reflectionStore.get(receivedPath)) ?? undefined;
                }
                const snapshot = await core.kvDB.get<{
                    pendingReflections?: { documentId: string }[];
                    queued?: { _id: string }[];
                    processing?: { _id: string }[];
                }>("replicationResultProcessorSnapshot");
                snapshotObserved = snapshot !== undefined;
                receivedPending = (snapshot?.pendingReflections ?? []).some(
                    (target) => target.documentId === receivedMetadata._id
                );
                receivedQueued = [...(snapshot?.queued ?? []), ...(snapshot?.processing ?? [])].some(
                    (entry) => entry._id === receivedMetadata._id
                );
                if (
                    receivedFileContent === content &&
                    receivedDatabaseContent === content &&
                    receivedRevision === receivedMetadata._rev &&
                    provenance?.revision === receivedMetadata._rev &&
                    provenance.contentHash === contentHash &&
                    provenance.contentSize === contentSize &&
                    snapshotObserved &&
                    !receivedPending &&
                    !receivedQueued
                ) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            const localPath = "after-connection-recovery.md" as FilePathWithPrefix;
            await app.vault.create(localPath, "Accepted after connection recovery\n");
            const committed = await core.services.fileProcessing.commitPendingFileEvents();
            const entry = await after.getDBEntry(localPath);
            return {
                injected: Boolean(injected),
                failure,
                receiverMetadataReadFailed: Boolean(receiverMetadataReadFailed),
                pendingObservedBeforeReopen,
                receivedFileWasMissing,
                receivedFileContent,
                receivedDatabaseContent,
                receivedRevision,
                seededRevision: receivedMetadata._rev,
                provenanceRevision: provenance?.revision,
                provenanceHash: provenance?.contentHash,
                provenanceSize: provenance?.contentSize,
                snapshotObserved,
                pendingCleared: !receivedPending,
                receivedQueueCleared: !receivedQueued,
                replaced: after !== before,
                sameDatabase: id === (await (after.localDatabase as typeof pouch).id()),
                revisionMatches: retained._rev === stored.rev,
                contentMatches: "data" in retained && retained.data === leaf.data,
                committed,
                fileContent: entry && "data" in entry ? entry.data : undefined,
                ready: core.services.database.isDatabaseReady(),
            };
        };
        const input = {
            receivedFixturePath: receivedPath,
            content: receivedContent,
            contentHash: receivedContentHash,
            contentSize: receivedContentSize,
            timeoutMs: recoveryTimeoutMs,
        };
        const result = await page.evaluate<Awaited<ReturnType<typeof runRecoveryProbe>>, typeof input>(
            runRecoveryProbe,
            input
        );
        assert.equal(result.injected, true);
        assert.equal(result.failure, "InvalidStateError");
        assert.equal(result.receiverMetadataReadFailed, true);
        assert.equal(result.receivedFileWasMissing, true);
        assert.equal(result.receivedFileContent, receivedContent);
        assert.equal(result.receivedDatabaseContent, receivedContent);
        assert.equal(result.receivedRevision, result.seededRevision);
        assert.equal(result.provenanceRevision, result.seededRevision);
        assert.equal(result.provenanceHash, receivedContentHash);
        assert.equal(result.provenanceSize, receivedContentSize);
        assert.equal(result.pendingObservedBeforeReopen, true);
        assert.equal(result.snapshotObserved, true);
        assert.equal(result.pendingCleared, true);
        assert.equal(result.receivedQueueCleared, true);
        assert.equal(result.replaced, true);
        assert.equal(result.sameDatabase, true);
        assert.equal(result.revisionMatches, true);
        assert.equal(result.contentMatches, true);
        assert.equal(result.committed, true);
        assert.equal(result.ready, true);
        assert.equal(
            Array.isArray(result.fileContent) ? result.fileContent.join("") : result.fileContent,
            "Accepted after connection recovery\n"
        );
        console.log(JSON.stringify(result));
    });
} finally {
    await application?.stop();
    await vault.dispose();
}
