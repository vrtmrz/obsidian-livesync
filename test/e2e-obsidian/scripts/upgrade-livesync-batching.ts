/** Keeps the 1.0.40 batching choice and Vault state when installing the current release. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
} from "../runner/couchdb.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    assertEqual,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { ensurePinnedReleaseArtifact, type PinnedPluginRelease } from "../runner/releaseArtifact.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { readRuntimeUpgradeState, waitForPersistentNodeIdentity } from "../runner/upgradeWorkflow.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

const sourceRelease: PinnedPluginRelease = {
    pluginId: "obsidian-livesync",
    version: "1.0.40",
    files: [
        {
            name: "main.js",
            url: "https://github.com/vrtmrz/obsidian-livesync/releases/download/1.0.40/main.js",
            sha256: "bdd6b18ffe36a6a72ce774e857889b70d379559e4a5a3ccafee357a42daca6e9",
        },
        {
            name: "manifest.json",
            url: "https://github.com/vrtmrz/obsidian-livesync/releases/download/1.0.40/manifest.json",
            sha256: "8f8f57fb105aba0ce7f9ea5104dbed92fea837d49fdf27b4f02b6099ddf1ba3b",
        },
        {
            name: "styles.css",
            url: "https://github.com/vrtmrz/obsidian-livesync/releases/download/1.0.40/styles.css",
            sha256: "4ba00bef417ee98d9a62dd9febb792dc6555949cfc9e8e069450ad699ab2b9f0",
        },
    ],
};

type BatchState = {
    batchSave: boolean;
    batchSaveInLiveSync: boolean | null;
    liveSync: boolean;
    periodicReplication: boolean;
    shouldBatchSave: boolean;
    minimum: number;
    maximum: number;
};

const beforePath = "upgrade-batching-before.md";
const afterPath = "upgrade-batching-after.md";
const returnPath = "upgrade-batching-return.md";
const beforeContent = "Saved by the published 1.0.40 plug-in.\n";
const afterContent = "Saved after upgrading with LiveSync batching still disabled.\n";
const returnContent = "Returned by an independent current-release Vault.\n";

async function artefactHashes(root: string): Promise<Record<string, string>> {
    return Object.fromEntries(
        await Promise.all(
            sourceRelease.files.map(async ({ name }) => [
                name,
                createHash("sha256")
                    .update(new Uint8Array(await readFile(join(root, name))))
                    .digest("hex"),
            ])
        )
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const sourceRoot = await ensurePinnedReleaseArtifact(sourceRelease);
    const targetRoot = resolve(process.env.E2E_LIVESYNC_TARGET_ARTIFACT_ROOT?.trim() || process.cwd());
    const targetManifest = JSON.parse(await readFile(join(targetRoot, "manifest.json"), "utf8"));
    if (targetManifest.id !== sourceRelease.pluginId || targetManifest.version === sourceRelease.version) {
        throw new Error("The target must be a newer Self-hosted LiveSync build.");
    }
    const hashes = await artefactHashes(targetRoot);
    const config = await loadCouchDbConfig();
    if (!["127.0.0.1", "localhost"].includes(new URL(config.uri).hostname)) {
        throw new Error("Use a disposable local CouchDB for the upgrade scenario.");
    }
    const dbName = makeUniqueDatabaseName(config.dbPrefix, "upgrade-batching");
    const vault = await createTemporaryVault("obsidian-upgrade-batching-");
    const verifier = await createTemporaryVault("obsidian-upgrade-verifier-");
    let session: ObsidianLiveSyncSession | undefined;
    let ownsDatabase = false;
    const pluginData = createE2eCouchDbPluginData(
        { ...config, dbName },
        {
            batchSave: true,
            batchSaveMinimumDelay: 3,
            batchSaveMaximumDelay: 7,
            liveSync: false,
            periodicReplication: false,
            syncOnFileOpen: false,
            syncOnEditorSave: false,
            syncAfterMerge: false,
            doctorProcessedVersion: "1.0.0",
        }
    );

    async function stop(): Promise<void> {
        if (session) await session.app.stop();
        session = undefined;
    }

    async function start(currentVault: TemporaryVault, artifactRoot: string, seed = false): Promise<void> {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault: currentVault,
            artifactRoot,
            pluginStartup: seed ? undefined : "natural",
            pluginData: seed ? pluginData : undefined,
            localStorageEntries: seed ? createE2eObsidianDeviceLocalState(currentVault.name) : undefined,
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
    }

    async function evaluate<T>(body: string): Promise<T> {
        if (!session) throw new Error("No active Obsidian session");
        return await evalObsidianJson<T>(
            cliBinary,
            `(async()=>{
            const core=app.plugins.plugins['obsidian-livesync'].core;
            return JSON.stringify(await(async()=>{${body}})());
        })()`,
            session.cliEnv
        );
    }

    async function batching(): Promise<BatchState> {
        return await evaluate<BatchState>(`
            const s=core.services.setting.currentSettings();
            return {batchSave:s.batchSave,batchSaveInLiveSync:s.batchSaveInLiveSync??null,
                liveSync:s.liveSync,periodicReplication:s.periodicReplication,
                shouldBatchSave:core.serviceModules.storageAccess.vaultManager.shouldBatchSave,
                minimum:s.batchSaveMinimumDelay,maximum:s.batchSaveMaximumDelay};
        `);
    }

    async function createNote(path: string, content: string): Promise<void> {
        await evaluate(`await app.vault.create(${JSON.stringify(path)},${JSON.stringify(content)}); return true;`);
        const entry = await waitForLocalDatabaseEntry(cliBinary, session!.cliEnv, path);
        if ((await batching()).liveSync) {
            await waitForCouchDbDocs(config, dbName, (docs) =>
                docs.some((doc) => doc._id === entry.id && doc._rev === entry.rev)
            );
        } else {
            await pushLocalChanges(cliBinary, session!.cliEnv);
        }
    }

    async function assertNote(currentVault: TemporaryVault, path: string, content: string): Promise<void> {
        const actual = await evaluate(`
            const until=Date.now()+15000;
            while(Date.now()<until){
                const file=app.vault.getAbstractFileByPath(${JSON.stringify(path)});
                if(file?.stat){const value=await app.vault.read(file);if(value===${JSON.stringify(content)})return value;}
                await new Promise(resolve=>setTimeout(resolve,100));
            }
            throw new Error('Expected Vault contents did not arrive: '+${JSON.stringify(path)});
        `);
        assertEqual(actual, content, "The Obsidian Vault did not contain the expected text.");
        assertEqual(await readFile(join(currentVault.path, path), "utf8"), content, "On-disk text differed.");
    }

    function assertUpgradedBatching(state: BatchState, live: boolean): void {
        assertEqual(state.batchSave, true, "The legacy batching choice changed during upgrade.");
        assertEqual(state.batchSaveInLiveSync, false, "Upgrade unexpectedly enabled LiveSync batching.");
        assertEqual(state.liveSync, live, "The selected synchronisation mode changed.");
        assertEqual(state.shouldBatchSave, !live, "The retained choice applied to the wrong mode.");
        assertEqual(state.minimum, 3, "The minimum batch delay changed.");
        assertEqual(state.maximum, 7, "The maximum batch delay changed.");
    }

    try {
        await assertCouchDbReachable(config);
        await createCouchDbDatabase(config, dbName);
        ownsDatabase = true;
        await start(vault, sourceRoot, true);
        await prepareRemote(cliBinary, session!.cliEnv);
        await createNote(beforePath, beforeContent);
        await evaluate(`
            const s=core.services.setting.currentSettings();
            s.liveSync=true;
            await core.services.setting.saveSettingData();
            await core.services.control.applySettings();
            return true;
        `);
        await stop();

        // Confirm that the old release itself persisted this state before replacing any artefacts.
        await start(vault, sourceRoot);
        const oldBatch = await batching();
        assertEqual(oldBatch.batchSave, true, "The old release did not retain its batching choice.");
        assertEqual(oldBatch.batchSaveInLiveSync, null, "The old release unexpectedly owns the new setting.");
        assertEqual(oldBatch.liveSync, true, "The old release did not retain LiveSync mode.");
        assertEqual(oldBatch.shouldBatchSave, false, "The old release unexpectedly batches LiveSync mode.");
        await waitForPersistentNodeIdentity(cliBinary, session!.cliEnv);
        const before = await readRuntimeUpgradeState(cliBinary, session!.cliEnv);
        const originalEntry = await waitForLocalDatabaseEntry(cliBinary, session!.cliEnv, beforePath);
        await assertNote(vault, beforePath, beforeContent);
        await stop();
        const savedOldData = JSON.parse(
            await readFile(join(vault.path, ".obsidian/plugins/obsidian-livesync/data.json"), "utf8")
        );
        assertEqual(
            Object.prototype.hasOwnProperty.call(savedOldData, "batchSaveInLiveSync"),
            false,
            "The old settings fixture contains the new option."
        );

        await start(vault, targetRoot);
        const upgraded = await readRuntimeUpgradeState(cliBinary, session!.cliEnv);
        assertEqual(upgraded.pluginVersion, targetManifest.version, "The requested target build was not loaded.");
        assertEqual(upgraded.localDatabaseName, before.localDatabaseName, "Upgrade replaced the local database.");
        assertEqual(upgraded.nodeId, before.nodeId, "Upgrade replaced the device identity.");
        assertEqual(
            upgraded.settings.activeConfigurationId,
            before.settings.activeConfigurationId,
            "Upgrade changed the remote profile."
        );
        assertEqual(upgraded.settings.couchDB_DBNAME, dbName, "Upgrade selected another remote database.");
        assertEqual(upgraded.settings.versionUpFlash, "", "Upgrade unexpectedly paused for compatibility review.");
        const firstBatch = await batching();
        assertUpgradedBatching(firstBatch, true);
        assertEqual(
            (await waitForLocalDatabaseEntry(cliBinary, session!.cliEnv, beforePath)).rev,
            originalEntry.rev,
            "Upgrade rewrote existing Metadata."
        );
        await assertNote(vault, beforePath, beforeContent);
        await createNote(afterPath, afterContent);
        await stop();

        await start(verifier, targetRoot, true);
        await prepareRemote(cliBinary, session!.cliEnv);
        await pushLocalChanges(cliBinary, session!.cliEnv);
        await assertNote(verifier, beforePath, beforeContent);
        await assertNote(verifier, afterPath, afterContent);
        await createNote(returnPath, returnContent);
        await stop();

        await start(vault, targetRoot);
        assertUpgradedBatching(await batching(), true);
        await assertNote(vault, returnPath, returnContent);
        await evaluate(`
            const s=core.services.setting.currentSettings();
            s.liveSync=false;s.periodicReplication=true;s.periodicReplicationInterval=60;
            await core.services.setting.saveSettingData();
            await core.services.control.applySettings();
            return true;
        `);
        assertUpgradedBatching(await batching(), false);
        await stop();
        await start(vault, targetRoot);
        const finalBatch = await batching();
        assertUpgradedBatching(finalBatch, false);
        assertEqual(finalBatch.periodicReplication, true, "The periodic mode choice did not survive restart.");
        await assertNote(vault, returnPath, returnContent);
        assertEqual(
            JSON.stringify(await artefactHashes(targetRoot)),
            JSON.stringify(hashes),
            "Target artefacts changed during the test."
        );
        console.log(
            JSON.stringify(
                {
                    passed: true,
                    sourceVersion: sourceRelease.version,
                    targetVersion: targetManifest.version,
                    sourceHashes: Object.fromEntries(sourceRelease.files.map((file) => [file.name, file.sha256])),
                    targetHashes: hashes,
                    oldBatch,
                    firstBatch,
                    finalBatch,
                    retainedDatabase: true,
                    retainedNodeIdentity: true,
                    retainedMetadataRevision: true,
                    twoWayTransfer: true,
                    naturalRestarts: true,
                },
                null,
                2
            )
        );
    } finally {
        await stop();
        await vault.dispose();
        await verifier.dispose();
        if (ownsDatabase) await deleteCouchDbDatabase(config, dbName);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
