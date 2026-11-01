import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOG_LEVEL_URGENT } from "octagonal-wheels/common/logger";
import { evalObsidianJson } from "../runner/cli.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

type FixtureLog = {
    message: string;
    level?: number;
    key?: string;
};

type ShutdownObservation = {
    closeCalls: number;
    disposeCalls: number;
    disposeCompleted: boolean;
    fixtureLogs: FixtureLog[];
    events: string[];
};

async function evaluate<T>(cliBinary: string, session: ObsidianLiveSyncSession, body: string): Promise<T> {
    return await evalObsidianJson<T>(
        cliBinary,
        `(async()=>{
            const require=(condition,message)=>{if(!condition)throw new Error(message);};
            const waitFor=async(predicate,message)=>{
                const until=Date.now()+15000;
                while(!predicate()) {
                    if(Date.now()>until)throw new Error(message);
                    await new Promise(resolve=>setTimeout(resolve,20));
                }
            };
            ${body}
        })()`,
        session.cliEnv
    );
}

function createPluginData(dbName: string): Record<string, unknown> {
    return createE2eCouchDbPluginData(
        { uri: "http://127.0.0.1:1", username: "unused", password: "unused", dbName },
        {
            syncInternalFiles: true,
            usePluginSync: true,
            usePluginSyncV2: true,
            deviceAndVaultName: "log-lifecycle-device",
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
}

async function startSession(
    binary: string,
    cliBinary: string,
    vault: TemporaryVault
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary,
        cliBinary,
        vault,
        pluginData: createPluginData(`log-lifecycle-${vault.name}`),
        localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        lifecycle: {
            beforeLaunch: async () => {
                const registryPath = join(vault.userDataPath, "obsidian.json");
                const registry = JSON.parse(await readFile(registryPath, "utf8"));
                registry.updateDisabled = true;
                await writeFile(registryPath, JSON.stringify(registry));
            },
        },
    });
    return session;
}

function createShutdownScript(options: {
    duringMarker: string;
    failureMarker: string;
    reloadMarker: string;
    injectFailure: boolean;
    urgentLevel: number;
}): string {
    const fixtures = JSON.stringify(options);
    return `
        const fixtures=${fixtures};
        const plugin=app.plugins.plugins["obsidian-livesync"];
        const core=plugin?.core;
        require(core,"The LiveSync plug-in did not expose its core");
        const module=core.modules.find(candidate=>candidate.constructor.name==="ModuleLog");
        require(module,"The loaded core did not contain ModuleLog");
        const api=core.services.API;
        const database=core.services.database.localDatabaseDirect;
        require(database,"The loaded core did not expose its local database");

        let releaseCloseGate;
        const closeGate=new Promise(resolve=>{releaseCloseGate=resolve;});
        const state={
            core,
            api,
            module,
            fixtureLogs:[],
            events:[],
            closeStarted:false,
            closeCalls:0,
            disposeCalls:0,
            disposeCompleted:false,
            closeGateReleased:false,
            disableError:"",
        };
        app.__livesyncLogLifecycleState=state;

        const originalAddLog=module.__addLog;
        module.__addLog=function(message,level,key) {
            if(typeof message==="string" && [
                fixtures.duringMarker,
                fixtures.failureMarker,
                fixtures.reloadMarker
            ].some(marker=>marker && message.includes(marker))) {
                state.fixtureLogs.push({message,level,key});
                const marker=[fixtures.duringMarker,fixtures.failureMarker,fixtures.reloadMarker]
                    .find(candidate=>candidate && message.includes(candidate));
                state.events.push("log:"+marker);
            }
            return originalAddLog.apply(this,arguments);
        };

        const resource=module.logResource;
        const originalDispose=resource.dispose;
        resource.dispose=async function() {
            state.disposeCalls++;
            state.events.push("dispose-start");
            try {
                return await originalDispose.apply(this,arguments);
            } finally {
                state.disposeCompleted=true;
                state.events.push("dispose-complete");
            }
        };

        const originalClose=database.close;
        database.close=async function() {
            state.closeCalls++;
            if(state.closeCalls===1) {
                state.closeStarted=true;
                state.events.push("close-start");
                await closeGate;
            }
            const result=await originalClose.apply(this,arguments);
            if(state.closeCalls===1) {
                state.events.push("close-finished");
                if(fixtures.injectFailure) {
                    state.events.push("close-failure-injected");
                    throw new Error(fixtures.failureMarker);
                }
            }
            return result;
        };

        state.restore=()=>{
            module.__addLog=originalAddLog;
            resource.dispose=originalDispose;
            database.close=originalClose;
        };

        const run=async()=>{
            state.disablePromise=app.plugins.disablePlugin("obsidian-livesync");
            state.disablePromise.catch(error=>{state.disableError=String(error);});
            await waitFor(()=>state.closeStarted,"The real local database close did not start");
            require(state.disposeCalls===0 && !state.disposeCompleted,
                "The log resource was released before database shutdown completed");
            api.addLog(fixtures.duringMarker,undefined,"e2e-log-lifecycle-during-close");
            await waitFor(
                ()=>state.fixtureLogs.some(entry=>entry.message.includes(fixtures.duringMarker)),
                "ModuleLog did not receive the during-close log"
            );
            require(state.disposeCalls===0,"The log resource was released while database close was gated");
            releaseCloseGate();
            state.closeGateReleased=true;
            await waitFor(()=>state.disposeCompleted,"The log resource was not released after database close");

            require(state.closeCalls===1,"The local database close was not observed exactly once");
            require(state.disposeCalls===1,"The log resource was not disposed exactly once");
            require(state.events.indexOf("close-finished")>=0 &&
                state.events.indexOf("close-finished")<state.events.indexOf("dispose-start"),
                "The log resource was disposed before the local database close completed");

            const failedLog=fixtures.failureMarker
                ? state.fixtureLogs.find(entry=>entry.message.includes(fixtures.failureMarker))
                : undefined;
            if(fixtures.injectFailure) {
                require(failedLog,"The injected post-close failure was not logged");
                require(failedLog.key==="shutdown","The shutdown failure log used the wrong key");
                require(failedLog.level===fixtures.urgentLevel,"The shutdown failure log was not urgent");
                require(
                    state.events.indexOf("close-finished")<state.events.indexOf("log:"+fixtures.failureMarker) &&
                    state.events.indexOf("log:"+fixtures.failureMarker)<state.events.indexOf("dispose-start"),
                    "The shutdown failure was not logged between database close and log resource disposal"
                );
            } else {
                require(!failedLog,"The normal shutdown unexpectedly reported the injected failure");
            }

            let detached=false;
            try {
                api.addLog("e2e-log-lifecycle-after-disposal");
            } catch(error) {
                detached=String(error).includes("not assigned");
            }
            require(detached,"The old API log handler remained assigned after disposal");
            await state.disablePromise;
            require(!state.disableError,"Disabling the plug-in failed: "+state.disableError);
            return JSON.stringify({
                closeCalls:state.closeCalls,
                disposeCalls:state.disposeCalls,
                disposeCompleted:state.disposeCompleted,
                fixtureLogs:state.fixtureLogs,
                events:state.events
            });
        };

        try {
            return await run();
        } finally {
            releaseCloseGate();
            if(state.closeStarted && !state.disposeCompleted) {
                try {
                    await waitFor(()=>state.disposeCompleted,"Cleanup timed out waiting for log resource disposal");
                } catch {}
            }
        }
    `;
}

async function runCase(options: {
    binary: string;
    cliBinary: string;
    caseName: string;
    injectFailure: boolean;
}): Promise<Record<string, unknown>> {
    const vault = await createTemporaryVault(`obsidian-log-lifecycle-${options.caseName}-`);
    let session: ObsidianLiveSyncSession | undefined;
    const markers = {
        duringMarker: `log-lifecycle-${options.caseName}-during-${randomUUID()}`,
        failureMarker: options.injectFailure
            ? `log-lifecycle-${options.caseName}-injected-close-failure-${randomUUID()}`
            : "",
        reloadMarker: options.injectFailure ? "" : `log-lifecycle-${options.caseName}-reload-${randomUUID()}`,
        injectFailure: options.injectFailure,
        urgentLevel: LOG_LEVEL_URGENT,
    };

    try {
        session = await startSession(options.binary, options.cliBinary, vault);
        await waitForLiveSyncCoreReady(options.cliBinary, session.cliEnv);
        const shutdown = await evaluate<ShutdownObservation>(options.cliBinary, session, createShutdownScript(markers));
        if (options.injectFailure) {
            return { caseName: options.caseName, shutdown };
        }

        await evaluate(
            options.cliBinary,
            session,
            `await app.plugins.enablePlugin("obsidian-livesync"); return JSON.stringify({enabled:true});`
        );
        await waitForLiveSyncCoreReady(options.cliBinary, session.cliEnv);
        const reload = await evaluate<Record<string, unknown>>(
            options.cliBinary,
            session,
            `
                const state=app.__livesyncLogLifecycleState;
                require(state,"The old core observation was not retained across plug-in reload");
                const plugin=app.plugins.plugins["obsidian-livesync"];
                const core=plugin?.core;
                require(core && core!==state.core,"Enabling the plug-in did not create a new core");
                const module=core.modules.find(candidate=>candidate.constructor.name==="ModuleLog");
                require(module,"The reloaded core did not contain ModuleLog");
                const originalAddLog=module.__addLog;
                const observed=[];
                module.__addLog=function(message,level,key) {
                    if(typeof message==="string" && message.includes(${JSON.stringify(markers.reloadMarker)})) {
                        observed.push({message,level,key});
                    }
                    return originalAddLog.apply(this,arguments);
                };
                try {
                    core.services.API.addLog(${JSON.stringify(markers.reloadMarker)},undefined,"e2e-log-lifecycle-reload");
                    await waitFor(()=>observed.length>0,"The reloaded ModuleLog did not receive its API log");
                    require(observed.length===1,"The reloaded ModuleLog received the fixture log more than once");
                    require(
                        !state.fixtureLogs.some(entry=>entry.message.includes(${JSON.stringify(markers.reloadMarker)})),
                        "The old ModuleLog observer received the reloaded core's fixture log"
                    );
                    let oldHandlerDetached=false;
                    try {
                        state.api.addLog("e2e-log-lifecycle-reloaded-old-api");
                    } catch(error) {
                        oldHandlerDetached=String(error).includes("not assigned");
                    }
                    require(oldHandlerDetached,"The old API log handler was reassigned after reload");
                    return JSON.stringify({
                        coreChanged:core!==state.core,
                        observedByNewModule:observed.length,
                        observedByOldModule:state.fixtureLogs.filter(
                            entry=>entry.message.includes(${JSON.stringify(markers.reloadMarker)})
                        ).length
                    });
                } finally {
                    module.__addLog=originalAddLog;
                    state.restore();
                    delete app.__livesyncLogLifecycleState;
                }
            `
        );
        return { caseName: options.caseName, shutdown, reload };
    } finally {
        if (session) {
            try {
                await evaluate(
                    options.cliBinary,
                    session,
                    `
                        const state=app.__livesyncLogLifecycleState;
                        state?.restore?.();
                        delete app.__livesyncLogLifecycleState;
                        return JSON.stringify({cleaned:true});
                    `
                );
            } catch {}
            try {
                await session.app.stop();
            } finally {
                await vault.dispose();
            }
        } else {
            await vault.dispose();
        }
    }
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const bundleHash = createHash("sha256")
        .update(new Uint8Array(await readFile("main.js")))
        .digest("hex");

    const observations = [
        await runCase({ binary, cliBinary, caseName: "normal", injectFailure: false }),
        await runCase({ binary, cliBinary, caseName: "controlled-failure", injectFailure: true }),
    ];
    console.log(JSON.stringify({ ok: true, bundleHash, observations }, null, 2));
}

await main();
