import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOG_LEVEL_URGENT } from "octagonal-wheels/common/logger";
import { withObsidianPage } from "../runner/ui.ts";
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
    consoleLogs: {
        marker: string;
        messageType: string;
        messageText: string;
        level?: number;
        key?: string;
    }[];
    events: string[];
};

async function evaluate<T>(session: ObsidianLiveSyncSession, body: string): Promise<T> {
    // Observe the renderer console directly; CLI eval captures console output
    // as part of its response and changes the logging surface under test.
    return await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const result = await page.evaluate<string>(
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
            })()`
        );
        return JSON.parse(result) as T;
    });
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
    afterMarker: string;
    reloadMarker: string;
    oldReloadMarker: string;
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
            consoleLogs:[],
            uiAddLogCalls:0,
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
        const originalConsoleLog=console.log;
        const consoleMarkers=[
            fixtures.duringMarker,
            fixtures.failureMarker,
            fixtures.afterMarker,
            fixtures.reloadMarker,
            fixtures.oldReloadMarker
        ].filter(Boolean);
        console.log=function(...args) {
            try {
                const entry=args[0];
                if(entry && typeof entry==="object" && "message" in entry) {
                    const message=entry.message;
                    const messageText=typeof message==="string"
                        ? message
                        : message instanceof Error ? message.message
                        : message && typeof message==="object" &&
                            typeof message.__e2eLogLifecycleMarker==="string"
                            ? message.__e2eLogLifecycleMarker
                            : "";
                    const marker=consoleMarkers.find(candidate=>messageText.includes(candidate));
                    if(marker) state.consoleLogs.push({
                        marker,
                        message,
                        level:entry.level,
                        key:entry.key
                    });
                }
            } catch {}
            return originalConsoleLog.apply(this,args);
        };
        module.__addLog=function(message,level,key) {
            state.uiAddLogCalls++;
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
            console.log=originalConsoleLog;
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

            await originalDispose.call(resource);
            require(state.disposeCompleted && state.disposeCalls===1,
                "Repeated log resource disposal was not idempotent");

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

            const afterMessage=new Error(fixtures.afterMarker);
            const afterKey="e2e-log-lifecycle-after-disposal";
            const afterUnknownMessage={__e2eLogLifecycleMarker:fixtures.afterMarker};
            const afterUnknownKey="e2e-log-lifecycle-after-disposal-unknown";
            const uiCallsBeforeAfterLog=state.uiAddLogCalls;
            api.addLog(afterMessage,fixtures.urgentLevel,afterKey);
            api.addLog(afterUnknownMessage,fixtures.urgentLevel,afterUnknownKey);
            await waitFor(
                ()=>state.consoleLogs.some(entry=>entry.marker===fixtures.afterMarker &&
                    entry.message===afterMessage) &&
                    state.consoleLogs.some(entry=>entry.marker===fixtures.afterMarker &&
                        entry.message===afterUnknownMessage),
                "The old API did not forward its post-disposal messages to console.log"
            );
            const afterErrorLogs=state.consoleLogs.filter(entry=>entry.marker===fixtures.afterMarker &&
                entry.message===afterMessage);
            const afterUnknownLogs=state.consoleLogs.filter(entry=>entry.marker===fixtures.afterMarker &&
                entry.message===afterUnknownMessage);
            require(afterErrorLogs.length===1,"The post-disposal Error was not logged exactly once");
            require(afterUnknownLogs.length===1,"The post-disposal unknown message was not logged exactly once");
            require(
                afterErrorLogs[0].message===afterMessage && afterErrorLogs[0].message instanceof Error &&
                    afterErrorLogs[0].message.message===fixtures.afterMarker,
                "The post-disposal Error was not preserved in the console log"
            );
            require(afterUnknownLogs[0].message===afterUnknownMessage,
                "The post-disposal unknown message was not preserved in the console log");
            require(
                afterErrorLogs[0].level===fixtures.urgentLevel && afterErrorLogs[0].key===afterKey &&
                    afterUnknownLogs[0].level===fixtures.urgentLevel &&
                    afterUnknownLogs[0].key===afterUnknownKey,
                "The post-disposal console logs changed their level or key"
            );
            require(state.uiAddLogCalls===uiCallsBeforeAfterLog,
                "The disposed ModuleLog UI handler received a post-disposal log");
            await state.disablePromise;
            require(!state.disableError,"Disabling the plug-in failed: "+state.disableError);
            return JSON.stringify({
                closeCalls:state.closeCalls,
                disposeCalls:state.disposeCalls,
                disposeCompleted:state.disposeCompleted,
                fixtureLogs:state.fixtureLogs,
                consoleLogs:state.consoleLogs.map(entry=>({
                    marker:entry.marker,
                    messageType:entry.message instanceof Error ? "Error" : typeof entry.message,
                    messageText:entry.message instanceof Error
                        ? entry.message.message
                        : typeof entry.message==="string" ? entry.message
                        : entry.message && typeof entry.message==="object" &&
                            typeof entry.message.__e2eLogLifecycleMarker==="string"
                            ? entry.message.__e2eLogLifecycleMarker
                            : "",
                    level:entry.level,
                    key:entry.key
                })),
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
        afterMarker: "log-lifecycle-" + options.caseName + "-after-disposal-" + randomUUID(),
        failureMarker: options.injectFailure
            ? `log-lifecycle-${options.caseName}-injected-close-failure-${randomUUID()}`
            : "",
        reloadMarker: options.injectFailure ? "" : `log-lifecycle-${options.caseName}-reload-${randomUUID()}`,
        oldReloadMarker: options.injectFailure
            ? ""
            : "log-lifecycle-" + options.caseName + "-old-api-after-reload-" + randomUUID(),
        injectFailure: options.injectFailure,
        urgentLevel: LOG_LEVEL_URGENT,
    };

    try {
        session = await startSession(options.binary, options.cliBinary, vault);
        await waitForLiveSyncCoreReady(options.cliBinary, session.cliEnv);
        const shutdown = await evaluate<ShutdownObservation>(session, createShutdownScript(markers));
        if (options.injectFailure) {
            return { caseName: options.caseName, shutdown };
        }

        await evaluate(
            session,
            `await app.plugins.enablePlugin("obsidian-livesync"); return JSON.stringify({enabled:true});`
        );
        await waitForLiveSyncCoreReady(options.cliBinary, session.cliEnv);
        const reload = await evaluate<Record<string, unknown>>(
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
                const oldApiKey="e2e-log-lifecycle-reloaded-old-api";
                module.__addLog=function(message,level,key) {
                    if(key===oldApiKey || (typeof message==="string" && [
                        ${JSON.stringify(markers.reloadMarker)},
                        ${JSON.stringify(markers.oldReloadMarker)}
                    ].some(marker=>marker && message.includes(marker)))) {
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
                    const oldApiMarker=${JSON.stringify(markers.oldReloadMarker)};
                    const oldApiMessage=new Error(oldApiMarker);
                    const uiCallsBeforeOldApi=state.uiAddLogCalls;
                    const newModuleFixtureCallsBeforeOldApi=observed.length;
                    state.api.addLog(oldApiMessage,${JSON.stringify(markers.urgentLevel)},oldApiKey);
                    await waitFor(
                        ()=>state.consoleLogs.some(entry=>entry.marker===oldApiMarker &&
                            entry.message===oldApiMessage),
                        "The old API did not forward its post-reload Error to console.log"
                    );
                    const oldApiLogs=state.consoleLogs.filter(entry=>entry.marker===oldApiMarker);
                    require(oldApiLogs.length===1,"The old API post-reload Error was not logged exactly once");
                    require(
                        oldApiLogs[0].message===oldApiMessage && oldApiLogs[0].message instanceof Error &&
                            oldApiLogs[0].message.message===oldApiMarker,
                        "The old API post-reload Error was not preserved in the console log"
                    );
                    require(
                        oldApiLogs[0].level===${JSON.stringify(markers.urgentLevel)} &&
                            oldApiLogs[0].key===oldApiKey,
                        "The old API post-reload console log changed its level or key"
                    );
                    require(state.uiAddLogCalls===uiCallsBeforeOldApi,
                        "The old ModuleLog UI handler received the old API's post-reload log");
                    require(observed.length===newModuleFixtureCallsBeforeOldApi,
                        "The new ModuleLog received the old API's post-reload log");
                    return JSON.stringify({
                        coreChanged:core!==state.core,
                        observedByNewModule:observed.length,
                        oldApiConsoleLogs:oldApiLogs.length,
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
                    session,
                    `
                        const state=app.__livesyncLogLifecycleState;
                        try {
                            return JSON.stringify({cleaned:true});
                        } finally {
                            state?.restore?.();
                            delete app.__livesyncLogLifecycleState;
                        }
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
