/** Exercises synthetic split-surrogate input through real Obsidian file reflection. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    assertEqual,
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
    const textPath = "synthetic-split-pair.md";
    const controlPath = "complete-pair.md";
    const binaryPath = "attachment.bin";
    const textContent = "prefix 🙂 suffix\n" + "normal chunk payload\n".repeat(50_000);
    const controlContent = "prefix 🙂 suffix";
    const binaryBytes = Buffer.from([0, 255, 31, 128]);
    const textSize = Buffer.byteLength(textContent, "utf8");
    const textHash = `sha256:${createHash("sha256").update(textContent, "utf8").digest("hex")}`;
    const controlSize = Buffer.byteLength(controlContent, "utf8");
    const controlHash = `sha256:${createHash("sha256").update(controlContent, "utf8").digest("hex")}`;
    const settings = createE2eCouchDbPluginData(
        { uri: "http://127.0.0.1:1", username: "unused", password: "unused", dbName: "third-party-chunks-local" },
        {
            customChunkSize: 0,
            processSizeMismatchedFiles: false,
            liveSync: false,
            periodicReplication: false,
            syncOnStart: false,
            syncOnSave: false,
            syncOnFileOpen: false,
            syncOnEditorSave: false,
            syncAfterMerge: false,
        }
    );
    const bundleHash = createHash("sha256")
        .update(new Uint8Array(await readFile("main.js")))
        .digest("hex");
    const vault = await createTemporaryVault("obsidian-third-party-chunks-");
    let session: ObsidianLiveSyncSession | undefined;

    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            pluginData: settings,
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
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);

        const reflection = await evalObsidianJson<{
            sizeCheckingEnabled: boolean;
            split: {
                reflected: boolean;
                metadataRevisionUnchanged: boolean;
                chunkCount: number;
                provenanceRevision: string;
                contentSize: number;
                contentHash: string;
            };
            control: {
                reflected: boolean;
                content: string;
                metadataRevisionUnchanged: boolean;
                provenanceRevision: string;
                contentSize: number;
                contentHash: string;
            };
            binary: { reflected: boolean; bytes: number[]; metadataRevisionUnchanged: boolean };
        }>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const require=(condition,message)=>{if(!condition)throw new Error(message);};",
                "const textPath='synthetic-split-pair.md';",
                "const controlPath='complete-pair.md';",
                "const binaryPath='attachment.bin';",
                "const textContent='prefix 🙂 suffix\\n'+'normal chunk payload\\n'.repeat(50000);",
                "const controlContent='prefix 🙂 suffix';",
                "const binaryBytes=[0,255,31,128];",
                "const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
                "require(core.settings.processSizeMismatchedFiles===false,'Size mismatch checking must remain enabled');",
                "const seed=async(path,blob,type,datatype)=>{",
                "  require(!app.vault.getAbstractFileByPath(path),'Fixture already exists in the Vault: '+path);",
                "  const id=await core.services.path.path2id(path);",
                "  const now=Date.now();",
                "  const saved=await core.localDatabase.putDBEntry({_id:id,path,data:blob,ctime:now,mtime:now,",
                "    size:blob.size,children:[],datatype,type,eden:{} });",
                "  require(saved?.ok,'Could not create Metadata and Chunks: '+path);",
                "  const meta=await core.localDatabase.getDBEntryMeta(path,undefined,true);",
                "  require(meta&&meta._rev===saved.rev,'Could not reload the created Metadata: '+path);",
                "  return meta;",
                "};",
                "const textMeta=await seed(textPath,new Blob([textContent],{type:'text/plain'}),'plain','plain');",
                "require((textMeta.children??[]).length>0,'The primary fixture did not create normal Chunks');",
                "const savedText=await core.localDatabase.getDBEntry(textPath,{rev:textMeta._rev,revs:true},false,true,true);",
                "const storedText=Array.isArray(savedText?.data)?savedText.data.join(''):savedText?.data;",
                "require(storedText===textContent,'The seeded local database content did not match the joined text');",
                "const controlMeta=await seed(controlPath,new Blob([controlContent],{type:'text/plain'}),'plain','plain');",
                "const binaryMeta=await seed(binaryPath,new Blob([new Uint8Array(binaryBytes)],{type:'application/octet-stream'}),'newnote','newnote');",
                "const initialTextRevision=textMeta._rev;",
                "const initialControlRevision=controlMeta._rev;",
                "const database=core.serviceModules.databaseFileAccess;",
                "require(typeof database?.fetchEntryFromMeta==='function','The database file-access provider is missing');",
                "const descriptor=Object.getOwnPropertyDescriptor(database,'fetchEntryFromMeta');",
                "const original=database.fetchEntryFromMeta;",
                "let supplied=0;",
                "const pairIndex=textContent.indexOf('🙂');",
                "const syntheticChunks=[textContent.slice(0,pairIndex+1),textContent.slice(pairIndex+1)];",
                "require(syntheticChunks[0]==='prefix \\uD83D','The synthetic first chunk did not end with the high surrogate');",
                "require(syntheticChunks[1].startsWith('\\uDE42 suffix'),'The synthetic second chunk did not start with the low surrogate');",
                "database.fetchEntryFromMeta=async function(meta,...args){",
                "  const loaded=await original.call(database,meta,...args);",
                "  if(meta?._id!==textMeta._id||meta?.path!==textPath||!loaded)return loaded;",
                "  supplied++;",
                "  return {...loaded,data:syntheticChunks};",
                "};",
                "let reflectedText=false;",
                "try{reflectedText=await core.serviceModules.fileHandler.dbToStorage(textMeta,null,true);}",
                "finally{if(descriptor)Object.defineProperty(database,'fetchEntryFromMeta',descriptor);else delete database.fetchEntryFromMeta;}",
                "require(supplied===1,'The synthetic provider was not used exactly once');",
                "require(reflectedText,'Real Obsidian reflection rejected the joined text');",
                "const textFile=app.vault.getAbstractFileByPath(textPath);",
                "require(textFile,'The reflected text file is missing from the Vault');",
                "const vaultText=await app.vault.read(textFile);",
                "require(vaultText===textContent,'The Vault text does not match the joined input');",
                "const textMetaAfter=await core.localDatabase.getDBEntryMeta(textPath,undefined,true);",
                "require(textMetaAfter?._rev===initialTextRevision,'Text reflection changed the Metadata revision');",
                "const textProvenance=await store.get(textPath);",
                "require(textProvenance?.revision===initialTextRevision,'Text provenance has the wrong revision');",
                `require(textProvenance?.contentSize===${textSize},'Text provenance has the wrong UTF-8 byte size');`,
                `require(textProvenance?.contentHash===${JSON.stringify(textHash)},'Text provenance has the wrong content hash');`,
                "const reflectedControl=await core.serviceModules.fileHandler.dbToStorage(controlMeta,null,true);",
                "require(reflectedControl,'Real Obsidian reflection rejected the complete-pair control');",
                "const controlFile=app.vault.getAbstractFileByPath(controlPath);",
                "require(controlFile&&await app.vault.read(controlFile)===controlContent,'The complete-pair control content changed');",
                "const controlVaultText=await app.vault.read(controlFile);",
                "const controlMetaAfter=await core.localDatabase.getDBEntryMeta(controlPath,undefined,true);",
                "require(controlMetaAfter?._rev===initialControlRevision,'Control reflection changed the Metadata revision');",
                "const controlProvenance=await store.get(controlPath);",
                "require(controlProvenance?.revision===initialControlRevision,'Control provenance has the wrong revision');",
                `require(controlProvenance?.contentSize===${controlSize},'Control provenance has the wrong UTF-8 byte size');`,
                `require(controlProvenance?.contentHash===${JSON.stringify(controlHash)},'Control provenance has the wrong content hash');`,
                "const reflectedBinary=await core.serviceModules.fileHandler.dbToStorage(binaryMeta,null,true);",
                "require(reflectedBinary,'Real Obsidian reflection rejected the binary attachment');",
                "const binaryFile=app.vault.getAbstractFileByPath(binaryPath);",
                "require(binaryFile,'The reflected binary attachment is missing from the Vault');",
                "const binaryVaultBytes=Array.from(new Uint8Array(await app.vault.readBinary(binaryFile)));",
                "require(JSON.stringify(binaryVaultBytes)===JSON.stringify(binaryBytes),'The Vault binary bytes changed');",
                "const binaryMetaAfter=await core.localDatabase.getDBEntryMeta(binaryPath,undefined,true);",
                "require(binaryMetaAfter?._rev===binaryMeta._rev,'Binary reflection changed the Metadata revision');",
                "return JSON.stringify({sizeCheckingEnabled:!core.settings.processSizeMismatchedFiles,",
                "  split:{reflected:reflectedText,metadataRevisionUnchanged:textMetaAfter._rev===initialTextRevision,chunkCount:textMeta.children.length,",
                "    provenanceRevision:textProvenance.revision,contentSize:textProvenance.contentSize,contentHash:textProvenance.contentHash},",
                "  control:{reflected:reflectedControl,content:controlVaultText,",
                "    metadataRevisionUnchanged:controlMetaAfter._rev===initialControlRevision,provenanceRevision:controlProvenance.revision,",
                "    contentSize:controlProvenance.contentSize,contentHash:controlProvenance.contentHash},",
                "  binary:{reflected:reflectedBinary,bytes:binaryVaultBytes,metadataRevisionUnchanged:binaryMetaAfter._rev===binaryMeta._rev}});",
                "})()",
            ].join(""),
            session.cliEnv
        );

        assertEqual(reflection.sizeCheckingEnabled, true, "Size mismatch checking was disabled.");
        assertEqual(reflection.split.reflected, true, "Split-pair text was not reflected.");
        assertEqual(
            reflection.split.metadataRevisionUnchanged,
            true,
            "Split-pair reflection changed its Metadata revision."
        );
        assertEqual(reflection.split.provenanceRevision.length > 0, true, "Split-pair provenance is missing.");
        assertEqual(reflection.split.contentSize, textSize, "Split-pair provenance has the wrong UTF-8 byte size.");
        assertEqual(reflection.split.contentHash, textHash, "Split-pair provenance has the wrong content hash.");
        assertEqual(reflection.control.reflected, true, "Complete-pair control was not reflected.");
        assertEqual(reflection.control.content, controlContent, "Complete-pair control content changed.");
        assertEqual(
            reflection.control.metadataRevisionUnchanged,
            true,
            "Control reflection changed its Metadata revision."
        );
        assertEqual(reflection.control.contentSize, controlSize, "Control provenance has the wrong UTF-8 byte size.");
        assertEqual(reflection.control.contentHash, controlHash, "Control provenance has the wrong content hash.");
        assertEqual(reflection.binary.reflected, true, "Binary attachment was not reflected.");
        if (!Buffer.from(reflection.binary.bytes).equals(binaryBytes)) {
            throw new Error("The Obsidian Vault API returned different binary attachment bytes.");
        }
        assertEqual(
            reflection.binary.metadataRevisionUnchanged,
            true,
            "Binary reflection changed its Metadata revision."
        );

        const diskText = await readFile(join(vault.path, textPath));
        assertEqual(diskText.toString("utf8"), textContent, "On-disk UTF-8 text differs from the joined input.");
        assertEqual(diskText.byteLength, textSize, "On-disk UTF-8 text has the wrong byte length.");
        const diskControl = await readFile(join(vault.path, controlPath));
        assertEqual(
            diskControl.toString("utf8"),
            controlContent,
            "On-disk complete-pair control differs from the input."
        );
        const diskBinary = await readFile(join(vault.path, binaryPath));
        if (!diskBinary.equals(binaryBytes)) throw new Error("On-disk binary attachment bytes changed.");

        console.log(
            JSON.stringify(
                {
                    ok: true,
                    bundleHash,
                    syntheticInput:
                        "A local fetchEntryFromMeta result split the joined text between the emoji surrogates; this does not establish that CouchDB or any named third-party producer emits lone-surrogate chunks.",
                    sizeCheckingEnabled: reflection.sizeCheckingEnabled,
                    splitText: {
                        reflected: reflection.split.reflected,
                        metadataRevisionUnchanged: reflection.split.metadataRevisionUnchanged,
                        realChunkCount: reflection.split.chunkCount,
                        vaultTextMatches: true,
                        onDiskUtf8Bytes: diskText.byteLength,
                        provenanceRevision: reflection.split.provenanceRevision,
                        contentSize: reflection.split.contentSize,
                        contentHash: reflection.split.contentHash,
                    },
                    completePairControl: {
                        reflected: reflection.control.reflected,
                        metadataRevisionUnchanged: reflection.control.metadataRevisionUnchanged,
                        vaultAndDiskContentMatch: true,
                        provenanceContentSize: reflection.control.contentSize,
                        provenanceContentHash: reflection.control.contentHash,
                    },
                    binaryAttachment: {
                        reflected: reflection.binary.reflected,
                        exactVaultBytes: true,
                        exactDiskBytes: true,
                        metadataRevisionUnchanged: reflection.binary.metadataRevisionUnchanged,
                    },
                },
                null,
                2
            )
        );
    } finally {
        try {
            await session?.app.stop();
        } finally {
            await vault.dispose();
        }
    }
}

await main();
