import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { openLiveSyncSettings, waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const coreExpression = "app.plugins.plugins['obsidian-livesync'].core";
const firstKey = "synthetic-sync-configuration-key-a";
const secondKey = "synthetic-sync-configuration-key-b";
const dataPassphrase = "synthetic-note-encryption-passphrase";
const idKey = "cd".repeat(32);
const sourcePath = "E2E/configuration-source.md";
const replyPath = "E2E/configuration-reply.md";
const sourceContent = "# Configuration key rotation\n日本語とEnglishの内容を保持します。\n".repeat(200);
const replyContent = "# Configuration key recovery reply\n復旧した端末から送信します。\n".repeat(200);
const diagnosticsDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

async function applyKey(session: ObsidianLiveSyncSession, key: string, changeMode: boolean): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const navigator = await openLiveSyncSettings(page);
        const root = await navigator.openPage("Power users");
        if (changeMode) {
            await root
                .locator(".setting-item")
                .filter({ hasText: "Encrypting sensitive configuration items" })
                .getByRole("combobox")
                .selectOption("LOCALSTORAGE");
        }
        await root.locator('input[type="password"]:visible').fill(key);
        await root.getByRole("button", { name: "Apply", exact: true }).click();
        await page.waitForFunction(`(()=>{
            const core=${coreExpression};
            const tab=core.modules.find(module=>module.settingTab)?.settingTab;
            return tab && !tab.isDirty('configPassphrase') && !tab.isDirty('configPassphraseStore') &&
                core.settings.configPassphraseStore==='LOCALSTORAGE' &&
                localStorage.getItem('ls-setting-passphrase')===${JSON.stringify(key)};
        })()`);
        await navigator.close();
    });
}

async function assertConnection(
    cli: string,
    session: ObsidianLiveSyncSession,
    expected: Record<string, unknown>
): Promise<void> {
    const settings = await evalObsidianJson(
        cli,
        `(()=>{
        const s=${coreExpression}.services.setting.currentSettings();
        return JSON.stringify({uri:s.couchDB_URI,user:s.couchDB_USER,password:s.couchDB_PASSWORD,
            database:s.couchDB_DBNAME,encrypt:s.encrypt,passphrase:s.passphrase,idKey:s.idDerivationKey,
            store:s.configPassphraseStore,key:localStorage.getItem('ls-setting-passphrase')});
    })()`,
        session.cliEnv
    );
    assert.deepEqual(settings, expected);
}

async function createNote(cli: string, session: ObsidianLiveSyncSession, path: string, content: string): Promise<void> {
    await evalObsidianJson(
        cli,
        `(async()=>{
        if(!(await app.vault.adapter.exists('E2E'))) await app.vault.createFolder('E2E');
        await app.vault.create(${JSON.stringify(path)},${JSON.stringify(content)});
        return JSON.stringify(true);
    })()`,
        session.cliEnv
    );
    await waitForLocalDatabaseEntry(cli, session.cliEnv, path);
}

async function assertNote(
    cli: string,
    session: ObsidianLiveSyncSession,
    vaultPath: string,
    path: string,
    content: string
): Promise<void> {
    // Return only a boolean through the CLI; compare the complete Vault file below.
    const matches = await evalObsidianJson<boolean>(
        cli,
        `(async()=>{
        const path=${JSON.stringify(path)};
        const expected=${JSON.stringify(content)};
        const deadline=Date.now()+20000;
        while(Date.now()<deadline){
            const actual=await app.vault.adapter.read(path).catch(()=>null);
            if(actual===expected) return JSON.stringify(true);
            await new Promise(resolve=>setTimeout(resolve,250));
        }
        throw new Error('Timed out waiting for the received note');
    })()`,
        session.cliEnv
    );
    assert.equal(matches, true);
    assert.equal(await readFile(join(vaultPath, path), "utf8"), content);
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked: ${cli.checked.join(", ")}`);
    const cliBinary = cli.binary;
    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "configuration-encryption");
    const sourceVault = await createTemporaryVault("obsidian-configuration-sync-source-");
    let receiverVault: Awaited<ReturnType<typeof createTemporaryVault>> | undefined;
    let session: ObsidianLiveSyncSession | undefined;
    let remoteCreated = false;
    let stage = "source-startup";
    const connection = {
        uri: couchDb.uri,
        user: couchDb.username,
        password: couchDb.password,
        database: dbName,
        encrypt: true,
        passphrase: dataPassphrase,
        idKey,
        store: "LOCALSTORAGE",
        key: secondKey,
    };
    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        remoteCreated = true;
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault: sourceVault,
            pluginData: createE2eCouchDbPluginData(
                { ...couchDb, dbName },
                {
                    doctorProcessedVersion: "1.0.35",
                    usePowerUserMode: true,
                    idDerivationVersion: 0,
                }
            ),
            localStorageEntries: createE2eObsidianDeviceLocalState(sourceVault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        stage = "source-configuration";
        await configureCouchDb(
            cliBinary,
            session.cliEnv,
            { ...couchDb, dbName },
            {
                doctorProcessedVersion: "1.0.35",
                usePowerUserMode: true,
                encrypt: true,
                passphrase: dataPassphrase,
                idDerivationVersion: 1,
                idDerivationKey: idKey,
            }
        );
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await prepareRemote(cliBinary, session.cliEnv);
        stage = "source-key-rotation";
        await applyKey(session, firstKey, true);
        await applyKey(session, secondKey, false);
        const dataPath = join(sourceVault.path, ".obsidian/plugins/obsidian-livesync/data.json");
        const encryptedData = await readFile(dataPath, "utf8");
        assert.equal(encryptedData.includes(dataPassphrase), false);
        assert.equal(encryptedData.includes(idKey), false);
        assert.equal(encryptedData.includes(couchDb.password), false);
        const saved = JSON.parse(encryptedData) as Record<string, unknown>;
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: sourceVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await assertConnection(cliBinary, session, connection);
        stage = "source-upload-after-restart";
        await createNote(cliBinary, session, sourcePath, sourceContent);
        await assertNote(cliBinary, session, sourceVault.path, sourcePath, sourceContent);
        const sourceEntry = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, sourcePath);
        await pushLocalChanges(cliBinary, session.cliEnv);
        const docs = await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(sourceEntry.id) && sourceEntry.children.every((id) => ids.has(id));
        });
        assert.ok(sourceEntry.children.length > 0);
        assert.equal(
            docs.some((doc) => typeof doc.data === "string" && doc.data.includes("Configuration key rotation")),
            false
        );
        console.log(
            "Configuration encryption sync: key rotation and restart retained credentials, E2EE, and the ID key; Metadata and encrypted Chunks reached CouchDB."
        );
        await session.app.stop();
        session = undefined;

        stage = "receiver-key-recovery";
        receiverVault = await createTemporaryVault("obsidian-configuration-sync-receiver-");
        const receiverDataPath = join(receiverVault.path, ".obsidian/plugins/obsidian-livesync/data.json");
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault: receiverVault,
            pluginData: saved,
            localStorageEntries: createE2eObsidianDeviceLocalState(receiverVault.name),
            lifecycle: {
                afterPluginLoad: async ({ remoteDebuggingPort, cliEnv }) => {
                    await withObsidianPage(remoteDebuggingPort, async (page) => {
                        const dialogue = await waitForVisibleObsidianDialogue(page, "Configuration passphrase");
                        assert.equal(await dialogue.locator('input[type="password"]').getAttribute("type"), "password");
                        const before = await readFile(receiverDataPath, "utf8");
                        await dialogue.getByRole("button", { name: "Cancel", exact: true }).click();
                        await dialogue.waitFor({ state: "hidden" });
                        const pending = await evalObsidianJson(
                            cliBinary,
                            `(()=>{
                        const core=${coreExpression};
                        return JSON.stringify({databaseReady:core.services.database.isDatabaseReady(),
                            tabRegistered:core.modules.some(module=>!!module.settingTab)});
                    })()`,
                            cliEnv
                        );
                        assert.deepEqual(pending, { databaseReady: false, tabRegistered: false });
                        assert.equal(await readFile(receiverDataPath, "utf8"), before);
                        await evalObsidianJson(
                            cliBinary,
                            `(async()=>{
                        await app.plugins.disablePlugin('obsidian-livesync');
                        await app.plugins.enablePlugin('obsidian-livesync');
                        return JSON.stringify(true);
                    })()`,
                            cliEnv
                        );
                        const retry = await waitForVisibleObsidianDialogue(page, "Configuration passphrase");
                        await retry.locator('input[type="password"]').fill(secondKey);
                        await mkdir(diagnosticsDirectory, { recursive: true });
                        await retry.locator(".modal").screenshot({
                            path: join(diagnosticsDirectory, "configuration-sync-unlock.png"),
                            animations: "disabled",
                            caret: "hide",
                        });
                        await retry.getByRole("button", { name: "OK", exact: true }).click();
                    });
                },
            },
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await assertConnection(cliBinary, session, connection);
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: receiverVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await assertConnection(cliBinary, session, connection);
        await pushLocalChanges(cliBinary, session.cliEnv);
        stage = "receiver-transfer-after-restart";
        await assertNote(cliBinary, session, receiverVault.path, sourcePath, sourceContent);
        await createNote(cliBinary, session, replyPath, replyContent);
        await assertNote(cliBinary, session, receiverVault.path, replyPath, replyContent);
        await pushLocalChanges(cliBinary, session.cliEnv);
        const replyEntry = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, replyPath);
        await waitForCouchDbDocs(couchDb, dbName, (docs) => docs.some((doc) => doc._id === replyEntry.id));
        await session.app.stop();
        session = undefined;

        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: sourceVault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await assertConnection(cliBinary, session, connection);
        await pushLocalChanges(cliBinary, session.cliEnv);
        stage = "source-receive-reply";
        await assertNote(cliBinary, session, sourceVault.path, replyPath, replyContent);
        console.log(
            "Configuration encryption sync: copied settings survived cancellation, key recovery, and restart; both real Obsidian Vaults exchanged exact note bytes through CouchDB."
        );
    } catch (error) {
        await mkdir(diagnosticsDirectory, { recursive: true });
        if (session) {
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                await page.screenshot({
                    path: join(diagnosticsDirectory, "configuration-sync.failure.png"),
                    fullPage: true,
                });
            }).catch(() => undefined);
            const state = await evalObsidianJson(
                cliBinary,
                `(()=>{
                const core=${coreExpression};
                return JSON.stringify({databaseReady:core?.services.database.isDatabaseReady(),
                    appReady:core?.services.appLifecycle.isReady(),
                    mode:core?.settings?.configPassphraseStore});
            })()`,
                session.cliEnv
            ).catch(() => ({ stateReadFailed: true }));
            await writeFile(
                join(diagnosticsDirectory, "configuration-sync.failure.json"),
                JSON.stringify({ stage, state }, null, 2) + "\n"
            );
        }
        throw error;
    } finally {
        try {
            if (session) await session.app.stop();
        } finally {
            try {
                await sourceVault.dispose();
                if (receiverVault) await receiverVault.dispose();
            } finally {
                if (remoteCreated) await deleteCouchDbDatabase(couchDb, dbName);
            }
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
