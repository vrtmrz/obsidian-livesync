/**
 * Verifies the central CouchDB tweak compatibility boundary in real Obsidian.
 *
 * The source Vault creates a remote preferred profile with a missing legacy
 * filename-case value. The target has the effective false value, but differs
 * in the chunk size and V2 customisation setting. Applying the ordinary
 * remote settings action must permit a fresh synchronisation without a Fetch. A
 * Separate true/false and true/missing case controls keep Fetch required.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MILESTONE_DOCID } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchAllCouchDbDocs,
    fetchCouchDbDocument,
    fetchCouchDbLocalDocs,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
    waitForCouchDbDocs,
    type CouchDbConfig,
    type CouchDbDocument,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertE2eCompatibilityMarker,
    assertEqual,
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";
import { waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "20000";

const milestoneId = MILESTONE_DOCID;
const compatibilityTitle = "Configuration Mismatch Detected";
const applySettingsAction = "Apply settings to this device";
const applySettingsWithFetchAction = "Apply settings to this device, and fetch again";
const dismissAction = "Dismiss";
const sourceNotePath = "E2E/tweak-compatibility/source.md";
const restartedNotePath = "E2E/tweak-compatibility/restarted.md";
const sourceNoteContent = `# Tweak compatibility source\n\n${"source-content ".repeat(1200)}\n`;
const restartedNoteContent = `# Tweak compatibility restart\n\n${"restart-content ".repeat(1200)}\n`;

type MilestoneDocument = CouchDbDocument & {
    tweak_values?: Record<string, unknown>;
};

type ReplicationResult = {
    succeeded: boolean;
    raw: unknown;
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function couchDbSettings(couchDb: CouchDbConfig, dbName: string) {
    return {
        uri: couchDb.uri,
        username: couchDb.username,
        password: couchDb.password,
        dbName,
    };
}

async function writeNote(cliBinary: string, env: NodeJS.ProcessEnv, path: string, content: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            "const folder=path.split('/').slice(0,-1).join('/');",
            "if(folder&&!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.delete(existing);",
            "await app.vault.create(path,content);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForPathContent(vaultPath: string, path: string, expected: string): Promise<void> {
    const fullPath = join(vaultPath, path);
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000);
    let lastContent = "";
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(fullPath, "utf-8");
            if (lastContent === expected) return;
        } catch {
            // The file may not have been reflected yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for reflected file: ${fullPath}\nLast content:\n${lastContent}`);
}

async function replicateOnce(cliBinary: string, env: NodeJS.ProcessEnv): Promise<ReplicationResult> {
    return await evalObsidianJson<ReplicationResult>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const result=await core.services.replication.replicate(true);",
            "return JSON.stringify({succeeded:result===true,raw:result??null});",
            "})()",
        ].join(""),
        env
    );
}

async function selectCompatibilityAction(
    port: number,
    action: string,
    forbiddenAction?: string,
    requiredAction?: string
): Promise<void> {
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 15000);
    await withObsidianPage(port, async (page) => {
        const dialogue = await waitForVisibleObsidianDialogue(page, compatibilityTitle, timeoutMs);
        const selected = dialogue.getByRole("button", { name: action, exact: true });
        await selected.waitFor({ state: "visible", timeout: timeoutMs });
        if (forbiddenAction !== undefined) {
            const forbidden = dialogue.getByRole("button", { name: forbiddenAction, exact: true });
            assertEqual(
                await forbidden.count(),
                0,
                `The compatibility dialogue unexpectedly offered '${forbiddenAction}'.`
            );
        }
        if (requiredAction !== undefined) {
            await dialogue
                .getByRole("button", { name: requiredAction, exact: true })
                .waitFor({ state: "visible", timeout: timeoutMs });
        }
        await selected.click({ timeout: timeoutMs });
        await dialogue.waitFor({ state: "hidden", timeout: timeoutMs });
    });
}

async function removeLegacyCasePreference(couchDb: CouchDbConfig, dbName: string): Promise<void> {
    const milestone = (await fetchCouchDbDocument(couchDb, dbName, milestoneId)) as MilestoneDocument;
    const tweakValues = milestone.tweak_values;
    assert(isRecord(tweakValues), "The remote milestone has no tweak-values map.");
    const preferred = tweakValues.PREFERRED;
    assert(isRecord(preferred), "The remote milestone has no preferred tweak profile.");
    assertEqual(preferred.customChunkSize, 0, "The source remote profile did not persist customChunkSize=0.");
    assertEqual(preferred.usePluginSyncV2, false, "The source remote profile did not persist usePluginSyncV2=false.");
    delete preferred.handleFilenameCaseSensitive;
    await putCouchDbDocument(couchDb, dbName, milestone);

    const rewritten = (await fetchCouchDbDocument(couchDb, dbName, milestoneId)) as MilestoneDocument;
    const rewrittenTweaks = rewritten.tweak_values;
    assert(isRecord(rewrittenTweaks), "The rewritten remote milestone has no tweak-values map.");
    const rewrittenPreferred = rewrittenTweaks.PREFERRED;
    assert(isRecord(rewrittenPreferred), "The rewritten remote milestone has no preferred tweak profile.");
    assertEqual(
        Object.prototype.hasOwnProperty.call(rewrittenPreferred, "handleFilenameCaseSensitive"),
        false,
        "The remote preferred profile still advertised the legacy filename-case value."
    );
}

async function startSession(
    binary: string,
    cliBinary: string,
    vault: TemporaryVault,
    pluginData?: Record<string, unknown>
): Promise<ObsidianLiveSyncSession> {
    return await startObsidianLiveSyncSession({
        binary,
        cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        ...(pluginData === undefined ? {} : { pluginData }),
        localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
    });
}

async function prepareConfiguredSession(
    binary: string,
    cliBinary: string,
    vault: TemporaryVault,
    settings: ReturnType<typeof couchDbSettings>,
    overrides: Record<string, unknown>
): Promise<ObsidianLiveSyncSession> {
    const session = await startSession(binary, cliBinary, vault, createE2eCouchDbPluginData(settings, overrides));
    try {
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await assertE2eCompatibilityMarker(cliBinary, session.cliEnv);
        await configureCouchDb(cliBinary, session.cliEnv, settings, overrides);
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        return session;
    } catch (error) {
        await session.app.stop().catch(() => undefined);
        throw error;
    }
}

async function readTweakState(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<{ customChunkSize: unknown; usePluginSyncV2: unknown; handleFilenameCaseSensitive: unknown }> {
    return await evalObsidianJson<{
        customChunkSize: unknown;
        usePluginSyncV2: unknown;
        handleFilenameCaseSensitive: unknown;
    }>(
        cliBinary,
        [
            "(()=>{",
            "const settings=app.plugins.plugins['obsidian-livesync'].core.services.setting.currentSettings();",
            "return JSON.stringify({customChunkSize:settings.customChunkSize,usePluginSyncV2:settings.usePluginSyncV2,handleFilenameCaseSensitive:settings.handleFilenameCaseSensitive});",
            "})()",
        ].join(""),
        env
    );
}

async function remoteDocumentSnapshot(couchDb: CouchDbConfig, dbName: string): Promise<string> {
    const [documents, localDocuments] = await Promise.all([
        fetchAllCouchDbDocs(couchDb, dbName),
        fetchCouchDbLocalDocs(couchDb, dbName),
    ]);
    return JSON.stringify([documents.rows, localDocuments.rows]);
}

async function verifyStaleTargetChoice(
    cliBinary: string,
    session: ObsidianLiveSyncSession,
    couchDb: CouchDbConfig,
    originalDbName: string,
    replacementDbName: string
): Promise<void> {
    const overrides = {
        customChunkSize: 60,
        usePluginSyncV2: true,
        handleFilenameCaseSensitive: true,
        autoAcceptCompatibleTweak: false,
    };
    await configureCouchDb(cliBinary, session.cliEnv, couchDbSettings(couchDb, originalDbName), overrides);
    await prepareRemote(cliBinary, session.cliEnv);
    const replicationPromise = replicateOnce(cliBinary, session.cliEnv);
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const dialogue = await waitForVisibleObsidianDialogue(page, compatibilityTitle, 15000);
        await dialogue.getByRole("button", { name: applySettingsWithFetchAction, exact: true }).waitFor();
    });
    await evalObsidianJson<unknown>(
        cliBinary,
        "(async()=>{globalThis.__tweakCompatibilityPublication=await app.plugins.plugins['obsidian-livesync'].core.services.replicator.acquireActiveReplicatorContext();return JSON.stringify(true);})()",
        session.cliEnv
    );
    await configureCouchDb(cliBinary, session.cliEnv, couchDbSettings(couchDb, replacementDbName), overrides);
    const publicationChanged = await evalObsidianJson<boolean>(
        cliBinary,
        [
            "(async()=>{",
            "const services=app.plugins.plugins['obsidian-livesync'].core.services;",
            "const current=await services.replicator.acquireActiveReplicatorContext();",
            "globalThis.__tweakCompatibilitySettings=JSON.stringify(services.setting.currentSettings());",
            "return JSON.stringify(current!==globalThis.__tweakCompatibilityPublication);",
            "})()",
        ].join(""),
        session.cliEnv
    );
    assertEqual(publicationChanged, true, "Changing the remote did not replace the active publication.");
    const originalBefore = await remoteDocumentSnapshot(couchDb, originalDbName);
    const replacementBefore = await remoteDocumentSnapshot(couchDb, replacementDbName);
    await selectCompatibilityAction(session.remoteDebuggingPort, applySettingsWithFetchAction);
    const result = await replicationPromise;
    assertEqual(result.succeeded, false, "The stale remote choice incorrectly completed the original replication.");
    const settingsUnchanged = await evalObsidianJson<boolean>(
        cliBinary,
        [
            "(()=>{",
            "const settings=app.plugins.plugins['obsidian-livesync'].core.services.setting.currentSettings();",
            "const unchanged=JSON.stringify(settings)===globalThis.__tweakCompatibilitySettings;",
            "delete globalThis.__tweakCompatibilitySettings;delete globalThis.__tweakCompatibilityPublication;",
            "return JSON.stringify(unchanged);",
            "})()",
        ].join(""),
        session.cliEnv
    );
    assertEqual(settingsUnchanged, true, "The stale choice adopted settings from the previous remote.");
    assertEqual(
        (await remoteDocumentSnapshot(couchDb, originalDbName)) === originalBefore,
        true,
        "The stale choice changed documents in the previous remote."
    );
    assertEqual(
        (await remoteDocumentSnapshot(couchDb, replacementDbName)) === replacementBefore,
        true,
        "The stale choice changed documents in the replacement remote."
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "tweak-compatibility");
    const replacementDbName = makeUniqueDatabaseName(couchDb.dbPrefix, "tweak-replacement");
    const settings = couchDbSettings(couchDb, dbName);
    const sourceVault = await createTemporaryVault();
    const targetVault = await createTemporaryVault();
    const controlVault = await createTemporaryVault();
    let sourceSession: ObsidianLiveSyncSession | undefined;
    let targetSession: ObsidianLiveSyncSession | undefined;
    let controlSession: ObsidianLiveSyncSession | undefined;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        await createCouchDbDatabase(couchDb, replacementDbName);
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        sourceSession = await prepareConfiguredSession(binary, cli.binary, sourceVault, settings, {
            customChunkSize: 0,
            usePluginSyncV2: false,
            handleFilenameCaseSensitive: false,
            autoAcceptCompatibleTweak: false,
        });
        await prepareRemote(cli.binary, sourceSession.cliEnv);
        await writeNote(cli.binary, sourceSession.cliEnv, sourceNotePath, sourceNoteContent);
        const sourceEntry = await waitForLocalDatabaseEntry(cli.binary, sourceSession.cliEnv, sourceNotePath);
        const sourceReplication = await replicateOnce(cli.binary, sourceSession.cliEnv);
        assertEqual(sourceReplication.succeeded, true, "The source Vault could not seed the CouchDB remote.");
        await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(sourceEntry.id) && sourceEntry.children.every((child) => ids.has(child));
        });
        await sourceSession.app.stop();
        sourceSession = undefined;

        await removeLegacyCasePreference(couchDb, dbName);

        targetSession = await prepareConfiguredSession(binary, cli.binary, targetVault, settings, {
            customChunkSize: 60,
            usePluginSyncV2: true,
            handleFilenameCaseSensitive: false,
            autoAcceptCompatibleTweak: false,
        });
        await prepareRemote(cli.binary, targetSession.cliEnv);
        const targetReplicationPromise = replicateOnce(cli.binary, targetSession.cliEnv);
        await selectCompatibilityAction(targetSession.remoteDebuggingPort, applySettingsAction);
        const targetReplication = await targetReplicationPromise;
        assertEqual(
            targetReplication.succeeded,
            false,
            "The original failed attempt was incorrectly reported as completed after setting adoption."
        );
        const afterAdoption = await replicateOnce(cli.binary, targetSession.cliEnv);
        assertEqual(afterAdoption.succeeded, true, "A fresh synchronisation after ordinary setting adoption failed.");
        await waitForPathContent(targetVault.path, sourceNotePath, sourceNoteContent);

        await targetSession.app.stop();
        targetSession = await startSession(binary, cli.binary, targetVault);
        await waitForLiveSyncCoreReady(cli.binary, targetSession.cliEnv);
        await assertE2eCompatibilityMarker(cli.binary, targetSession.cliEnv);
        const restartedState = await readTweakState(cli.binary, targetSession.cliEnv);
        assertEqual(
            restartedState.customChunkSize,
            0,
            "The applied remote custom chunk size was not retained after restart."
        );
        assertEqual(
            restartedState.usePluginSyncV2,
            false,
            "The applied remote V2 setting was not retained after restart."
        );
        assertEqual(
            restartedState.handleFilenameCaseSensitive,
            false,
            "The effective false filename-case setting was not retained after restart."
        );
        await writeNote(cli.binary, targetSession.cliEnv, restartedNotePath, restartedNoteContent);
        const restartedEntry = await waitForLocalDatabaseEntry(cli.binary, targetSession.cliEnv, restartedNotePath);
        const restartedReplication = await replicateOnce(cli.binary, targetSession.cliEnv);
        assertEqual(restartedReplication.succeeded, true, "Synchronisation did not remain compatible after restart.");
        await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(restartedEntry.id) && restartedEntry.children.every((child) => ids.has(child));
        });
        await targetSession.app.stop();
        targetSession = undefined;

        controlSession = await prepareConfiguredSession(binary, cli.binary, controlVault, settings, {
            customChunkSize: 0,
            usePluginSyncV2: false,
            handleFilenameCaseSensitive: true,
            autoAcceptCompatibleTweak: false,
        });
        await prepareRemote(cli.binary, controlSession.cliEnv);
        const controlReplicationPromise = replicateOnce(cli.binary, controlSession.cliEnv);
        await selectCompatibilityAction(
            controlSession.remoteDebuggingPort,
            dismissAction,
            applySettingsAction,
            applySettingsWithFetchAction
        );
        const controlReplication = await controlReplicationPromise;
        assertEqual(
            controlReplication.succeeded,
            false,
            "The control mismatch unexpectedly synchronised without a Fetch."
        );
        await removeLegacyCasePreference(couchDb, dbName);
        const legacyControlPromise = replicateOnce(cli.binary, controlSession.cliEnv);
        await selectCompatibilityAction(
            controlSession.remoteDebuggingPort,
            dismissAction,
            applySettingsAction,
            applySettingsWithFetchAction
        );
        const legacyControl = await legacyControlPromise;
        assertEqual(legacyControl.succeeded, false, "The true/missing mismatch unexpectedly synchronised.");
        const rejectedState = await readTweakState(cli.binary, controlSession.cliEnv);
        assertEqual(
            rejectedState.handleFilenameCaseSensitive,
            true,
            "Dismissing the mismatch changed the case setting."
        );
        const fileReflected = await evalObsidianJson<boolean>(
            cli.binary,
            `(async()=>JSON.stringify(await app.vault.adapter.exists(${JSON.stringify(sourceNotePath)})))()`,
            controlSession.cliEnv
        );
        assertEqual(fileReflected, false, "The rejected mismatch reflected a remote file.");
        const fetchPromise = replicateOnce(cli.binary, controlSession.cliEnv);
        await selectCompatibilityAction(controlSession.remoteDebuggingPort, applySettingsWithFetchAction);
        // Fetch can replace the active publication, so the original rejected attempt
        // need not retry. A separate attempt must use the rebuilt local database.
        await fetchPromise;
        await waitForLiveSyncCoreReady(cli.binary, controlSession.cliEnv);
        await waitForPathContent(controlVault.path, sourceNotePath, sourceNoteContent);
        const fetchedState = await readTweakState(cli.binary, controlSession.cliEnv);
        assertEqual(fetchedState.handleFilenameCaseSensitive, false, "Fetch did not adopt the remote case setting.");
        const afterFetch = await replicateOnce(cli.binary, controlSession.cliEnv);
        assertEqual(afterFetch.succeeded, true, "A fresh attempt after Fetch did not synchronise.");
        console.log("Ordinary apply, restart continuity, true/false rejection, and true/missing Fetch passed.");
        await verifyStaleTargetChoice(cli.binary, controlSession, couchDb, dbName, replacementDbName);
        await waitForPathContent(controlVault.path, sourceNotePath, sourceNoteContent);
        await controlSession.app.stop();
        controlSession = undefined;

        console.log("Tweak compatibility also rejected a stale Fetch choice after the remote changed.");
    } finally {
        if (sourceSession) await sourceSession.app.stop().catch(() => undefined);
        if (targetSession) await targetSession.app.stop().catch(() => undefined);
        if (controlSession) await controlSession.app.stop().catch(() => undefined);
        await Promise.all([sourceVault.dispose(), targetVault.dispose(), controlVault.dispose()]);
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            for (const database of [dbName, replacementDbName]) {
                await deleteCouchDbDatabase(couchDb, database).catch((error: unknown) => {
                    console.warn(error instanceof Error ? error.message : error);
                });
            }
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
