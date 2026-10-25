/** Exercises optional file admission, actual save completion, and replay in a real Obsidian Vault. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { requireObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const vault = await createTemporaryVault("obsidian-optional-save-");
    let session: ObsidianLiveSyncSession | undefined;
    const observations: unknown[] = [];
    const bundleHash = createHash("sha256")
        .update(new Uint8Array(await readFile("main.js")))
        .digest("hex");
    const settings = createE2eCouchDbPluginData(
        // These scenarios use only the local database; every replication trigger is disabled.
        { uri: "http://127.0.0.1:1", username: "unused", password: "unused", dbName: "optional-save-local" },
        {
            syncInternalFiles: true,
            usePluginSync: true,
            usePluginSyncV2: true,
            deviceAndVaultName: "optional-save-device",
            watchInternalFileChanges: true,
            syncInternalFilesTargetPatterns: "^\\.obsidian(?:$|/(?:optional-save|snippets)(?:/|$))",
            syncInternalFilesIgnorePatterns: "",
            autoSweepPlugins: false,
            autoSweepPluginsPeriodic: false,
            syncInternalFilesInterval: 0,
            liveSync: false,
            periodicReplication: false,
            syncOnStart: false,
            syncOnSave: false,
            syncOnFileOpen: false,
            syncOnEditorSave: false,
            syncAfterMerge: false,
            showVerboseLog: true,
        }
    );

    async function start(restart = false): Promise<void> {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cliBinary,
            vault,
            pluginStartup: restart ? "natural" : undefined,
            pluginData: restart ? undefined : settings,
            localStorageEntries: restart ? undefined : createE2eObsidianDeviceLocalState(vault.name),
            lifecycle: {
                beforeLaunch: async () => {
                    const registryPath = join(vault.userDataPath, "obsidian.json");
                    const registry = JSON.parse(await readFile(registryPath, "utf8"));
                    registry.updateDisabled = true;
                    await writeFile(registryPath, JSON.stringify(registry));
                },
            },
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
    }

    async function evaluate<T>(body: string): Promise<T> {
        if (!session) throw new Error("The Obsidian session is not running");
        return await evalObsidianJson<T>(
            cliBinary,
            `(async()=>{
            const core=app.plugins.plugins['obsidian-livesync'].core;
            const manager=core.serviceModules.storageAccess.vaultManager;
            const config=core.getAddOn('ConfigSync');
            const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
            const require=(condition,message)=>{if(!condition)throw new Error(message);};
            const waitFor=async (predicate,message)=>{
                const until=Date.now()+10000;
                while(!(await predicate())) {
                    if(Date.now()>until)throw new Error(message);
                    await sleep(20);
                }
            };
            const pending=async path=>(await manager.adapter.persistence.loadSnapshot()??[])
                .some(event=>event.args?.file?.path===path);
            const entry=async path=>await core.localDatabase.getDBEntry(path,undefined,false,true);
            const contents=doc=>Array.isArray(doc.data)?doc.data.join(''):doc.data;
            const represents=(doc,content)=>doc&& !doc.deleted &&
                (contents(doc).includes(content)||contents(doc).includes(btoa(content)));
            const notify=async path=>{
                await manager._watchVaultRawEvents(path);
                await sleep(30);
            };
            ${body}
        })()`,
            session.cliEnv
        );
    }

    try {
        await start();
        await evaluate(`
            require(core.services.fileProcessing.processOptionalFileEventWithResult?.hasHandlers,
                'Typed optional providers were not registered');
            core.services.setting.setDeviceAndVaultName('optional-save-device');
            await core.services.setting.saveSettingData();
            for(const path of ['.obsidian/optional-save','.obsidian/snippets']) {
                if(!(await app.vault.adapter.exists(path)))await app.vault.adapter.mkdir(path);
            }
            return JSON.stringify({ready:true});
        `);

        for (const mode of ["hidden", "config-v1", "config-v2"]) {
            observations.push(
                await evaluate(`
                const mode=${JSON.stringify(mode)};
                core.settings.usePluginSyncV2=mode!=='config-v1';
                await core.services.setting.saveSettingData();
                require(await core.services.fileProcessing.commitPendingFileEvents(),'Initial flush failed');
                const path=mode==='hidden'?'.obsidian/optional-save/content.json':
                    '.obsidian/snippets/optional-save-'+mode+'.css';
                const databasePath=mode==='hidden'?'i:'+path:mode==='config-v1'?
                    config.filenameToUnifiedKey(path):config.filenameWithUnifiedKey(path);
                const content='optional save '+mode+' initial';
                const original=core.localDatabase.putDBEntry.bind(core.localDatabase);
                let release;
                const gate=new Promise(resolve=>{release=resolve;});
                let started=false;
                core.localDatabase.putDBEntry=async data=>{
                    if(data.path===databasePath){started=true;await gate;}
                    return await original(data);
                };
                try {
                    await app.vault.adapter.write(path,content);
                    await notify(path);
                    await waitFor(()=>started,'The optional database save did not start: '+mode);
                    require(await pending(path),'The in-flight optional save was missing from the snapshot: '+mode);
                    let flushed=false;
                    const flush=core.services.fileProcessing.commitPendingFileEvents().then(result=>{flushed=true;return result;});
                    await sleep(30);
                    require(!flushed,'Flush returned before the actual database save: '+mode);
                    release();
                    require(await flush,'Flush failed after the write was released: '+mode);
                } finally {
                    release();
                    core.localDatabase.putDBEntry=original;
                }
                const first=await entry(databasePath);
                require(represents(first,content),'The completed save did not contain the expected content: '+mode);
                await notify(path);
                require(await core.services.fileProcessing.commitPendingFileEvents(),'Unchanged notification failed: '+mode);
                require((await entry(databasePath))._rev===first._rev,'Unchanged notification added a revision: '+mode);
                const updated=content+' with a later edit';
                await app.vault.adapter.write(path,updated);
                await notify(path);
                require(await core.services.fileProcessing.commitPendingFileEvents(),'Later edit was blocked: '+mode);
                require(represents(await entry(databasePath),updated),'Later edit was not saved: '+mode);
                await app.vault.adapter.remove(path);
                await notify(path);
                require(await core.services.fileProcessing.commitPendingFileEvents(),'Deletion failed: '+mode);
                const deleted=await core.localDatabase.getDBEntryMeta(databasePath,undefined,true);
                require(deleted&&deleted.deleted,'Deletion was not represented: '+mode);
                await notify(path);
                require(await core.services.fileProcessing.commitPendingFileEvents(),'Repeated deletion failed: '+mode);
                require((await core.localDatabase.getDBEntryMeta(databasePath,undefined,true))._rev===deleted._rev,
                    'Repeated deletion added a revision: '+mode);
                return JSON.stringify({mode,saveWaited:true,unchangedPreservedRevision:true,laterEditSaved:true,deletionReplayed:true});
            `)
            );
        }

        const replay = [
            { path: ".obsidian/optional-save/replay.json", content: "hidden save retained across restart" },
            {
                path: ".obsidian/snippets/optional-save-replay.css",
                content: "customisation save retained across restart",
            },
        ];
        observations.push(
            await evaluate(`
            const fixtures=${JSON.stringify(replay)};
            core.settings.usePluginSyncV2=true;
            await core.services.setting.saveSettingData();
            const failures=new Set(fixtures.map(({path})=>path.endsWith('.json')?'i:'+path:config.filenameWithUnifiedKey(path)));
            const original=core.localDatabase.putDBEntry.bind(core.localDatabase);
            let failed=0;
            core.localDatabase.putDBEntry=async data=>{
                if(failures.delete(data.path)){failed++;return false;}
                return await original(data);
            };
            try {
                for(const {path,content} of fixtures) {
                    await app.vault.adapter.write(path,content);
                    await notify(path);
                }
                await waitFor(()=>failed===fixtures.length,'Injected optional failures were not reached');
                require(!(await core.services.fileProcessing.commitPendingFileEvents()),'Failed saves were acknowledged');
                for(const {path} of fixtures)require(await pending(path),'Failed save was lost: '+path);
            } finally {
                core.localDatabase.putDBEntry=original;
            }
            return JSON.stringify({failedSavesRetained:failed});
        `)
        );
        await session!.app.stop();
        session = undefined;
        await start(true);
        observations.push(
            await evaluate(`
            const fixtures=${JSON.stringify(replay)};
            for(const {path,content} of fixtures) {
                const databasePath=path.endsWith('.json')?'i:'+path:config.filenameWithUnifiedKey(path);
                require(represents(await entry(databasePath),content),'Start-up did not recover '+path);
                require(!(await pending(path)),'Recovered save is still pending: '+path);
            }
            return JSON.stringify({replayedBeforeReadiness:fixtures.length,ready:core.services.appLifecycle.isReady()});
        `)
        );
        console.log(JSON.stringify({ ok: true, bundleHash, observations }, null, 2));
    } finally {
        await session?.app.stop();
        await vault.dispose();
    }
}

await main();
