import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
    type CouchDbConfig,
    type CouchDbDocument,
} from "../runner/couchdb.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    assertEqual,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const fixtureContent = "# Synthetic remote fixture\n\nPlaintext body used by the isolated E2EE policy E2E.\n";

type RemoteFixture = {
    fixtureId: string;
    path: string;
    metadataId: string;
    metadataRev: string;
    chunkId: string;
    chunkRev: string;
};

type ReplicationOutcome = {
    succeeded: boolean;
    idle: boolean;
};

type LocalOutcome = {
    metadataPresent: boolean;
    metadataRevision: string | null;
    chunkPresent: boolean;
    decodedPlaintextPresent: boolean;
    vaultFilePresent: boolean;
    vaultContentMatches: boolean;
};

type VaultFileState = {
    present: boolean;
    contentMatches: boolean;
};

type DirectFetchOutcome = {
    reflected: boolean;
    requestedChunkCount: number;
    returnedChunkCount: number;
};

type E2eePolicyUiOutcome = {
    initialEncryptionEnabled: boolean;
    initialAcceptanceChecked: boolean;
    acceptanceRowInAdvanced: boolean;
    acceptanceInitiallyEnabled: boolean;
    acceptanceCheckedAfterClick: boolean;
    acceptanceDisabledWhenEncryptionOff: boolean;
    acceptanceCheckedWhenEncryptionOff: boolean;
    acceptanceEnabledWhenEncryptionOn: boolean;
    acceptanceCheckedWhenEncryptionOn: boolean;
    warningMentionsThirdParty: boolean;
    warningMentionsPassphrase: boolean;
    warningMentionsDatabaseWriteInjection: boolean;
    cancelReturnedFalse: boolean;
    savedAcceptanceUnchanged: boolean;
};

function fixturePath(fixtureId: string): string {
    return `E2E/e2ee-plaintext-policy/${fixtureId}.md`;
}

async function getMetadataId(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<string> {
    return await evalObsidianJson<string>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const path=${JSON.stringify(path)};`,
            "return JSON.stringify(await core.services.path.path2id(path));",
            "})()",
        ].join(""),
        env
    );
}

async function injectPlaintextFixture(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    couchDb: CouchDbConfig,
    dbName: string,
    fixtureId: string
): Promise<RemoteFixture> {
    const path = fixturePath(fixtureId);
    const metadataId = await getMetadataId(cliBinary, env, path);
    const chunkId = `h:e2ee-plaintext-policy-${randomUUID()}`;
    const now = Date.now();
    const metadata: CouchDbDocument = {
        _id: metadataId,
        path,
        type: "plain",
        ctime: now,
        mtime: now,
        size: Buffer.byteLength(fixtureContent, "utf8"),
        children: [chunkId],
        eden: {},
    };
    const leaf: CouchDbDocument = { _id: chunkId, type: "leaf", data: fixtureContent };

    const metadataPut = await putCouchDbDocument(couchDb, dbName, metadata);
    const leafPut = await putCouchDbDocument(couchDb, dbName, leaf);
    const remoteMetadata = await fetchCouchDbDocument(couchDb, dbName, metadataId);
    const remoteLeaf = await fetchCouchDbDocument(couchDb, dbName, chunkId);

    assertEqual(remoteMetadata.path === path, true, "The remote Metadata path did not match the synthetic fixture.");
    assertEqual(remoteMetadata.type === "plain", true, "The remote Metadata type was invalid.");
    assertEqual(
        remoteMetadata.size === Buffer.byteLength(fixtureContent, "utf8"),
        true,
        "The remote Metadata size was invalid."
    );
    assertEqual(
        remoteMetadata.children?.length === 1 && remoteMetadata.children[0] === chunkId,
        true,
        "The remote Metadata did not reference the injected leaf."
    );
    assertEqual(remoteLeaf.type === "leaf", true, "The injected remote document was not a leaf.");
    assertEqual(
        remoteLeaf.data === fixtureContent,
        true,
        "The injected remote leaf did not contain the synthetic fixture body."
    );
    assertEqual(!("e_" in remoteLeaf), true, "The injected remote leaf unexpectedly had the encryption marker.");
    assertEqual(
        remoteMetadata._rev === metadataPut.rev,
        true,
        "The remote Metadata revision did not match the injected document."
    );
    assertEqual(remoteLeaf._rev === leafPut.rev, true, "The remote leaf revision did not match the injected document.");

    return {
        fixtureId,
        path,
        metadataId,
        metadataRev: metadataPut.rev,
        chunkId,
        chunkRev: leafPut.rev,
    };
}

async function runOneShotReplication(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS ?? 30000)
): Promise<ReplicationOutcome> {
    return await evalObsidianJson<ReplicationOutcome>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const timeoutMs=${JSON.stringify(timeoutMs)};`,
            "const succeeded=!!(await core.services.replication.replicate(true));",
            "const deadline=Date.now()+timeoutMs;",
            "let state;",
            "do{",
            "  state={",
            "    finite:core.services.replicator.finiteReplicationActivityCount.value,",
            "    bounded:core.services.replicator.boundedRemoteActivityCount.value,",
            "    results:core.services.replication.replicationResultCount.value,",
            "    databaseQueue:core.services.replication.databaseQueueCount.value,",
            "    storageApplying:core.services.replication.storageApplyingCount.value,",
            "  };",
            "  if(state.finite===0&&state.bounded===0&&state.results===0&&state.databaseQueue===0&&state.storageApplying===0){",
            "    return JSON.stringify({succeeded,idle:true});",
            "  }",
            "  await new Promise(resolve=>setTimeout(resolve,100));",
            "}while(Date.now()<deadline);",
            "return JSON.stringify({succeeded,idle:false});",
            "})()",
        ].join(""),
        env
    );
}

async function readLocalOutcome(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    vault: TemporaryVault,
    fixture: RemoteFixture
): Promise<LocalOutcome> {
    const local = await evalObsidianJson<LocalOutcome>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const path=${JSON.stringify(fixture.path)};`,
            `const metadataId=${JSON.stringify(fixture.metadataId)};`,
            `const chunkId=${JSON.stringify(fixture.chunkId)};`,
            `const content=${JSON.stringify(fixtureContent)};`,
            "const db=core.localDatabase.localDatabase;",
            "const rows=await db.allDocs({keys:[metadataId,chunkId],include_docs:true});",
            "const metadataRow=rows.rows.find(row=>row.id===metadataId&&row.doc&&!row.value?.deleted);",
            "const chunkRow=rows.rows.find(row=>row.id===chunkId&&row.doc&&!row.value?.deleted);",
            "const metadata=metadataRow?.doc;",
            "const chunk=chunkRow?.doc;",
            "const decoded=metadata&&chunk?await core.localDatabase.getDBEntryFromMeta(metadata,false,false,true).catch(()=>false):false;",
            "const decodedData=decoded?(Array.isArray(decoded.data)?decoded.data.join(''):decoded.data):undefined;",
            "const file=app.vault.getAbstractFileByPath(path);",
            "const decodedPlaintextPresent=decodedData===content;",
            "return JSON.stringify({",
            "  metadataPresent:!!metadata,metadataRevision:metadata?._rev??null,chunkPresent:!!chunk,",
            "  decodedPlaintextPresent,",
            "  vaultFilePresent:!!file,",
            "  vaultContentMatches:!!file&&(await app.vault.read(file))===content,",
            "});",
            "})()",
        ].join(""),
        env
    );
    const diskState = await readVaultFileState(vault, fixture.path);
    return {
        ...local,
        vaultFilePresent: local.vaultFilePresent && diskState.present,
        vaultContentMatches: local.vaultContentMatches && diskState.contentMatches,
    };
}

async function readVaultFileState(vault: TemporaryVault, path: string): Promise<VaultFileState> {
    try {
        return { present: true, contentMatches: (await readFile(join(vault.path, path), "utf8")) === fixtureContent };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false, contentMatches: false };
        throw error;
    }
}

async function assertPlaintextRefused(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    vault: TemporaryVault,
    fixture: RemoteFixture
): Promise<void> {
    const outcome = await readLocalOutcome(cliBinary, env, vault, fixture);
    assertEqual(
        outcome.chunkPresent,
        false,
        "The unencrypted leaf entered the local database while acceptance was disabled."
    );
    assertEqual(
        outcome.decodedPlaintextPresent,
        false,
        "The synthetic plaintext body was readable from the local database while acceptance was disabled."
    );
    assertEqual(outcome.vaultFilePresent, false, "A file was reflected into the Vault while acceptance was disabled.");
    assertEqual(
        outcome.vaultContentMatches,
        false,
        "The synthetic plaintext body was reflected into the Vault while acceptance was disabled."
    );
}

async function assertPlaintextAccepted(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    vault: TemporaryVault,
    fixture: RemoteFixture
): Promise<void> {
    const outcome = await readLocalOutcome(cliBinary, env, vault, fixture);
    assertEqual(outcome.metadataPresent, true, "The accepted remote Metadata was missing from the local database.");
    assertEqual(
        outcome.metadataRevision === fixture.metadataRev,
        true,
        "The accepted Metadata revision changed unexpectedly."
    );
    assertEqual(outcome.chunkPresent, true, "The explicitly accepted leaf was not stored in the local database.");
    assertEqual(outcome.decodedPlaintextPresent, true, "The accepted body could not be read from the local database.");
    assertEqual(outcome.vaultFilePresent, true, "The explicitly accepted body did not create a Vault file.");
    assertEqual(outcome.vaultContentMatches, true, "The explicitly accepted body did not reach the Obsidian Vault.");
}

async function applySettingsPatch(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    patch: Record<string, unknown>,
    expectedPolicy: boolean,
    expectedReplicatorReplacement: boolean
): Promise<void> {
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 10000);
    const result = await evalObsidianJson<{
        realised: number;
        accepted: boolean;
        replicatorReplaced: boolean;
        patchApplied: boolean;
        diagnostics: {
            before: {
                coreEncrypt: boolean;
                serviceEncrypt: boolean;
                encryptMatches: boolean;
                coreAcceptUnencryptedContent: boolean;
                serviceAcceptUnencryptedContent: boolean;
                acceptUnencryptedContentMatches: boolean;
                configurationIdentityPresent: boolean;
                providerName: string | null;
            };
            after: {
                coreEncrypt: boolean;
                serviceEncrypt: boolean;
                encryptMatches: boolean;
                coreAcceptUnencryptedContent: boolean;
                serviceAcceptUnencryptedContent: boolean;
                acceptUnencryptedContentMatches: boolean;
                configurationIdentityPresent: boolean;
                providerName: string | null;
            };
            configurationIdentityEqual: boolean | null;
        };
        operationCalls: Record<string, number>;
    }>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const setting=core.services.setting;",
            "const rebuilder=core.rebuilder;",
            `const patch=${JSON.stringify(patch)};`,
            `const expectedPolicy=${JSON.stringify(expectedPolicy)};`,
            `const timeoutMs=${JSON.stringify(timeoutMs)};`,
            "const operationCalls={};",
            "const targets=[",
            "  [rebuilder,'$fetchLocalDBFast','fastFetch'],",
            "  [rebuilder,'$fetchLocal','fetch'],",
            "  [rebuilder,'fetchLocal','fetchLocal'],",
            "  [rebuilder,'fetchLocalDBFast','fetchLocalDBFast'],",
            "  [rebuilder,'scheduleFetch','scheduleFetch'],",
            "  [rebuilder,'$performRebuildDB','performRebuild'],",
            "  [rebuilder,'rebuildRemote','rebuildRemote'],",
            "  [rebuilder,'$rebuildRemote','rebuildRemoteInternal'],",
            "  [rebuilder,'rebuildEverything','rebuildEverything'],",
            "  [rebuilder,'$rebuildEverything','rebuildEverythingInternal'],",
            "  [rebuilder,'scheduleRebuild','scheduleRebuild'],",
            "  [rebuilder,'resetLocalDatabase','resetLocalDatabase'],",
            "];",
            "for(const [target,key] of [[rebuilder,'$fetchLocalDBFast'],[rebuilder,'$fetchLocal'],[rebuilder,'scheduleFetch'],[rebuilder,'$performRebuildDB'],[rebuilder,'scheduleRebuild']]){",
            "  if(typeof target?.[key]!=='function')throw new Error('A required Fetch or Rebuild operation could not be observed.');",
            "}",
            "const restorers=[];",
            "for(const [target,key,label] of targets){",
            "  if(typeof target?.[key]!=='function') continue;",
            "  const descriptor=Object.getOwnPropertyDescriptor(target,key);",
            "  const original=target[key];",
            "  operationCalls[label]=0;",
            "  Object.defineProperty(target,key,{configurable:true,writable:true,value:function(...args){operationCalls[label]++;return original.apply(this,args);}});",
            "  restorers.push(()=>{if(descriptor)Object.defineProperty(target,key,descriptor);else delete target[key];});",
            "}",
            "const replicatorService=core.services.replicator;",
            "const before=replicatorService.getActiveReplicator();",
            "if(!before)throw new Error('No active CouchDB Replicator was available before settings apply.');",
            "const beforeContext=replicatorService.inspectActiveReplicatorContext?.();",
            "const readSettingsState=()=>{const coreEncrypt=core.settings.encrypt===true;const serviceEncrypt=setting.currentSettings().encrypt===true;const coreAcceptUnencryptedContent=core.settings.acceptUnencryptedContent===true;const serviceAcceptUnencryptedContent=setting.currentSettings().acceptUnencryptedContent===true;return {coreEncrypt,serviceEncrypt,encryptMatches:coreEncrypt===serviceEncrypt,coreAcceptUnencryptedContent,serviceAcceptUnencryptedContent,acceptUnencryptedContentMatches:coreAcceptUnencryptedContent===serviceAcceptUnencryptedContent};};",
            "const providerName=context=>{const name=context?.provider?.diagnosticName??context?.provider?.kind;return typeof name==='string'?name:null;};",
            "const beforeSettings=readSettingsState();",
            "const beforeIdentity=beforeContext?.configurationIdentity;",
            "let realised=0;",
            "let resolveRealised;",
            "const realisedPromise=new Promise(resolve=>{resolveRealised=resolve;});",
            "const unregister=setting.onSettingRealised.addHandler(()=>{realised++;resolveRealised();return Promise.resolve(true);});",
            "let timer;",
            "try{",
            "  const apply=async()=>{await setting.applyPartial(patch,true);await realisedPromise;};",
            "  await Promise.race([apply(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out waiting for settings to be realised.')),timeoutMs);})]);",
            "  if(realised!==1)throw new Error('The setting-realisation handler did not run exactly once.');",
            "  const after=replicatorService.getActiveReplicator();",
            "  const afterContext=replicatorService.inspectActiveReplicatorContext?.();",
            "  const afterSettings=readSettingsState();",
            "  const afterIdentity=afterContext?.configurationIdentity;",
            "  const actual=setting.currentSettings().acceptUnencryptedContent===true;",
            "  const patchApplied=Object.entries(patch).every(([key,value])=>core.settings[key]===value&&setting.currentSettings()[key]===value);",
            "  const identityPresent=typeof beforeIdentity==='string'&&typeof afterIdentity==='string';",
            "  const providerNameBefore=providerName(beforeContext);",
            "  const providerNameAfter=providerName(afterContext);",
            "  return JSON.stringify({realised,accepted:actual,replicatorReplaced:!!after&&after!==before,patchApplied,diagnostics:{before:{...beforeSettings,configurationIdentityPresent:typeof beforeIdentity==='string',providerName:providerNameBefore},after:{...afterSettings,configurationIdentityPresent:typeof afterIdentity==='string',providerName:providerNameAfter},configurationIdentityEqual:identityPresent?beforeIdentity===afterIdentity:null},operationCalls});",
            "}finally{",
            "  clearTimeout(timer);",
            "  unregister();",
            "  for(const restore of restorers.reverse())restore();",
            "}",
            "})()",
        ].join(""),
        env
    );
    assertEqual(result.realised, 1, "The settings change did not reach onSettingRealised.");
    assertEqual(result.accepted, expectedPolicy, "The plaintext policy setting was not applied.");
    assertEqual(result.patchApplied, true, "The requested setting patch was not reflected in both settings views.");
    assertEqual(
        result.replicatorReplaced,
        expectedReplicatorReplacement,
        `Applying the setting did not meet the expected active Replicator replacement behaviour. Safe diagnostics: ${JSON.stringify(result.diagnostics)}`
    );
    assertEqual(
        Object.values(result.operationCalls).every((count) => count === 0),
        true,
        "Changing the setting automatically invoked Fetch or Rebuild."
    );
}

async function fetchAndReflectOnDemand(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    fixture: RemoteFixture,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS ?? 30000)
): Promise<DirectFetchOutcome> {
    return await evalObsidianJson<DirectFetchOutcome>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const path=${JSON.stringify(fixture.path)};`,
            `const chunkId=${JSON.stringify(fixture.chunkId)};`,
            `const timeoutMs=${JSON.stringify(timeoutMs)};`,
            "const metadata=await core.localDatabase.getDBEntryMeta(path,undefined,true);",
            "if(!metadata)throw new Error('The received Metadata is unavailable for direct Chunk retrieval.');",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "if(!replicator||typeof replicator.fetchRemoteChunks!=='function')throw new Error('The active CouchDB Replicator has no direct Chunk retrieval method.');",
            "const descriptor=Object.getOwnPropertyDescriptor(replicator,'fetchRemoteChunks');",
            "const original=replicator.fetchRemoteChunks;",
            "let requestedChunkCount=0;let returnedChunkCount=0;",
            "replicator.fetchRemoteChunks=async function(ids,...args){",
            "  if(ids.includes(chunkId))requestedChunkCount++;",
            "  const result=await original.call(this,ids,...args);",
            "  if(Array.isArray(result))returnedChunkCount+=result.filter(doc=>doc?._id===chunkId).length;",
            "  return result;",
            "};",
            "let timer;",
            "try{",
            "  const operation=core.serviceModules.fileHandler.dbToStorage(metadata,null,true);",
            "  const reflected=!!(await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out while reflecting the direct Chunk fixture.')),timeoutMs);})]));",
            "  return JSON.stringify({reflected,requestedChunkCount,returnedChunkCount});",
            "}finally{",
            "  clearTimeout(timer);",
            "  if(descriptor)Object.defineProperty(replicator,'fetchRemoteChunks',descriptor);else delete replicator.fetchRemoteChunks;",
            "}",
            "})()",
        ].join(""),
        env
    );
}

async function assertE2eeConfiguration(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    const settings = await evalObsidianJson<{
        encrypted: boolean;
        algorithm: string;
        acceptUnencryptedContent: boolean;
    }>(
        cliBinary,
        [
            "(()=>{",
            "const settings=app.plugins.plugins['obsidian-livesync'].core.services.setting.currentSettings();",
            "return JSON.stringify({encrypted:settings.encrypt===true,algorithm:settings.E2EEAlgorithm,acceptUnencryptedContent:settings.acceptUnencryptedContent===true});",
            "})()",
        ].join(""),
        env
    );
    assertEqual(settings.encrypted, true, "The E2EE fixture did not enable encryption.");
    assertEqual(settings.algorithm, "v2", "The E2EE fixture did not use V2.");
    assertEqual(settings.acceptUnencryptedContent, false, "The default plaintext policy did not deny acceptance.");
}

async function assertNonChunkReferenceRefused(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    couchDb: CouchDbConfig,
    dbName: string,
    vault: TemporaryVault
): Promise<string> {
    const fixtureId = `non-chunk-${randomUUID()}`;
    const path = fixturePath(fixtureId);
    const metadataId = await getMetadataId(cliBinary, env, path);
    const chunkId = `soft-deleted-${randomUUID()}.md`;
    const now = Date.now();
    const metadataPut = await putCouchDbDocument(couchDb, dbName, {
        _id: metadataId,
        path,
        type: "plain",
        ctime: now,
        mtime: now,
        size: Buffer.byteLength(fixtureContent, "utf8"),
        children: [chunkId],
        eden: {},
    });

    // Receive the referring Metadata before the remote body exists, so the
    // subsequent read must use the on-demand arrival path rather than a local row.
    const replication = await runOneShotReplication(cliBinary, env);
    assertEqual(replication.idle, true, "The non-Chunk fixture Metadata did not reach application quiescence.");
    const bodyPut = await putCouchDbDocument(couchDb, dbName, {
        _id: chunkId,
        type: "plain",
        deleted: true,
        data: fixtureContent,
    });
    const fixture: RemoteFixture = {
        fixtureId,
        path,
        metadataId,
        metadataRev: metadataPut.rev,
        chunkId,
        chunkRev: bodyPut.rev,
    };
    const before = await readLocalOutcome(cliBinary, env, vault, fixture);
    assertEqual(before.metadataPresent, true, "The referring Metadata was not received.");
    assertEqual(before.chunkPresent, false, "The non-Chunk fixture was already present locally.");

    const rejected = await fetchAndReflectOnDemand(cliBinary, env, fixture);
    assertEqual(rejected.requestedChunkCount > 0, true, "The non-Chunk fixture did not use on-demand retrieval.");
    assertEqual(rejected.returnedChunkCount > 0, true, "The control-exempt body did not reach Chunk validation.");
    const after = await readLocalOutcome(cliBinary, env, vault, fixture);
    const acceptance = {
        reflected: rejected.reflected,
        stored: after.chunkPresent,
        vaultFilePresent: after.vaultFilePresent,
        vaultContentMatches: after.vaultContentMatches,
    };
    assertEqual(
        Object.values(acceptance).some(Boolean),
        false,
        `A non-Chunk document was accepted as file content: ${JSON.stringify(acceptance)}`
    );
    await assertPlaintextRefused(cliBinary, env, vault, fixture);

    // A corrected remote leaf remains retrievable after opting in to plaintext.
    const repaired = await putCouchDbDocument(couchDb, dbName, {
        _id: chunkId,
        _rev: bodyPut.rev,
        type: "leaf",
        data: fixtureContent,
    });
    await applySettingsPatch(cliBinary, env, { acceptUnencryptedContent: true }, true, true);
    const accepted = await fetchAndReflectOnDemand(cliBinary, env, { ...fixture, chunkRev: repaired.rev });
    assertEqual(accepted.requestedChunkCount > 0, true, "The corrected Chunk was not requested again.");
    assertEqual(accepted.reflected, true, "The corrected plaintext leaf was not reflected after opt-in.");
    await assertPlaintextAccepted(cliBinary, env, vault, fixture);
    return fixtureId;
}

async function inspectE2eePolicyDialog(cliBinary: string, env: NodeJS.ProcessEnv): Promise<E2eePolicyUiOutcome> {
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 10000);
    return await evalObsidianJson<E2eePolicyUiOutcome>(
        cliBinary,
        [
            "(async()=>{",
            "const timeoutMs=",
            JSON.stringify(timeoutMs),
            ";",
            "const deadline=Date.now()+timeoutMs;",
            "const waitFor=async(predicate,label,end=deadline)=>{while(Date.now()<end){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timed out while '+label+'.');};",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const initialAcceptance=core.settings.acceptUnencryptedContent;",
            "const manager=core.modules.find(module=>module.constructor.name==='SetupManager');",
            "if(typeof manager?.onlyE2EEConfiguration!=='function')throw new Error('Could not find SetupManager.onlyE2EEConfiguration.');",
            "let dialogSettled=false;let dialogResult;let dialogFailure;let dialog=null;",
            "const dialogPromise=manager.onlyE2EEConfiguration('unknown',{...core.settings});",
            "void dialogPromise.then(result=>{dialogResult=result;dialogSettled=true;},error=>{dialogFailure=error;dialogSettled=true;});",
            "try{",
            "  dialog=await waitFor(()=>document.querySelector('.sls-e2ee-dialog'),'opening the End-to-End Encryption dialogue');",
            "  const findRow=label=>Array.from(dialog.querySelectorAll('label.row')).find(row=>row.querySelector('span')?.textContent?.trim()===label);",
            "  const e2eeRow=findRow('End-to-End Encryption');",
            "  if(!e2eeRow)throw new Error('The E2EE checkbox label row was not rendered.');",
            "  const e2eeInput=e2eeRow.querySelector('input[type=checkbox]');",
            "  if(!e2eeInput)throw new Error('The E2EE checkbox was not rendered.');",
            "  const details=Array.from(dialog.querySelectorAll('details')).find(element=>element.querySelector('summary')?.textContent?.trim()==='Advanced');",
            "  if(!details)throw new Error('The Advanced details section was not rendered.');",
            "  details.querySelector('summary').click();",
            "  await waitFor(()=>details.open,'opening the Advanced details section');",
            "  const acceptanceRow=findRow('Accept unencrypted content');",
            "  if(!acceptanceRow)throw new Error('The plaintext acceptance checkbox label row was not rendered.');",
            "  const acceptanceInput=acceptanceRow.querySelector('input[type=checkbox]');",
            "  if(!acceptanceInput)throw new Error('The plaintext acceptance checkbox was not rendered.');",
            "  const acceptanceRowInAdvanced=details.contains(acceptanceRow);",
            "  const initialEncryptionEnabled=e2eeInput.checked;",
            "  const initialAcceptanceChecked=acceptanceInput.checked;",
            "  const acceptanceInitiallyEnabled=!acceptanceInput.disabled;",
            "  const warningText=details.textContent??'';",
            "  const warningMentionsThirdParty=warningText.includes('third-party tools can add content');",
            "  const warningMentionsPassphrase=warningText.includes('without the E2EE passphrase');",
            "  const warningMentionsDatabaseWriteInjection=warningText.includes('Anyone with database write access can inject plaintext');",
            "  acceptanceInput.click();",
            "  await waitFor(()=>acceptanceInput.checked,'enabling plaintext acceptance');",
            "  const acceptanceCheckedAfterClick=acceptanceInput.checked;",
            "  e2eeInput.click();",
            "  await waitFor(()=>!e2eeInput.checked&&acceptanceInput.disabled&&acceptanceInput.checked,'disabling E2EE while retaining plaintext acceptance');",
            "  const acceptanceDisabledWhenEncryptionOff=acceptanceInput.disabled;",
            "  const acceptanceCheckedWhenEncryptionOff=acceptanceInput.checked;",
            "  e2eeInput.click();",
            "  await waitFor(()=>e2eeInput.checked&&!acceptanceInput.disabled&&acceptanceInput.checked,'re-enabling E2EE with plaintext acceptance retained');",
            "  const acceptanceEnabledWhenEncryptionOn=!acceptanceInput.disabled;",
            "  const acceptanceCheckedWhenEncryptionOn=acceptanceInput.checked;",
            "  const cancel=Array.from(dialog.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Cancel');",
            "  if(!cancel)throw new Error('The E2EE dialogue Cancel button was not rendered.');",
            "  cancel.click();",
            "  await waitFor(()=>dialogSettled,'waiting for SetupManager dialogue completion');",
            "  if(dialogFailure)throw new Error('SetupManager dialogue failed.');",
            "  return JSON.stringify({initialEncryptionEnabled,initialAcceptanceChecked,acceptanceRowInAdvanced,acceptanceInitiallyEnabled,acceptanceCheckedAfterClick,acceptanceDisabledWhenEncryptionOff,acceptanceCheckedWhenEncryptionOff,acceptanceEnabledWhenEncryptionOn,acceptanceCheckedWhenEncryptionOn,warningMentionsThirdParty,warningMentionsPassphrase,warningMentionsDatabaseWriteInjection,cancelReturnedFalse:dialogResult===false,savedAcceptanceUnchanged:core.settings.acceptUnencryptedContent===initialAcceptance&&core.services.setting.currentSettings().acceptUnencryptedContent===initialAcceptance});",
            "}finally{",
            "  if(!dialogSettled){",
            "    const root=dialog??document.querySelector('.sls-e2ee-dialog');",
            "    const cancel=root&&Array.from(root.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Cancel');",
            "    if(cancel)cancel.click();",
            "    await waitFor(()=>dialogSettled,'cleaning up the E2EE dialogue',Date.now()+timeoutMs);",
            "  }",
            "}",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const artifactRoot = process.env.E2E_OBSIDIAN_ARTIFACT_ROOT ?? process.cwd();
    const couchDb = await loadCouchDbConfig();
    await assertCouchDbReachable(couchDb);

    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "e2ee-plaintext-policy");
    const connection = { ...couchDb, dbName };
    const vault = await createTemporaryVault("obsidian-livesync-e2ee-plaintext-policy-");
    let session: ObsidianLiveSyncSession | undefined;
    let databaseCreated = false;

    try {
        await createCouchDbDatabase(couchDb, dbName);
        databaseCreated = true;
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            artifactRoot,
            pluginData: createE2eCouchDbPluginData(connection, {
                encrypt: true,
                E2EEAlgorithm: "v2",
                passphrase: "synthetic-e2ee-plaintext-policy-fixture",
                acceptUnencryptedContent: false,
                encryptInternalMetadata: false,
                usePathObfuscation: false,
                readChunksOnline: false,
                useOnlyLocalChunk: false,
                useRequestAPI: true,
                periodicReplication: false,
                syncOnStart: false,
                syncOnSave: false,
                syncOnFileOpen: false,
                syncOnEditorSave: false,
                syncAfterMerge: false,
            }),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await prepareRemote(cliBinary, session.cliEnv);
        await assertE2eeConfiguration(cliBinary, session.cliEnv);
        const e2eePolicyUi = await inspectE2eePolicyDialog(cliBinary, session.cliEnv);
        assertEqual(
            e2eePolicyUi.initialEncryptionEnabled,
            true,
            "The E2EE configuration dialogue did not open with encryption enabled."
        );
        assertEqual(
            e2eePolicyUi.initialAcceptanceChecked,
            false,
            "The E2EE configuration dialogue did not open with plaintext acceptance disabled."
        );
        assertEqual(
            e2eePolicyUi.acceptanceRowInAdvanced,
            true,
            "The plaintext acceptance control was outside the Advanced details section."
        );
        assertEqual(
            e2eePolicyUi.acceptanceInitiallyEnabled,
            true,
            "The plaintext acceptance control was disabled while E2EE was enabled."
        );
        assertEqual(
            e2eePolicyUi.acceptanceCheckedAfterClick,
            true,
            "The plaintext acceptance control did not bind its checked state."
        );
        assertEqual(
            e2eePolicyUi.acceptanceDisabledWhenEncryptionOff,
            true,
            "The plaintext acceptance control remained enabled while E2EE was disabled."
        );
        assertEqual(
            e2eePolicyUi.acceptanceCheckedWhenEncryptionOff,
            true,
            "Disabling E2EE discarded the selected plaintext acceptance value."
        );
        assertEqual(
            e2eePolicyUi.acceptanceEnabledWhenEncryptionOn,
            true,
            "The plaintext acceptance control remained disabled after re-enabling E2EE."
        );
        assertEqual(
            e2eePolicyUi.acceptanceCheckedWhenEncryptionOn,
            true,
            "Re-enabling E2EE discarded the selected plaintext acceptance value."
        );
        assertEqual(
            e2eePolicyUi.warningMentionsThirdParty,
            true,
            "The plaintext acceptance warning did not explain third-party content injection."
        );
        assertEqual(
            e2eePolicyUi.warningMentionsPassphrase,
            true,
            "The plaintext acceptance warning did not explain that the E2EE passphrase is not required."
        );
        assertEqual(
            e2eePolicyUi.warningMentionsDatabaseWriteInjection,
            true,
            "The plaintext acceptance warning did not explain database-write injection risk."
        );
        assertEqual(
            e2eePolicyUi.cancelReturnedFalse,
            true,
            "Cancelling the E2EE configuration dialogue did not return false."
        );
        assertEqual(
            e2eePolicyUi.savedAcceptanceUnchanged,
            true,
            "Cancelling the E2EE configuration dialogue changed the saved plaintext policy."
        );

        const ordinary = await injectPlaintextFixture(
            cliBinary,
            session.cliEnv,
            couchDb,
            dbName,
            `ordinary-${randomUUID()}`
        );
        const ordinaryReplication = await runOneShotReplication(cliBinary, session.cliEnv);
        assertEqual(ordinaryReplication.idle, true, "The ordinary CouchDB pull did not reach application quiescence.");
        await assertPlaintextRefused(cliBinary, session.cliEnv, vault, ordinary);
        assertEqual(
            ordinaryReplication.succeeded,
            false,
            "The ordinary CouchDB pull did not fail when it received a forbidden plaintext leaf."
        );

        await applySettingsPatch(cliBinary, session.cliEnv, { acceptUnencryptedContent: true }, true, true);
        await assertPlaintextRefused(cliBinary, session.cliEnv, vault, ordinary);

        const acceptedReplication = await runOneShotReplication(cliBinary, session.cliEnv);
        assertEqual(
            acceptedReplication.succeeded,
            true,
            "The ordinary CouchDB pull did not accept the same remote plaintext leaf after policy apply."
        );
        assertEqual(
            acceptedReplication.idle,
            true,
            "The accepted ordinary CouchDB pull did not reach application quiescence."
        );
        const ordinaryRemoteMetadata = await fetchCouchDbDocument(couchDb, dbName, ordinary.metadataId);
        const ordinaryRemoteLeaf = await fetchCouchDbDocument(couchDb, dbName, ordinary.chunkId);
        assertEqual(
            ordinaryRemoteMetadata._rev === ordinary.metadataRev,
            true,
            "The ordinary Metadata revision changed during acceptance."
        );
        assertEqual(
            ordinaryRemoteLeaf._rev === ordinary.chunkRev,
            true,
            "The ordinary leaf revision changed during acceptance."
        );
        assertEqual(
            !("e_" in ordinaryRemoteLeaf),
            true,
            "The accepted ordinary remote leaf unexpectedly had the encryption marker."
        );
        await assertPlaintextAccepted(cliBinary, session.cliEnv, vault, ordinary);

        await applySettingsPatch(cliBinary, session.cliEnv, { acceptUnencryptedContent: false }, false, true);
        await applySettingsPatch(cliBinary, session.cliEnv, { readChunksOnline: true }, false, false);
        const onDemand = await injectPlaintextFixture(
            cliBinary,
            session.cliEnv,
            couchDb,
            dbName,
            `on-demand-${randomUUID()}`
        );
        const onDemandReplication = await runOneShotReplication(cliBinary, session.cliEnv);
        assertEqual(
            onDemandReplication.idle,
            true,
            "The on-demand Metadata pull did not reach application quiescence."
        );
        const onDemandMetadata = await evalObsidianJson<{ present: boolean; revision: string | null }>(
            cliBinary,
            [
                "(async()=>{",
                `const path=${JSON.stringify(onDemand.path)};`,
                "const metadata=await app.plugins.plugins['obsidian-livesync'].core.localDatabase.getDBEntryMeta(path,undefined,true);",
                "return JSON.stringify({present:!!metadata,revision:metadata?._rev??null});",
                "})()",
            ].join(""),
            session.cliEnv
        );
        assertEqual(onDemandMetadata.present, true, "The on-demand pull did not receive the valid Metadata.");
        assertEqual(
            onDemandMetadata.revision === onDemand.metadataRev,
            true,
            "The on-demand pull received an unexpected Metadata revision."
        );
        await assertPlaintextRefused(cliBinary, session.cliEnv, vault, onDemand);

        const deniedDirectFetch = await fetchAndReflectOnDemand(cliBinary, session.cliEnv, onDemand);
        assertEqual(
            deniedDirectFetch.requestedChunkCount > 0,
            true,
            "The denied direct read did not request the remote Chunk."
        );
        assertEqual(deniedDirectFetch.returnedChunkCount, 0, "The denied direct read returned the plaintext Chunk.");
        assertEqual(deniedDirectFetch.reflected, false, "The denied direct read reflected the plaintext body.");
        await assertPlaintextRefused(cliBinary, session.cliEnv, vault, onDemand);
        const onDemandMetadataAfterDenial = await evalObsidianJson<{ present: boolean; revision: string | null }>(
            cliBinary,
            [
                "(async()=>{",
                `const path=${JSON.stringify(onDemand.path)};`,
                "const metadata=await app.plugins.plugins['obsidian-livesync'].core.localDatabase.getDBEntryMeta(path,undefined,true);",
                "return JSON.stringify({present:!!metadata,revision:metadata?._rev??null});",
                "})()",
            ].join(""),
            session.cliEnv
        );
        assertEqual(onDemandMetadataAfterDenial.present, true, "The rejected on-demand read removed its Metadata.");
        assertEqual(
            onDemandMetadataAfterDenial.revision === onDemand.metadataRev,
            true,
            "The rejected on-demand read changed its Metadata revision."
        );

        await applySettingsPatch(cliBinary, session.cliEnv, { acceptUnencryptedContent: true }, true, true);
        const acceptedDirectFetch = await fetchAndReflectOnDemand(cliBinary, session.cliEnv, onDemand);
        assertEqual(
            acceptedDirectFetch.requestedChunkCount > 0,
            true,
            "The accepted direct read did not request the remote Chunk again."
        );
        assertEqual(
            acceptedDirectFetch.returnedChunkCount > 0,
            true,
            "The accepted direct read did not receive the same remote Chunk."
        );
        assertEqual(
            acceptedDirectFetch.reflected,
            true,
            "The accepted direct read did not reflect the plaintext body."
        );
        const onDemandRemoteMetadata = await fetchCouchDbDocument(couchDb, dbName, onDemand.metadataId);
        const onDemandRemoteLeaf = await fetchCouchDbDocument(couchDb, dbName, onDemand.chunkId);
        assertEqual(
            onDemandRemoteMetadata._rev === onDemand.metadataRev,
            true,
            "The on-demand Metadata revision changed during acceptance."
        );
        assertEqual(
            onDemandRemoteLeaf._rev === onDemand.chunkRev,
            true,
            "The on-demand leaf revision changed during acceptance."
        );
        assertEqual(
            !("e_" in onDemandRemoteLeaf),
            true,
            "The accepted on-demand remote leaf unexpectedly had the encryption marker."
        );
        await assertPlaintextAccepted(cliBinary, session.cliEnv, vault, onDemand);

        await applySettingsPatch(cliBinary, session.cliEnv, { acceptUnencryptedContent: false }, false, true);
        const nonChunkFixtureId = await assertNonChunkReferenceRefused(
            cliBinary,
            session.cliEnv,
            couchDb,
            dbName,
            vault
        );

        const artifactHash = createHash("sha256")
            .update(new Uint8Array(await readFile(join(artifactRoot, "main.js"))))
            .digest("hex");
        console.log(
            JSON.stringify(
                {
                    ok: true,
                    scenario: "e2ee-plaintext-policy",
                    artifactHash,
                    fixtureIds: [ordinary.fixtureId, onDemand.fixtureId, nonChunkFixtureId],
                    assertions: {
                        remoteLeafHadNoEncryptionMarker: true,
                        defaultOrdinaryPullRejectedThePlaintextLeafWithoutStoringOrReflectingIt: true,
                        policyApplyReachedSettingRealisedAndReplacedTheReplicatorWithoutFetchOrRebuild: true,
                        sameRemoteMetadataAndLeafRevisionWereAcceptedAfterPolicyChange: true,
                        onDemandMetadataArrivedBeforePlaintextWasReflected: true,
                        directChunkReadWasDeniedThenRetriedAndReflectedAfterPolicyChange: true,
                        e2eeDialogBoundThePlaintextPolicyAndCancelLeftItUnchanged: true,
                        nonChunkReferenceWasRejectedBeforeStorageAndVaultReflection: true,
                        correctedRemoteLeafRemainedRetrievableAfterOptIn: true,
                    },
                },
                null,
                2
            )
        );
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
        if (databaseCreated) await deleteCouchDbDatabase(couchDb, dbName);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
