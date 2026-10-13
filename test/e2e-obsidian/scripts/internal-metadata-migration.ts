import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DoctorRegulation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import {
    FlagFilesHumanReadable,
    FlagFilesOriginal,
} from "@vrtmrz/livesync-commonlib/compat/common/models/redflag.const";
import { VERSIONING_DOCID, type LoadedEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { readContent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { ENCRYPTED_INTERNAL_METADATA_FEATURE } from "@vrtmrz/livesync-commonlib/replication";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { openLiveSyncSettings, waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const useDoctor = process.argv.includes("--doctor");
const doctorTitle = "Self-hosted LiveSync Config Doctor";
const enableWithoutRebuild = "Enable without rebuilding — update every other device first";
const hiddenPaths = [".metadata-migration/retained.json", ".metadata-migration/rewritten.json"];
const customPaths = [".obsidian/snippets/retained-metadata.css", ".obsidian/snippets/rewritten-metadata.css"];
const paths = [...hiddenPaths, ...customPaths];
const initialContent = "/* Metadata migration fixture */\n";
const updatedContent = "/* Updated after enabling internal Metadata encryption */\n";
const optionSettings = {
    encrypt: true,
    passphrase: "internal-metadata-migration-secret",
    usePathObfuscation: true,
    encryptInternalMetadata: false,
    syncInternalFiles: true,
    syncInternalFilesBeforeReplication: false,
    watchInternalFileChanges: false,
    syncInternalFilesTargetPatterns: "^\\.metadata-migration(?:/|$)",
    usePluginSync: true,
    usePluginSyncV2: true,
    autoSweepPlugins: false,
    autoSweepPluginsPeriodic: false,
    autoAcceptCompatibleTweak: false,
};

type Entry = { id: string; path: string };

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = discoverObsidianCli().binary;
    if (!cliBinary) throw new Error("The Obsidian CLI is unavailable.");
    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "internal-metadata-migration");
    const connection = { ...couchDb, dbName };
    const source = await createTemporaryVault();
    const target = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;

    const evaluate = async <T>(body: string): Promise<T> => {
        if (!session) throw new Error("No active Obsidian session.");
        return await evalObsidianJson<T>(
            cliBinary,
            `(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;${body}})()`,
            session.cliEnv
        );
    };
    const start = async (vault: TemporaryVault, device: string) => {
        const settings = {
            ...optionSettings,
            deviceAndVaultName: device,
            doctorProcessedVersion: DoctorRegulation.version,
        };
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            pluginData: createE2eCouchDbPluginData(connection, settings),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await configureCouchDb(cliBinary, session.cliEnv, connection, settings);
        await evaluate(`core.services.setting.setDeviceAndVaultName(${JSON.stringify(device)});
            await core.services.setting.saveSettingData(); return JSON.stringify(true);`);
        await prepareRemote(cliBinary, session.cliEnv);
    };
    const store = async (customisations: string[]) => {
        return await evaluate<Entry[]>(`
            await core.getAddOn('HiddenFileSync').scanAllStorageChanges(true);
            const config=core.getAddOn('ConfigSync');
            for(const path of ${JSON.stringify(customisations)}){
                await config.storeCustomizationFiles(path,core.services.setting.getDeviceAndVaultName());
            }
            const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;
            const entries=${JSON.stringify(paths)}.map(path=>rows.map(row=>row.doc).find(doc=>
                doc?.path==='i:'+path || doc?.path?.startsWith('ix:migration-source/') && doc.path.endsWith('%'+path.split('/').pop())));
            if(entries.some(entry=>!entry)) throw new Error('Missing internal Metadata fixtures: '+JSON.stringify({entries,paths:rows.map(row=>row.doc?.path).filter(Boolean)}));
            return JSON.stringify(entries.map(doc=>({id:doc._id,path:doc.path})));`);
    };
    const preferCurrentSettings = async () => {
        await evaluate(`await core.services.replicator.getActiveReplicator()
            .setPreferredRemoteTweakSettings(core.services.setting.currentSettings()); return JSON.stringify(true);`);
    };
    const applyAndCheckFiles = async () => {
        await evaluate(`
            await core.getAddOn('HiddenFileSync').scanAllDatabaseChanges(true);
            const config=core.getAddOn('ConfigSync');
            const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;
            for(const path of ${JSON.stringify(customPaths)}){
                const entry=rows.map(row=>row.doc).find(doc=>doc?.path?.startsWith('ix:migration-source/') && doc.path.endsWith('%'+path.split('/').pop()));
                if(!entry) throw new Error('Missing Customisation Sync Metadata');
                const display=config.createPluginDataFromV2(entry.path);
                await display.setFile(await config.createPluginDataExFileV2(entry.path));
                if(!(await config.applyDataV2(display))) throw new Error('Could not apply Customisation Sync data');
            }
            return JSON.stringify(true);`);
        for (const path of paths) {
            assertEqual(
                await readFile(join(target.path, path), "utf8"),
                path.includes("rewritten") ? updatedContent : initialContent,
                `Unexpected restored content: ${path}`
            );
        }
    };
    const assertDeclaration = async () => {
        const version = await fetchCouchDbDocument(couchDb, dbName, VERSIONING_DOCID);
        assertEqual(version.version, 13, "The feature generation was not retained.");
        assertEqual(
            (version.used_features as string[]).includes(ENCRYPTED_INTERNAL_METADATA_FEATURE),
            true,
            "The encrypted internal Metadata declaration was not retained."
        );
    };
    const enableWithDoctor = async () => {
        const previousVersion = "1.0.0";
        const sentinelId = "_local/e2e-config-doctor";
        await evaluate(`await core.services.setting.applyPartial({doctorProcessedVersion:${JSON.stringify(previousVersion)}},true);
            await core.localDatabase.localDatabase.put({_id:${JSON.stringify(sentinelId)},value:'preserved'});
            return JSON.stringify(true);`);
        const restart = async () => {
            await session!.app.stop();
            session = undefined;
            // Retain the same data.json, profile, and local database on natural start-up.
            session = await startObsidianLiveSyncSession({ binary, cliBinary, vault: source });
            return await evaluate<number>("return JSON.stringify(performance.timeOrigin);");
        };
        const choose = async (title: string, choice: string) => {
            await withObsidianPage(session!.remoteDebuggingPort, async (page) => {
                const dialog = await waitForVisibleObsidianDialogue(page, title);
                await dialog.getByRole("button", { name: choice, exact: true }).click();
                await dialog.waitFor({ state: "hidden" });
            });
        };
        const assertState = async (enabled: boolean, version: string, timeOrigin: number) => {
            await waitForLiveSyncCoreReady(cliBinary, session!.cliEnv);
            const expected = JSON.stringify([enabled, version]);
            const active = await evaluate<[boolean, string]>(
                "return JSON.stringify([core.settings.encryptInternalMetadata,core.settings.doctorProcessedVersion]);"
            );
            assertEqual(JSON.stringify(active), expected, "Doctor left unexpected active settings.");
            const settingsPath = join(session!.install.pluginDir, "data.json");
            let saved: { encryptInternalMetadata?: boolean; doctorProcessedVersion?: string } = {};
            const saveDeadline = Date.now() + 10_000;
            do {
                saved = JSON.parse(await readFile(settingsPath, "utf8"));
                if (JSON.stringify([saved.encryptInternalMetadata, saved.doctorProcessedVersion]) === expected) break;
                await new Promise((resolve) => setTimeout(resolve, 100));
            } while (Date.now() < saveDeadline);
            assertEqual(
                JSON.stringify([saved.encryptInternalMetadata, saved.doctorProcessedVersion]),
                expected,
                "Doctor did not preserve the expected settings on disk."
            );
            assertEqual(
                await evaluate(
                    `return JSON.stringify((await core.localDatabase.localDatabase.get(${JSON.stringify(sentinelId)})).value);`
                ),
                "preserved",
                "Doctor replaced the local database."
            );
            assertEqual(
                await evaluate("return JSON.stringify(performance.timeOrigin);"),
                timeOrigin,
                "Doctor unexpectedly restarted Obsidian."
            );
            const flags: string[] = [...Object.values(FlagFilesOriginal), ...Object.values(FlagFilesHumanReadable)];
            assertEqual(
                (await readdir(source.path)).some((name) => flags.includes(name)),
                false,
                "Doctor scheduled a Rebuild, Fetch, or suspended start-up."
            );
            await withObsidianPage(session!.remoteDebuggingPort, async (page) => {
                for (const candidate of page.context().pages()) {
                    assertEqual(
                        await candidate.locator(".modal-container:visible").count(),
                        0,
                        "Doctor left an unexpected dialogue open."
                    );
                }
            });
        };

        let timeOrigin = await restart();
        await choose(doctorTitle, "No");
        await assertState(false, previousVersion, timeOrigin);
        console.log("Declining Doctor leaves encryption OFF and permits another consultation after restart.");

        timeOrigin = await restart();
        await choose(doctorTitle, "Yes");
        await choose("Fix issue 1/1", "Leave it as is");
        await choose("Almost done!", "Yes");
        await assertState(false, previousVersion, timeOrigin);
        console.log("Skipping the Metadata recommendation and requesting a reminder preserves the previous marker.");

        timeOrigin = await restart();
        await choose(doctorTitle, "No, and do not ask again until the next release");
        await assertState(false, DoctorRegulation.version, timeOrigin);
        timeOrigin = await restart();
        await assertState(false, DoctorRegulation.version, timeOrigin);
        console.log(
            "Dismissing this Doctor version keeps encryption OFF and suppresses the next start-up consultation."
        );

        await withObsidianPage(session!.remoteDebuggingPort, async (page) => {
            const navigator = await openLiveSyncSettings(page);
            const hatch = await navigator.openPage("Hatch");
            await hatch.getByRole("button", { name: "Run Doctor", exact: true }).click();
        });
        await choose(doctorTitle, "Yes");
        await withObsidianPage(session!.remoteDebuggingPort, async (page) => {
            const dialog = await waitForVisibleObsidianDialogue(page, "Fix issue 1/1");
            for (const text of [
                "Encrypt internal file Properties",
                "manually rebuild the remote database",
                "update every synchronising client before enabling it",
            ]) {
                await dialog.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
            }
        });
        assertEqual(
            await evaluate("return JSON.stringify(core.settings.encryptInternalMetadata);"),
            false,
            "Doctor enabled encryption before acceptance."
        );
        await choose("Fix issue 1/1", enableWithoutRebuild);
        await assertState(true, DoctorRegulation.version, timeOrigin);
        timeOrigin = await restart();
        await assertState(true, DoctorRegulation.version, timeOrigin);
        console.log("Manual Doctor acceptance persists across restart without automatic Rebuild, Fetch, or restart.");
    };

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        for (const path of paths) {
            await mkdir(dirname(join(source.path, path)), { recursive: true });
            await writeFile(join(source.path, path), initialContent);
        }
        await start(source, "migration-source");
        const entries = await store(customPaths);
        await pushLocalChanges(cliBinary, session!.cliEnv);
        const originals = await Promise.all(entries.map((entry) => fetchCouchDbDocument(couchDb, dbName, entry.id)));
        for (let index = 0; index < entries.length; index++) {
            assertEqual(originals[index].path, entries[index].path, "OFF unexpectedly encrypted internal Metadata.");
        }
        assertEqual(
            (await fetchCouchDbDocument(couchDb, dbName, VERSIONING_DOCID)).version,
            12,
            "The original database was not generation 12."
        );

        if (useDoctor) {
            await enableWithDoctor();
        } else {
            await withObsidianPage(session!.remoteDebuggingPort, async (page) => {
                const navigator = await openLiveSyncSettings(page);
                const remotePage = await navigator.openPage("Remote Configuration");
                await remotePage
                    .locator(".setting-item")
                    .filter({
                        has: navigator.page.getByText("Configure E2EE", { exact: true }),
                    })
                    .getByRole("button", { name: "Configure", exact: true })
                    .click();
                const dialog = await waitForVisibleObsidianDialogue(navigator.page, "End-to-End Encryption");
                await dialog.getByLabel("Encrypt internal file Properties", { exact: true }).check();
                await dialog.getByRole("button", { name: "Proceed", exact: true }).click();
                const warning = await waitForVisibleObsidianDialogue(
                    navigator.page,
                    "Encrypt internal file Properties"
                );
                await warning
                    .getByRole("button", {
                        name: enableWithoutRebuild,
                        exact: true,
                    })
                    .click();
            });
        }
        assertEqual(
            await evaluate(`app.setting.close(); return JSON.stringify(core.settings.encryptInternalMetadata);`),
            true,
            "The dialogue did not enable encryption."
        );
        for (let index = 0; index < entries.length; index++) {
            assertEqual(
                (await fetchCouchDbDocument(couchDb, dbName, entries[index].id))._rev,
                originals[index]._rev,
                "Enabling without rebuilding rewrote an existing document."
            );
        }
        await preferCurrentSettings();
        for (const path of [hiddenPaths[1], customPaths[1]]) await writeFile(join(source.path, path), updatedContent);
        const rewritten = await store([customPaths[1]]);
        assertEqual(
            JSON.stringify(rewritten),
            JSON.stringify(entries),
            "Enabling encryption changed document IDs or paths."
        );
        await pushLocalChanges(cliBinary, session!.cliEnv);
        for (let index = 0; index < entries.length; index++) {
            const raw = await fetchCouchDbDocument(couchDb, dbName, entries[index].id);
            if (index % 2 === 0) {
                assertEqual(raw._rev, originals[index]._rev, "An untouched document was rewritten.");
                assertEqual(raw.path, entries[index].path, "An untouched document lost its plaintext Metadata.");
            } else {
                assertEqual(raw.path?.startsWith("/\\:"), true, "Updated Metadata was not encrypted.");
                assertEqual(
                    JSON.stringify([raw.ctime, raw.mtime, raw.size, raw.children]),
                    "[0,0,0,[]]",
                    "Updated Metadata exposed file properties."
                );
            }
        }
        await assertDeclaration();
        console.log(
            `${useDoctor ? "Doctor" : "The settings UI"} enabled encryption without Rebuild; unchanged and encrypted Metadata coexist with stable IDs.`
        );
        await session!.app.stop();
        session = undefined;

        await start(target, "migration-target");
        const rejected = evaluate<boolean>(`return JSON.stringify(await core.services.replication.replicate(true));`);
        await withObsidianPage(session!.remoteDebuggingPort, async (page) => {
            const dialog = await waitForVisibleObsidianDialogue(page, "Configuration Mismatch Detected");
            await dialog
                .getByText("Encrypt internal file Properties", { exact: false })
                .first()
                .waitFor({ state: "visible" });
            await dialog.getByRole("button", { name: "Dismiss", exact: true }).click();
        });
        assertEqual(await rejected, false, "Mismatched settings admitted replication.");
        assertEqual(
            await evaluate(`const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;
            return JSON.stringify(rows.some(row=>${JSON.stringify(entries.map((entry) => entry.id))}.includes(row.id)));`),
            false,
            "The mismatched device received internal Metadata."
        );
        await evaluate(`await core.services.setting.applyPartial({encryptInternalMetadata:true},true);
            return JSON.stringify(true);`);
        await pushLocalChanges(cliBinary, session!.cliEnv);
        await applyAndCheckFiles();
        console.log("A second device rejected the mismatch, then restored both formats after setting alignment.");

        await evaluate(`await core.services.setting.applyPartial({encryptInternalMetadata:false},true);
            return JSON.stringify(true);`);
        await preferCurrentSettings();
        await evaluate(`await core.rebuilder.$fetchLocalDBFast(true);
            await core.services.setting.applyPartial(${JSON.stringify(optionSettings)},true);
            return JSON.stringify(true);`);
        const fetchedEntries = await evaluate<LoadedEntry[]>(`
            const entries=[];
            for(const path of ${JSON.stringify(entries.map((entry) => entry.path))}){
                const entry=await core.localDatabase.getDBEntry(path,undefined,false,true);
                if(!entry || entry.deleted || entry._deleted) throw new Error('Could not read fetched Metadata: '+path);
                const file=path.startsWith('ix:')
                    ? await core.getAddOn('ConfigSync').createPluginDataExFileV2(path,entry) : entry;
                if(!file) throw new Error('Could not decode fetched Customisation Sync content: '+path);
                entries.push(file);
            }
            return JSON.stringify(entries);`);
        for (let index = 0; index < fetchedEntries.length; index++) {
            const expected = index % 2 === 0 ? initialContent : updatedContent;
            const content = readContent(fetchedEntries[index]);
            const text = typeof content === "string" ? content : new TextDecoder().decode(content);
            assertEqual(
                text,
                expected,
                `OFF did not read internal file content after Fast Fetch: ${entries[index].path}`
            );
        }
        await applyAndCheckFiles();
        await assertDeclaration();
        console.log(
            "Fast Fetch and database content reads accept both formats with the option OFF; the remote declaration remains."
        );
    } finally {
        await session?.app.stop();
        await source.dispose();
        await target.dispose();
        await deleteCouchDbDatabase(couchDb, dbName);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
