import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { deriveIdKey } from "@vrtmrz/livesync-commonlib/settings";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    configureObjectStorage,
    createE2eObjectStoragePluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import {
    createObjectStorageClient,
    readObjectStorageObject,
    deleteObjectStoragePrefix,
    ensureObjectStorageBucket,
    listObjectStorageObjects,
    loadObjectStorageConfig,
    makeUniqueBucketPrefix,
    readObjectStorageJson,
    type ObjectStorageConfig,
} from "../runner/objectStorage.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";
import { openLiveSyncSettings, waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const timeoutMs = Number(process.env.E2E_OBSIDIAN_JOURNAL_NFC_TIMEOUT_MS ?? 60000);
const objectTimeoutMs = Number(process.env.E2E_OBSIDIAN_OBJECT_STORAGE_TIMEOUT_MS ?? 30000);
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_JOURNAL_NFC_UI_TIMEOUT_MS ?? 10000);
const relativeFolder = "E2E/journal-nfc";
const folderNfd = "Cafe\u0301";
const conflictNameNfd = "conflict-e\u0301.md";
const conflictPathNfd = `${relativeFolder}/${folderNfd}/${conflictNameNfd}`;
const conflictPathNfc = conflictPathNfd.normalize("NFC");
const controlNameNfd = "ordinary-e\u0301.md";
const controlPathNfd = `${relativeFolder}/${folderNfd}/${controlNameNfd}`;
const controlContent = "# NFC control\n\nThis ordinary, non-conflicted note keeps one NFC-equivalent path.\n";
const baseContent = [
    "# Journal resend conflict fixture",
    "",
    "The common ancestor contains this exact sentence and enough bytes for real Chunks.",
    "The source file begins from this baseline before either device makes a change.",
    "Shared value: the original value remains here.",
    "",
].join("\n");
const sourceLeafContent = [
    "# Journal resend conflict fixture",
    "",
    "The common ancestor contains this exact sentence and enough bytes for real Chunks.",
    "The source file begins from this baseline before either device makes a change.",
    "Shared value: the source device replaced this line with its own edit.",
    "",
].join("\n");
const competingLeafContent = [
    "# Journal resend conflict fixture",
    "",
    "The common ancestor contains this exact sentence and enough bytes for real Chunks.",
    "The source file begins from this baseline before either device makes a change.",
    "Shared value: another device replaced this line differently.",
    "",
].join("\n");

type ScenarioCase = { name: "plain" | "encrypted"; independentIds: boolean };
type RevisionSnapshot = {
    rev: string;
    revisionTree: { start: number; ids: string[] };
    revisions: string[];
    body: string;
    children: string[];
    chunksPresent: boolean;
};
type ConflictTreeSnapshot = {
    id: string;
    path: string;
    leafRevs: string[];
    leaves: RevisionSnapshot[];
    ancestor?: RevisionSnapshot;
    ancestorRev?: string;
    ancestorBodyAvailable: boolean;
};
type TransferCheckpoint = {
    lastLocalSeq: number | string | undefined;
    journalEpoch: string;
    knownIDs: string[];
    sentIDs: string[];
    receivedFiles: string[];
    sentFiles: string[];
};
type ScenarioSettings = Record<string, unknown>;

function selectedCases(args: readonly string[]): ScenarioCase[] {
    let requested = process.env.E2E_OBSIDIAN_INDEPENDENT_IDS === "true" ? "encrypted" : "plain";
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--help" || argument === "-h") {
            console.log("Usage: journal-nfc-resend.ts [--case all|plain|encrypted|independent-ids]");
            process.exit(0);
        }
        if (argument === "--case") {
            const value = args[index + 1];
            if (!value) throw new Error("--case requires all, plain, encrypted, or independent-ids.");
            requested = value;
            index += 1;
            continue;
        }
        if (argument.startsWith("--case=")) {
            requested = argument.slice("--case=".length);
            continue;
        }
        throw new Error(`Unknown Journal NFC resend argument: ${argument}`);
    }
    const cases: ScenarioCase[] = [
        { name: "plain", independentIds: false },
        { name: "encrypted", independentIds: true },
    ];
    if (requested === "all") return cases;
    if (requested === "independent-ids") requested = "encrypted";
    const selected = cases.filter((candidate) => candidate.name === requested);
    if (selected.length === 0) throw new Error(`Unsupported Journal NFC resend case: ${requested}`);
    return selected;
}

async function allocatePort(excluded: ReadonlySet<number>): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const server = createServer();
        const port = await new Promise<number>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                const address = server.address();
                if (!address || typeof address === "string") {
                    reject(new Error("Could not allocate an Obsidian debugging port."));
                    return;
                }
                resolve(address.port);
            });
        });
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        if (!excluded.has(port)) return port;
    }
    throw new Error("Could not allocate distinct Obsidian debugging ports.");
}

async function createVaultNote(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    relativePath: string,
    content: string
): Promise<void> {
    await evalObsidianJson<boolean>(
        cliBinary,
        [
            "(async()=>{",
            "const path=" + JSON.stringify(relativePath.normalize("NFC")) + ";",
            "const content=" + JSON.stringify(content) + ";",
            "const parent=path.slice(0,path.lastIndexOf('/'));",
            "if(!(await app.vault.adapter.exists(parent)))await app.vault.createFolder(parent);",
            "await app.vault.create(path,content);",
            "await app.plugins.plugins['obsidian-livesync'].core.services.fileProcessing.commitPendingFileEvents();",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        environment,
        timeoutMs
    );
}

async function assertSinglePhysicalUnicodeFile(
    vaultPath: string,
    relativePath: string,
    expectedContent: string
): Promise<void> {
    const segments = relativePath.split("/");
    const stableParent = join(vaultPath, ...segments.slice(0, -2));
    const expectedFolder = segments[segments.length - 2].normalize("NFC");
    const expectedFilename = segments[segments.length - 1].normalize("NFC");
    const physicalFolders = (await readdir(stableParent, { withFileTypes: true })).filter(
        (entry) => entry.isDirectory() && entry.name.normalize("NFC") === expectedFolder
    );
    assertEqual(physicalFolders.length, 1, "NFC-equivalent folder spellings created duplicate physical folders.");
    const actualFolder = join(stableParent, physicalFolders[0].name);
    const matchingFiles = (await readdir(actualFolder)).filter((name) => name.normalize("NFC") === expectedFilename);
    assertEqual(matchingFiles.length, 1, "NFC-equivalent file spellings created duplicate physical files.");
    assertEqual(
        await readFile(join(actualFolder, matchingFiles[0]), "utf8"),
        expectedContent,
        "The ordinary NFC control file has unexpected bytes."
    );
}

async function waitForSinglePhysicalUnicodeFile(
    vaultPath: string,
    relativePath: string,
    expectedContent: string
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            await assertSinglePhysicalUnicodeFile(vaultPath, relativePath, expectedContent);
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
    throw new Error(
        `Timed out waiting for one NFC-equivalent physical file: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
}

async function makeScenarioSettings(scenario: ScenarioCase): Promise<ScenarioSettings> {
    return {
        pathNormalizationVersion: 1,
        ...(scenario.independentIds
            ? {
                  encrypt: true,
                  usePathObfuscation: true,
                  passphrase: randomBytes(32).toString("base64url"),
                  idDerivationVersion: 1,
                  idDerivationKey: await deriveIdKey(randomBytes(32).toString("base64url")),
              }
            : {}),
    };
}

async function startSession(
    binary: string,
    cliBinary: string,
    vault: TemporaryVault,
    port: number,
    storage: ObjectStorageConfig & { bucketPrefix: string },
    overrides: ScenarioSettings,
    configure: boolean
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary,
        cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        env: { E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(port) },
        ...(configure
            ? {
                  pluginData: createE2eObjectStoragePluginData(storage, { pathNormalizationVersion: 1 }),
                  localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
              }
            : {}),
    });
    try {
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv, timeoutMs);
        if (configure) {
            const configured = await configureObjectStorage(cliBinary, session.cliEnv, storage, overrides);
            assertEqual(configured.isConfigured, true, "Self-hosted LiveSync was not marked as configured.");
            assertEqual(configured.remoteType, "MINIO", "The configured remote was not Object Storage.");
            assertEqual(configured.bucket, storage.bucket, "The Object Storage bucket changed during configuration.");
            assertEqual(
                configured.bucketPrefix,
                storage.bucketPrefix,
                "The Object Storage prefix changed during configuration."
            );
            assertEqual(configured.liveSync, false, "LiveSync should remain disabled during the one-shot workflow.");
            await waitForLiveSyncCoreReady(cliBinary, session.cliEnv, timeoutMs);
        }
        return session;
    } catch (error) {
        await session.app.stop().catch((stopError: unknown) => {
            console.warn(stopError instanceof Error ? stopError.message : stopError);
        });
        throw error;
    }
}

function readTreeSource(path: string, expectedBaseRev: string, requireAncestorBody: boolean): string {
    return [
        "(async()=>{",
        `const path=${JSON.stringify(path)};`,
        `const expectedBaseRev=${JSON.stringify(expectedBaseRev)};`,
        `const requireAncestorBody=${JSON.stringify(requireAncestorBody)};`,
        "const core=app.plugins.plugins['obsidian-livesync'].core;",
        "const db=core.localDatabase;",
        "const readRevision=async(rev)=>{",
        "const metadata=await db.getDBEntryMeta(path,{rev,revs:true},true);",
        "const entry=await db.getDBEntry(path,{rev},false,true,true);",
        "if(!metadata||!entry) throw new Error('Could not read exact Metadata revision '+rev);",
        "const tree=metadata._revisions;",
        "if(!tree||!Number.isInteger(tree.start)||!Array.isArray(tree.ids)||tree.ids.length===0) throw new Error('Revision ancestry is unavailable for '+rev);",
        "const revisionTree={start:tree.start,ids:[...tree.ids]};",
        "const revisions=revisionTree.ids.map((id,index)=>`${revisionTree.start-index}-${id}`);",
        "const data=entry.data;",
        "const body=Array.isArray(data)?data.join(''):typeof data==='string'?data:data instanceof Blob?await data.text():null;",
        "if(typeof body!=='string') throw new Error('Could not decode exact revision body '+rev);",
        "const children=Array.isArray(metadata.children)?[...metadata.children]:Array.isArray(entry.children)?[...entry.children]:[];",
        "const rows=children.length?await db.allDocsRaw({keys:children,include_docs:true}):{rows:[]};",
        "const available=rows.rows.filter(row=>Boolean(row.doc)&&!Boolean(row.value?.deleted)&&!Boolean(row.doc?.deleted)&&!Boolean(row.doc?._deleted)).length;",
        "const chunksPresent=children.length>0&&available===children.length;",
        "if(!chunksPresent) throw new Error('Exact Metadata revision has missing referenced Chunks '+rev);",
        "return {rev:entry._rev,revisionTree,revisions,body,children,chunksPresent};",
        "};",
        "const current=await db.getDBEntryMeta(path,{conflicts:true},true);",
        "if(!current?._rev) throw new Error('Conflict Metadata is missing: '+path);",
        "const leafRevs=[current._rev,...(current._conflicts??[])].sort();",
        "const leaves=[];",
        "for(const rev of leafRevs) leaves.push(await readRevision(rev));",
        "let ancestor;let ancestorRev;let ancestorBodyAvailable=false;",
        "if(leaves.length>=2){",
        "const shared=leaves[0].revisions.filter(rev=>leaves.slice(1).every(leaf=>leaf.revisions.includes(rev)));",
        "if(shared.length===0) throw new Error('Conflict leaves have no exact shared revision ID.');",
        "ancestorRev=shared[0];",
        "if(ancestorRev!==expectedBaseRev) throw new Error('Nearest common revision did not match the seeded baseline.');",
        "const metadata=await db.getDBEntryMeta(path,{rev:ancestorRev,revs:true},true).catch(error=>{if(error?.status===404||error?.name==='not_found')return false;throw error;});",
        "if(metadata){ancestor=await readRevision(ancestorRev);ancestorBodyAvailable=true;}",
        "if(requireAncestorBody&&!ancestorBodyAvailable)throw new Error('The source lost its available common ancestor body.');",
        "}",
        "return JSON.stringify({id:current._id,path:current.path,leafRevs,leaves,ancestor,ancestorRev,ancestorBodyAvailable});",
        "})()",
    ].join("");
}

async function readConflictTree(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    expectedBaseRev: string,
    requireAncestorBody = true
): Promise<ConflictTreeSnapshot> {
    return await evalObsidianJson<ConflictTreeSnapshot>(
        cliBinary,
        readTreeSource(path, expectedBaseRev, requireAncestorBody),
        env,
        timeoutMs
    );
}

async function waitForConflictTree(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    expectedBaseRev: string,
    expectedBodies: readonly string[],
    requireAncestorBody = true
): Promise<ConflictTreeSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let last: ConflictTreeSnapshot | undefined;
    while (Date.now() < deadline) {
        try {
            last = await readConflictTree(cliBinary, env, path, expectedBaseRev, requireAncestorBody);
            const bodies = last.leaves.map((leaf) => leaf.body).sort();
            if (last.leafRevs.length === 2 && JSON.stringify(bodies) === JSON.stringify([...expectedBodies].sort())) {
                return last;
            }
        } catch (error) {
            if (Date.now() + 250 >= deadline) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for both exact conflict leaves: ${JSON.stringify(last)}`);
}

function assertSameConflictTree(actual: ConflictTreeSnapshot, expected: ConflictTreeSnapshot, label: string): void {
    assertEqual(actual.id, expected.id, `${label}: Metadata ID changed.`);
    assertEqual(
        JSON.stringify(actual.leafRevs),
        JSON.stringify(expected.leafRevs),
        `${label}: leaf revision IDs changed.`
    );
    assertEqual(
        JSON.stringify(
            actual.leaves.map(({ rev, revisionTree, body, children, chunksPresent }) => ({
                rev,
                revisionTree,
                body,
                children,
                chunksPresent,
            }))
        ),
        JSON.stringify(
            expected.leaves.map(({ rev, revisionTree, body, children, chunksPresent }) => ({
                rev,
                revisionTree,
                body,
                children,
                chunksPresent,
            }))
        ),
        `${label}: a leaf body, exact _revisions, or referenced Chunk changed.`
    );
    assertEqual(actual.ancestorRev, expected.ancestorRev, `${label}: the exact common ancestor changed.`);
    if (!actual.ancestorBodyAvailable) return;
    assertEqual(
        JSON.stringify(
            actual.ancestor && {
                revisionTree: actual.ancestor.revisionTree,
                revisions: actual.ancestor.revisions,
                body: actual.ancestor.body,
                children: actual.ancestor.children,
                chunksPresent: actual.ancestor.chunksPresent,
            }
        ),
        JSON.stringify(
            expected.ancestor && {
                revisionTree: expected.ancestor.revisionTree,
                revisions: expected.ancestor.revisions,
                body: expected.ancestor.body,
                children: expected.ancestor.children,
                chunksPresent: expected.ancestor.chunksPresent,
            }
        ),
        `${label}: the common ancestor body or its Chunks changed.`
    );
}

async function storeSourceLeaf(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    content: string,
    baseRev: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const file=app.vault.getFiles().find(candidate=>candidate.path.normalize('NFC')===path.normalize('NFC'));",
            "if(!file) throw new Error('Could not find the NFC-equivalent source file '+path);",
            "await app.vault.modify(file,content);",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const deadline=Date.now()+20000;",
            "const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));",
            "let entry=false;",
            "let stored=false;",
            "while(Date.now()<deadline){",
            "entry=await core.localDatabase.getDBEntry(path,undefined,false,true,true).catch(()=>false);",
            "const data=entry?.data;",
            "const body=Array.isArray(data)?data.join(''):typeof data==='string'?data:data instanceof Blob?await data.text():null;",
            `if(entry&&entry._rev!==${JSON.stringify(baseRev)}&&body===content){stored=true;break;}`,
            "await sleep(250);",
            "}",
            "if(!stored) throw new Error('The real Obsidian source edit did not create a child revision with the expected body.');",
            "const children=Array.isArray(entry.children)?entry.children:[];",
            "if(children.length===0) throw new Error('The real Obsidian source revision has no Chunks.');",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        env,
        timeoutMs
    );
}

async function storeCompetingLeaf(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    content: string,
    baseRev: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            `const baseRev=${JSON.stringify(baseRev)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "const blob=new Blob([content],{type:'text/plain'});",
            "const now=Date.now();",
            "const result=await core.localDatabase.putDBEntry({",
            "_id:id,path,data:blob,ctime:now,mtime:now,size:blob.size,children:[],datatype:'plain',type:'plain',eden:{},",
            "},false,baseRev);",
            "if(!result?.ok) throw new Error('Could not create the sibling conflict leaf from its exact baseline.');",
            "const entry=await core.localDatabase.getDBEntry(path,{rev:result.rev},false,true,true);",
            "if(!entry||!Array.isArray(entry.children)||entry.children.length===0) throw new Error('The sibling conflict leaf has no real Chunks.');",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        env,
        timeoutMs
    );
}

async function readTransferCheckpoint(cliBinary: string, env: NodeJS.ProcessEnv): Promise<TransferCheckpoint> {
    return await evalObsidianJson<TransferCheckpoint>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "const client=replicator?.client;",
            "if(!client||typeof client.getCheckpointInfo!=='function') throw new Error('The active Object Storage replicator did not expose its Journal checkpoint.');",
            "const info=await client.getCheckpointInfo();",
            "const values=value=>[...(value??[])].sort();",
            "return JSON.stringify({lastLocalSeq:info.lastLocalSeq,journalEpoch:info.journalEpoch,knownIDs:values(info.knownIDs),sentIDs:values(info.sentIDs),receivedFiles:values(info.receivedFiles),sentFiles:values(info.sentFiles)});",
            "})()",
        ].join(""),
        env,
        timeoutMs
    );
}

function assertCheckpointPopulated(checkpoint: TransferCheckpoint, tree: ConflictTreeSnapshot): void {
    if (checkpoint.sentFiles.length === 0 || checkpoint.sentIDs.length === 0) {
        throw new Error("The initial Journal transfer did not populate its persistent send checkpoint.");
    }
    const localSequence = checkpoint.lastLocalSeq;
    const sequenceIsPopulated =
        typeof localSequence === "number"
            ? Number.isFinite(localSequence) && localSequence > 0
            : typeof localSequence === "string" && localSequence.trim() !== "" && localSequence.trim() !== "0";
    assertEqual(
        sequenceIsPopulated,
        true,
        "The initial Journal transfer did not advance its local sequence checkpoint."
    );
    const sentIds = new Set(checkpoint.sentIDs);
    const expectedSentIds = tree.leaves.map((leaf) => `${tree.id}-${leaf.rev}`);
    for (const expectedId of expectedSentIds) {
        if (!sentIds.has(expectedId))
            throw new Error(`The Journal checkpoint does not record sent revision ${expectedId}.`);
    }
}

function assertIndependentIdShape(tree: ConflictTreeSnapshot): void {
    if (!/^f:[0-9a-f]{64}$/u.test(tree.id)) {
        throw new Error(`The encrypted case did not use an independent Metadata ID: ${tree.id}`);
    }
    for (const revision of [...tree.leaves, ...(tree.ancestor ? [tree.ancestor] : [])]) {
        if (revision.children.some((id) => !/^h:\+[0-9a-f]{64}$/u.test(id))) {
            throw new Error("The encrypted case did not use independent Chunk IDs.");
        }
    }
}

async function waitForJournalObjects(
    storage: ObjectStorageConfig,
    prefix: string,
    operationLabel: string
): Promise<string[]> {
    const milestoneKey = `${prefix}_00000000-milestone.json`;
    const deadline = Date.now() + objectTimeoutMs;
    let keys: string[] = [];
    while (Date.now() < deadline) {
        keys = (await listObjectStorageObjects(storage, prefix)).flatMap((object) => (object.Key ? [object.Key] : []));
        if (keys.includes(milestoneKey) && keys.some((key) => key.endsWith("-docs.jsonl.gz"))) return keys;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(
        `${operationLabel} did not create both the Journal milestone and document objects: ${keys.join(", ")}`
    );
}

async function verifySingleJournalRecovery(
    cliBinary: string,
    session: ObsidianLiveSyncSession,
    vaultPath: string,
    storage: ObjectStorageConfig,
    prefix: string,
    validJournalKey: string
): Promise<void> {
    const objects = await listObjectStorageObjects(storage, prefix);
    const timestamp =
        Math.max(Date.now(), ...objects.map(({ Key }) => Number(Key?.slice(prefix.length).split("-")[0]) || 0)) + 1;
    const firstKey = `${timestamp}-docs.jsonl.gz`;
    const secondKey = `${timestamp + 1}-docs.jsonl.gz`;
    const laterKey = `${timestamp + 2}-docs.jsonl.gz`;
    const validBytes = await readObjectStorageObject(storage, validJournalKey);
    const client = createObjectStorageClient(storage);
    try {
        for (const [key, bytes] of [
            [firstKey, new Uint8Array([1])],
            [secondKey, new Uint8Array([1])],
            [laterKey, validBytes],
        ] as const) {
            await client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: prefix + key, Body: bytes }));
        }
    } finally {
        client.destroy();
    }

    type RecoveryState = { key: string | null; stage: string | null; received: string[] };
    const readState = async (): Promise<RecoveryState> =>
        await evalObsidianJson<RecoveryState>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const replicator=core.services.replicator.getActiveReplicator();",
                "const stopped=replicator.getStoppedJournal();",
                "const checkpoint=await replicator.client.getCheckpointInfo();",
                "return JSON.stringify({key:stopped?.key??null,stage:stopped?.stage??null,received:[...checkpoint.receivedFiles]});",
                "})()",
            ].join(""),
            session.cliEnv,
            timeoutMs
        );
    const waitForState = async (expectedKey: string | null, expectedReceived: string[]): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        let state: RecoveryState | undefined;
        while (Date.now() < deadline) {
            state = await readState();
            if (state.key === expectedKey && expectedReceived.every((key) => state?.received.includes(key))) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`Journal recovery did not reach the expected state: ${JSON.stringify(state)}`);
    };
    const result = await evalObsidianJson<boolean>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "return JSON.stringify(await replicator.replicateAllFromServer(core.settings,true));",
            "})()",
        ].join(""),
        session.cliEnv,
        timeoutMs
    );
    assertEqual(result, false, "Receipt must stop at the first malformed Journal.");
    const initial = await readState();
    assertEqual(initial.key, firstKey, "The first failed Journal must be offered for recovery.");
    for (const key of [firstKey, secondKey, laterKey]) {
        assertEqual(initial.received.includes(key), false, "Failed and later Journals must remain unacknowledged.");
    }

    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const navigator = await openLiveSyncSettings(page, uiTimeoutMs);
        try {
            const maintenance = await navigator.openPage("Maintenance");
            assertEqual(
                await maintenance.getByText("Ignore broken journals (risk of data loss)", { exact: true }).count(),
                0,
                "The persistent skip toggle must not be offered."
            );
            const setting = maintenance.locator(".setting-item").filter({
                has: navigator.page.getByText("Skip stopped Journal and resume", { exact: true }),
            });
            await setting.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const choose = async (key: string, accept: boolean): Promise<void> => {
                await setting
                    .getByRole("button", { name: "Skip and resume", exact: true })
                    .click({ timeout: uiTimeoutMs });
                const dialogue = await waitForVisibleObsidianDialogue(page, key, uiTimeoutMs);
                const text = await dialogue.innerText();
                if (!text.includes(key) || !/missing/i.test(text)) {
                    throw new Error(
                        "The skip confirmation must identify the exact Journal and its missing-content risk."
                    );
                }
                await dialogue
                    .getByRole("button", { name: accept ? "Yes" : "No", exact: true })
                    .click({ timeout: uiTimeoutMs });
            };
            await choose(firstKey, false);
            assertEqual(
                JSON.stringify(await readState()),
                JSON.stringify(initial),
                "Cancelling must preserve the failure and checkpoint."
            );
            await choose(firstKey, true);
            await waitForState(secondKey, [firstKey]);
            const afterFirst = await readState();
            assertEqual(
                afterFirst.received.includes(secondKey),
                false,
                "One action must not skip the next failed Journal."
            );
            assertEqual(
                afterFirst.received.includes(laterKey),
                false,
                "Receipt must stop before the later valid Journal."
            );
            await choose(secondKey, true);
            await waitForState(null, [firstKey, secondKey, laterKey]);
        } finally {
            await navigator.close();
        }
    });
    const saved = JSON.parse(
        await readFile(join(vaultPath, ".obsidian/plugins/obsidian-livesync/data.json"), "utf8")
    ) as Record<string, unknown>;
    assertEqual("ignoreBrokenJournals" in saved, false, "Recovery must not persist a skip toggle.");
    console.log(
        "Journal recovery UI: cancellation preserved the checkpoint, each action skipped one named Journal, and the next failure stopped receipt."
    );
}

async function postponeConflictIfOpen(session: ObsidianLiveSyncSession): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const dialogue = page.locator(".modal-container:visible").filter({ hasText: "Conflicting changes" });
        if ((await dialogue.count()) === 0) return;
        const notNow = dialogue.getByRole("button", { name: "Not now", exact: true });
        if ((await notNow.count()) > 0) await notNow.click({ timeout: uiTimeoutMs });
    });
}

async function rebuildRemote(cliBinary: string, env: NodeJS.ProcessEnv, port: number): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(()=>{",
            "const rebuilder=app.plugins.plugins['obsidian-livesync'].core.rebuilder;",
            "const state={done:false,error:null};",
            "globalThis.__journalNfcRemoteRebuild=state;",
            "void Promise.resolve().then(()=>rebuilder.$rebuildRemote()).then(()=>{state.done=true;},error=>{state.error=String(error?.stack??error);});",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        env,
        timeoutMs
    );
    await withObsidianPage(port, async (page) => {
        const title = "All optional features are disabled";
        const deadline = Date.now() + timeoutMs;
        let acknowledged = false;
        while (Date.now() < deadline) {
            const state = await evalObsidianJson<{ done: boolean; error: string | null }>(
                cliBinary,
                "JSON.stringify(globalThis.__journalNfcRemoteRebuild)",
                env,
                timeoutMs
            );
            if (state.error) throw new Error(state.error);
            if (state.done) {
                if (!acknowledged) {
                    throw new Error(`Remote-only Rebuild finished without showing the '${title}' dialogue.`);
                }
                return;
            }
            if (!acknowledged) {
                for (const candidate of page.context().pages()) {
                    const dialogue = candidate
                        .locator(".modal-container")
                        .filter({ has: candidate.locator(".modal-title").filter({ hasText: title }) })
                        .last();
                    if (!(await dialogue.isVisible().catch(() => false))) continue;
                    await dialogue.getByRole("button", { name: "OK", exact: true }).click({ timeout: uiTimeoutMs });
                    await dialogue.waitFor({ state: "hidden", timeout: uiTimeoutMs });
                    acknowledged = true;
                    break;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const state = await evalObsidianJson<{ done: boolean; error: string | null }>(
            cliBinary,
            "JSON.stringify(globalThis.__journalNfcRemoteRebuild)",
            env,
            timeoutMs
        );
        if (state.error) throw new Error(state.error);
        throw new Error("Timed out waiting for remote-only Rebuild and its optional-features dialogue.");
    });
}

async function fetchIntoFreshVault(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const existing=await core.localDatabase.getDBEntry(path,undefined,false,true,true).catch(()=>false);",
            "if(existing) throw new Error('The fresh receiving database already contains the conflict Metadata.');",
            "await core.rebuilder.$fetchLocal(false,true);",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        env,
        timeoutMs
    );
}

async function runCase(
    binary: string,
    cliBinary: string,
    objectStorage: ObjectStorageConfig,
    scenario: ScenarioCase
): Promise<void> {
    const bucketPrefix = makeUniqueBucketPrefix(`journal-nfc-resend-${scenario.name}`);
    const storage = { ...objectStorage, bucketPrefix };
    const overrides = await makeScenarioSettings(scenario);
    const sourceVault = await createTemporaryVault(`obsidian-livesync-journal-nfc-source-${scenario.name}-`);
    let receiverVault: TemporaryVault | undefined;
    let sourceSession: ObsidianLiveSyncSession | undefined;
    let receiverSession: ObsidianLiveSyncSession | undefined;
    try {
        receiverVault = await createTemporaryVault(`obsidian-livesync-journal-nfc-receiver-${scenario.name}-`);
        const sourcePort = await allocatePort(new Set());
        const receiverPort = await allocatePort(new Set([sourcePort]));
        assertEqual(sourcePort === receiverPort, false, "Source and receiver Obsidian debugging ports must differ.");

        console.log(`Journal NFC resend case: ${scenario.name}`);
        console.log(`Temporary source and receiver Vaults: ${sourceVault.name}, ${receiverVault.name}`);
        console.log(`Temporary Object Storage prefix: ${bucketPrefix}`);
        sourceSession = await startSession(binary, cliBinary, sourceVault, sourcePort, storage, overrides, true);
        await prepareRemote(cliBinary, sourceSession.cliEnv);
        await createVaultNote(cliBinary, sourceSession.cliEnv, conflictPathNfd, baseContent);
        await createVaultNote(cliBinary, sourceSession.cliEnv, controlPathNfd, controlContent);
        await assertSinglePhysicalUnicodeFile(sourceVault.path, controlPathNfd, controlContent);

        const initialEntry: LocalDatabaseEntry = await waitForLocalDatabaseEntry(
            cliBinary,
            sourceSession.cliEnv,
            conflictPathNfc,
            {
                timeoutMs,
            }
        );
        if (!initialEntry.rev || initialEntry.children.length === 0) {
            throw new Error("The source baseline was not saved as a Chunk-backed Metadata revision.");
        }
        await storeSourceLeaf(cliBinary, sourceSession.cliEnv, conflictPathNfc, sourceLeafContent, initialEntry.rev);
        await storeCompetingLeaf(
            cliBinary,
            sourceSession.cliEnv,
            conflictPathNfc,
            competingLeafContent,
            initialEntry.rev
        );
        const sourceTree = await waitForConflictTree(
            cliBinary,
            sourceSession.cliEnv,
            conflictPathNfc,
            initialEntry.rev,
            [sourceLeafContent, competingLeafContent]
        );
        if (!sourceTree.ancestor || sourceTree.ancestor.rev !== initialEntry.rev) {
            throw new Error(
                "The two source leaves did not retain the exact available baseline as their nearest common ancestor."
            );
        }
        assertEqual(
            sourceTree.ancestor.body,
            baseContent,
            "The source conflict ancestor did not preserve the exact seeded baseline body."
        );
        await postponeConflictIfOpen(sourceSession);
        if (scenario.independentIds) {
            assertIndependentIdShape(sourceTree);
        } else {
            assertEqual(
                sourceTree.id,
                conflictPathNfc.toLowerCase(),
                "The plain case did not derive its Metadata ID from the NFC path."
            );
        }

        await pushLocalChanges(cliBinary, sourceSession.cliEnv);
        const initialKeys = await waitForJournalObjects(objectStorage, bucketPrefix, "Initial Journal upload");
        const initialCheckpoint = await readTransferCheckpoint(cliBinary, sourceSession.cliEnv);
        assertCheckpointPopulated(initialCheckpoint, sourceTree);
        await readObjectStorageJson<Record<string, unknown>>(objectStorage, `${bucketPrefix}_00000000-milestone.json`);
        await postponeConflictIfOpen(sourceSession);

        // Removing this fixture prefix leaves the source PouchDB tree and its device-local transfer checkpoint intact.
        await deleteObjectStoragePrefix(objectStorage, bucketPrefix);
        assertEqual(
            (await listObjectStorageObjects(objectStorage, bucketPrefix)).length,
            0,
            "The test's isolated Object Storage prefix was not empty after deletion."
        );
        assertEqual(
            JSON.stringify(await readTransferCheckpoint(cliBinary, sourceSession.cliEnv)),
            JSON.stringify(initialCheckpoint),
            "Deleting the remote fixture prefix changed the source transfer checkpoint."
        );
        assertSameConflictTree(
            await readConflictTree(cliBinary, sourceSession.cliEnv, conflictPathNfc, initialEntry.rev),
            sourceTree,
            "Source before remote-only Rebuild"
        );

        await rebuildRemote(cliBinary, sourceSession.cliEnv, sourceSession.remoteDebuggingPort);
        const rebuiltKeys = await waitForJournalObjects(objectStorage, bucketPrefix, "Remote-only Rebuild");
        await postponeConflictIfOpen(sourceSession);
        assertSameConflictTree(
            await readConflictTree(cliBinary, sourceSession.cliEnv, conflictPathNfc, initialEntry.rev),
            sourceTree,
            "Source after remote-only Rebuild"
        );
        if (scenario.independentIds) assertIndependentIdShape(sourceTree);
        await sourceSession.app.stop();
        sourceSession = undefined;

        receiverSession = await startSession(binary, cliBinary, receiverVault, receiverPort, storage, overrides, true);
        await fetchIntoFreshVault(cliBinary, receiverSession.cliEnv, conflictPathNfc);
        await waitForLiveSyncCoreReady(cliBinary, receiverSession.cliEnv, timeoutMs);
        await postponeConflictIfOpen(receiverSession);
        const receivedTree = await waitForConflictTree(
            cliBinary,
            receiverSession.cliEnv,
            conflictPathNfc,
            initialEntry.rev,
            [sourceLeafContent, competingLeafContent],
            false
        );
        await postponeConflictIfOpen(receiverSession);
        assertSameConflictTree(receivedTree, sourceTree, "Fresh receiver after Standard Fetch");
        await waitForSinglePhysicalUnicodeFile(receiverVault.path, controlPathNfd, controlContent);

        await receiverSession.app.stop();
        receiverSession = undefined;
        const restartPort = await allocatePort(new Set([sourcePort, receiverPort]));
        receiverSession = await startSession(binary, cliBinary, receiverVault, restartPort, storage, overrides, false);
        await waitForLiveSyncCoreReady(cliBinary, receiverSession.cliEnv, timeoutMs);
        await postponeConflictIfOpen(receiverSession);
        const restartedTree = await waitForConflictTree(
            cliBinary,
            receiverSession.cliEnv,
            conflictPathNfc,
            initialEntry.rev,
            [sourceLeafContent, competingLeafContent],
            false
        );
        await postponeConflictIfOpen(receiverSession);
        assertSameConflictTree(restartedTree, sourceTree, "Receiver after full Obsidian restart");
        assertEqual(
            restartedTree.ancestorBodyAvailable,
            receivedTree.ancestorBodyAvailable,
            "Restart changed the common ancestor body's availability."
        );
        await waitForSinglePhysicalUnicodeFile(receiverVault.path, controlPathNfd, controlContent);

        const validJournalKey = rebuiltKeys.find((key) => key.endsWith("-docs.jsonl.gz"));
        if (!validJournalKey) throw new Error("A valid Journal fixture is required for recovery testing.");
        await verifySingleJournalRecovery(
            cliBinary,
            receiverSession,
            receiverVault.path,
            objectStorage,
            bucketPrefix,
            validJournalKey
        );
        await postponeConflictIfOpen(receiverSession);
        assertSameConflictTree(
            await readConflictTree(cliBinary, receiverSession.cliEnv, conflictPathNfc, initialEntry.rev, false),
            sourceTree,
            "Receiver after explicit Journal skips"
        );
        await waitForSinglePhysicalUnicodeFile(receiverVault.path, controlPathNfd, controlContent);

        const initialJournalObjects = initialKeys.filter((key) => key.endsWith("-docs.jsonl.gz")).length;
        const rebuiltJournalObjects = rebuiltKeys.filter((key) => key.endsWith("-docs.jsonl.gz")).length;
        console.log(
            `Journal NFC resend ${scenario.name}: source checkpoint survived external prefix deletion, ${rebuiltJournalObjects} rebuilt Journal object(s), exact conflict leaves and ancestry fetched, and restart verified (initial objects: ${initialJournalObjects}; receiver ancestor body available: ${receivedTree.ancestorBodyAvailable}).`
        );
        console.log(
            "The history assertion covers this deliberately uncompacted fixture and does not claim arbitrary historical body availability."
        );
    } finally {
        if (receiverSession) {
            await receiverSession.app.stop().catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
        if (sourceSession) {
            await sourceSession.app.stop().catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
        await sourceVault.dispose().catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
        if (receiverVault) {
            await receiverVault.dispose().catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
        await deleteObjectStoragePrefix(objectStorage, bucketPrefix).catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
    }
}

async function main(): Promise<void> {
    const scenarios = selectedCases(process.argv.slice(2));
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    const objectStorage = await loadObjectStorageConfig();
    await ensureObjectStorageBucket(objectStorage);
    for (const scenario of scenarios) await runCase(binary, cli.binary, objectStorage, scenario);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
