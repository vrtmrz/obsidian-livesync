import { sizeToHumanReadable } from "octagonal-wheels/number";
import { serialized } from "octagonal-wheels/concurrency/lock_v2";
import { arrayToChunkedArray } from "octagonal-wheels/collection";
import { getNoFromRev } from "@lib/pouchdb/LiveSyncLocalDB.ts";
import type { LiveSyncCouchDBReplicator } from "@lib/replication/couchdb/LiveSyncReplicator.ts";
import { isNotFoundError } from "@lib/common/utils.doc.ts";
import {
    EntryTypes,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type EntryDoc,
    type EntryLeaf,
    type MetaEntry,
} from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
import { isGCAvailable, confirmDialogue, retrieveAllChunks, createProgressBar } from "./utils.ts";
import { compactDatabase } from "./compaction.ts";

const DB_KEY_SEQ = "gc-seq";
const DB_KEY_CHUNK_SET = "chunk-set";
const DB_KEY_DOC_USAGE_MAP = "doc-usage-map";

type ChunkID = DocumentID;
type NoteDocumentID = DocumentID;
type Rev = string;

type ChunkUsageMap = Map<NoteDocumentID, Map<Rev, Set<ChunkID>>>;

/**
 * Resurrects deleted chunks that are still referenced and used by files in the database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function resurrectChunks(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    const db = host.services.database.localDatabase.localDatabase;
    const localDb = host.services.database.localDatabase;

    const { used, existing } = await retrieveAllChunks(host, log, true);
    const excessiveDeletions = [...existing]
        .filter(([, e]) => e._deleted)
        .filter(([, e]) => used.has(e._id))
        .map(([, e]) => e);
    const completelyLostChunks: string[] = [];
    const dataLostChunks = [...existing]
        .filter(([, e]) => e._deleted && e.data === "")
        .map(([, e]) => e)
        .filter((e) => used.has(e._id));

    for (const e of dataLostChunks) {
        const doc = await db.get(e._id, { rev: e._rev, revs: true, revs_info: true, conflicts: true });
        const history = doc._revs_info || [];
        let resurrected: string | null = null;
        const availableRevs = history
            .filter((rev) => rev.status === "available")
            .map((rev) => rev.rev)
            .sort((a, b) => getNoFromRev(a) - getNoFromRev(b));

        for (const rev of availableRevs) {
            const revDoc = await db.get(e._id, { rev });
            if (revDoc.type === "leaf" && revDoc.data !== "") {
                resurrected = revDoc.data;
                break;
            }
        }

        if (resurrected !== null) {
            excessiveDeletions.push({ ...e, data: resurrected, _deleted: false });
        } else {
            completelyLostChunks.push(e._id);
        }
    }

    const resurrectList = excessiveDeletions.filter((e) => e.data !== "").map((e) => ({ ...e, _deleted: false }));

    if (resurrectList.length === 0) {
        log("No chunks are found to be resurrected.", LOG_LEVEL_NOTICE);
        return;
    }

    const message = `We have following chunks that are deleted but still used in the database.

- Completely lost chunks: ${completelyLostChunks.length}
- Resurrectable chunks: ${resurrectList.length}

Do you want to resurrect these chunks?`;

    if (await confirmDialogue(host, "Resurrect Chunks", message, "Resurrect", "Cancel")) {
        const result = await db.bulkDocs(resurrectList);
        localDb.clearCaches();
        const resurrectedChunks = result.filter((r) => "ok" in r).map((r) => r.id);
        log(`Resurrected chunks: ${resurrectedChunks.length} / ${resurrectList.length}`, LOG_LEVEL_NOTICE);
    } else {
        log("Resurrect operation is cancelled.", LOG_LEVEL_NOTICE);
    }
}

/**
 * Commits the deletion of files marked as deleted, removing them permanently from the database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function commitFileDeletion(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    const db = host.services.database.localDatabase.localDatabase;
    const localDb = host.services.database.localDatabase;

    const progress = createProgressBar(log, "");
    progress.log("Searching for deleted files..");
    const docs = await db.allDocs<MetaEntry>({ include_docs: true });
    const deletedDocs = docs.rows.filter(
        (e) => (e.doc?.type === "newnote" || e.doc?.type === "plain") && e.doc?.deleted
    );

    if (deletedDocs.length === 0) {
        progress.done("No deleted files found.");
        return;
    }
    progress.log(`Found ${deletedDocs.length} deleted files.`);

    const message = `We have following files that are marked as deleted.

- Deleted files: ${deletedDocs.length}

Are you sure to delete these files permanently?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation affects the database permanently. Deleted files will not be recovered after this operation.
> And, the chunks that are used in the deleted files will be ready for compaction.`;

    const deletingDocs = deletedDocs.map((e) => ({ ...e.doc, _deleted: true }) as MetaEntry);

    if (await confirmDialogue(host, "Delete Files", message, "Delete", "Cancel")) {
        const result = await db.bulkDocs(deletingDocs);
        localDb.clearCaches();
        progress.done(`Deleted ${result.filter((r) => "ok" in r).length} / ${deletedDocs.length} files.`);
    } else {
        progress.done("Deletion operation is cancelled.");
    }
}

/**
 * Permanently deletes chunks already marked as deleted.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function commitChunkDeletion(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    const db = host.services.database.localDatabase.localDatabase;
    const localDb = host.services.database.localDatabase;

    const { existing } = await retrieveAllChunks(host, log, true);
    const deletedChunks = [...existing].filter(([, e]) => e._deleted && e.data !== "").map(([, e]) => e);
    const deletedNotVacantChunks = deletedChunks.map((e) => ({ ...e, data: "", _deleted: true }));
    const size = deletedChunks.reduce((acc, e) => acc + e.data.length, 0);
    const humanSize = sizeToHumanReadable(size);

    if (deletedNotVacantChunks.length === 0) {
        log("No deleted chunks found.", LOG_LEVEL_NOTICE);
        return;
    }

    const message = `We have following chunks that are marked as deleted.

- Deleted chunks: ${deletedNotVacantChunks.length} (${humanSize})

Are you sure to delete these chunks permanently?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation finally reduces the capacity of the remote.`;

    if (await confirmDialogue(host, "Delete Chunks", message, "Delete", "Cancel")) {
        const result = await db.bulkDocs(deletedNotVacantChunks);
        localDb.clearCaches();
        log(
            `Deleted chunks: ${result.filter((r) => "ok" in r).length} / ${deletedNotVacantChunks.length}`,
            LOG_LEVEL_NOTICE
        );
    } else {
        log("Deletion operation is cancelled.", LOG_LEVEL_NOTICE);
    }
}

/**
 * Marks chunks that are not referenced by any files in the database as deleted.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function markUnusedChunks(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    const db = host.services.database.localDatabase.localDatabase;
    const localDb = host.services.database.localDatabase;

    const { used, existing } = await retrieveAllChunks(host, log);
    const unusedChunks = [...existing].filter(([, e]) => !used.has(e._id)).map(([, e]) => e);
    const deleteChunks = unusedChunks.map((e) => ({
        ...e,
        _deleted: true,
    }));
    const size = deleteChunks.reduce((acc, e) => acc + e.data.length, 0);
    const humanSize = sizeToHumanReadable(size);

    if (deleteChunks.length === 0) {
        log("No unused chunks found.", LOG_LEVEL_NOTICE);
        return;
    }

    const message = `We have following chunks that are not used from any files.

- Chunks: ${deleteChunks.length} (${humanSize})

Are you sure to mark these chunks to be deleted?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation will not reduces the capacity of the remote until permanent deletion.`;

    if (await confirmDialogue(host, "Mark unused chunks", message, "Mark", "Cancel")) {
        const result = await db.bulkDocs(deleteChunks);
        localDb.clearCaches();
        log(`Marked chunks: ${result.filter((r) => "ok" in r).length} / ${deleteChunks.length}`, LOG_LEVEL_NOTICE);
    }
}

/**
 * Directly removes unused chunks from the local database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function removeUnusedChunks(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    const db = host.services.database.localDatabase.localDatabase;
    const localDb = host.services.database.localDatabase;

    const { used, existing } = await retrieveAllChunks(host, log);
    const unusedChunks = [...existing].filter(([, e]) => !used.has(e._id)).map(([, e]) => e);
    const deleteChunks = unusedChunks.map((e) => ({
        ...e,
        data: "",
        _deleted: true,
    }));
    const size = unusedChunks.reduce((acc, e) => acc + e.data.length, 0);
    const humanSize = sizeToHumanReadable(size);

    if (deleteChunks.length === 0) {
        log("No unused chunks found.", LOG_LEVEL_NOTICE);
        return;
    }

    const message = `We have following chunks that are not used from any files.

- Chunks: ${deleteChunks.length} (${humanSize})

Are you sure to delete these chunks?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> Chunks referenced from deleted files are not deleted. Please run "Commit File Deletion" before this operation.`;

    if (await confirmDialogue(host, "Mark unused chunks", message, "Mark", "Cancel")) {
        const result = await db.bulkDocs(deleteChunks);
        log(`Deleted chunks: ${result.filter((r) => "ok" in r).length} / ${deleteChunks.length}`, LOG_LEVEL_NOTICE);
        localDb.clearCaches();
    }
}

/**
 * Scans key-value store logs to calculate unused chunks.
 *
 * @param host - The service container host.
 * @returns Scan summary.
 */
export async function scanUnusedChunks(host: DatabaseMaintenanceHost) {
    const kvDB = host.services.keyValueDB.kvDB;
    const chunkSet = (await kvDB.get<Set<DocumentID>>(DB_KEY_CHUNK_SET)) || new Set();
    const chunkUsageMap = (await kvDB.get<ChunkUsageMap>(DB_KEY_DOC_USAGE_MAP)) || new Map();
    const KEEP_MAX_REVS = 10;
    const unusedSet = new Set<DocumentID>([...chunkSet]);

    for (const [, revIdMap] of chunkUsageMap) {
        const sortedRevId = [...revIdMap.entries()].sort((a, b) => getNoFromRev(b[0]) - getNoFromRev(a[0]));
        const keepRevID = sortedRevId.slice(0, KEEP_MAX_REVS);
        keepRevID.forEach((e) => e[1].forEach((ee) => unusedSet.delete(ee)));
    }
    return {
        chunkSet,
        chunkUsageMap,
        unusedSet,
    };
}

/**
 * Tracks database changes to maintain the chunk usage map cache.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param fromStart - Whether to force scan from the beginning of sequence.
 * @param showNotice - Whether to show log notices to user.
 */
export async function trackChanges(
    host: DatabaseMaintenanceHost,
    log: LogFunction,
    fromStart: boolean = false,
    showNotice: boolean = false
): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    const logLevel = showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
    const kvDB = host.services.keyValueDB.kvDB;

    const previousSeq = fromStart ? "" : await kvDB.get<string>(DB_KEY_SEQ);
    const chunkSet = (await kvDB.get<Set<DocumentID>>(DB_KEY_CHUNK_SET)) || new Set();
    const chunkUsageMap = (await kvDB.get<ChunkUsageMap>(DB_KEY_DOC_USAGE_MAP)) || new Map();

    const db = host.services.database.localDatabase.localDatabase;

    const processDoc = async (doc: EntryDoc, isDeleted: boolean) => {
        if (!("children" in doc)) {
            return;
        }
        const id = doc._id;
        const rev = doc._rev!;
        const deleted = doc._deleted || isDeleted;
        const softDeleted = doc.deleted;
        const children = (doc.children || []) as DocumentID[];
        if (!chunkUsageMap.has(id)) {
            chunkUsageMap.set(id, new Map<Rev, Set<ChunkID>>());
        }
        for (const chunkId of children) {
            if (deleted) {
                chunkUsageMap.get(id)!.delete(rev);
            } else {
                chunkUsageMap.get(id)!.set(rev, (chunkUsageMap.get(id)!.get(rev) || new Set()).add(chunkId));
            }
        }
        log(
            `Tracking chunk: ${id}/${rev} (${doc?.path}), deleted: ${deleted ? "yes" : "no"} Soft-Deleted:${softDeleted ? "yes" : "no"}`,
            LOG_LEVEL_VERBOSE
        );
        return await Promise.resolve();
    };

    const saveState = async (seq: string | number) => {
        await kvDB.set(DB_KEY_SEQ, seq);
        await kvDB.set(DB_KEY_CHUNK_SET, chunkSet);
        await kvDB.set(DB_KEY_DOC_USAGE_MAP, chunkUsageMap);
    };

    const processDocRevisions = async (doc: EntryDoc) => {
        try {
            const oldRevisions = await db.get(doc._id, { revs: true, revs_info: true, conflicts: true });
            const allRevs = oldRevisions._revs_info?.length || 0;
            const info = (oldRevisions._revs_info || [])
                .filter((e) => e.status === "available" && e.rev !== doc._rev)
                .filter((info) => !chunkUsageMap.get(doc._id)?.has(info.rev));
            const infoLength = info.length;
            log(`Found ${allRevs} old revisions for ${doc._id} . ${infoLength} items to check `, LOG_LEVEL_INFO);
            if (info.length > 0) {
                const oldDocs = await Promise.all(
                    info
                        .filter((revInfo) => revInfo.status === "available")
                        .map((revInfo) => db.get(doc._id, { rev: revInfo.rev }))
                ).then((docs) => docs.filter((d) => d));
                for (const oldDoc of oldDocs) {
                    await processDoc(oldDoc, false);
                }
            }
        } catch (ex) {
            if (isNotFoundError(ex)) {
                log(`No revisions found for ${doc._id}`, LOG_LEVEL_VERBOSE);
            } else {
                log(`Error finding revisions for ${doc._id}`, LOG_LEVEL_INFO);
                log(ex, LOG_LEVEL_VERBOSE);
            }
        }
    };

    const processChange = async (doc: EntryDoc, isDeleted: boolean) => {
        if (doc.type === EntryTypes.CHUNK) {
            if (isDeleted) return;
            chunkSet.add(doc._id);
        } else if ("children" in doc) {
            await processDoc(doc, isDeleted);
            await serialized("x-process-doc", async () => await processDocRevisions(doc));
        }
    };

    let i = 0;
    await db
        .changes({
            since: previousSeq || "",
            live: false,
            conflicts: true,
            include_docs: true,
            style: "all_docs",
            return_docs: false,
        })
        .on("change", async (change) => {
            await processChange(change.doc!, change.deleted ?? false);
            if (i++ % 100 === 0) {
                await saveState(change.seq);
            }
        })
        .on("complete", async (info) => {
            await saveState(info.last_seq);
        });

    const result = await scanUnusedChunks(host);
    const message = `Total chunks: ${result.chunkSet.size}\nUnused chunks: ${result.unusedSet.size}`;
    log(message, logLevel);
}

/**
 * Perfroms the legacy Garbage Collection process, scanning and removing unreferenced chunks.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param showingNotice - Whether to show log notices to user.
 */
export async function performGC(
    host: DatabaseMaintenanceHost,
    log: LogFunction,
    showingNotice: boolean = false
): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    await trackChanges(host, log, false, showingNotice);
    const title = "Are all devices synchronised?";
    const confirmMessage = `This function deletes unused chunks from the device. If there are differences between devices, some chunks may be missing when resolving conflicts.
Be sure to synchronise before executing.

However, if you have deleted them, you may be able to recover them by performing Hatch -> Recreate missing chunks for all files.

Are you ready to delete unused chunks?`;

    const logLevel = showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;

    const BUTTON_OK = `Yes, delete chunks`;
    const BUTTON_CANCEL = "Cancel";

    const result = await host.services.UI.confirm.askSelectStringDialogue(
        confirmMessage,
        [BUTTON_OK, BUTTON_CANCEL] as const,
        {
            title,
            defaultAction: BUTTON_CANCEL,
        }
    );
    if (result !== BUTTON_OK) {
        log("User cancelled chunk deletion", logLevel);
        return;
    }
    const { unusedSet, chunkSet } = await scanUnusedChunks(host);
    const db = host.services.database.localDatabase.localDatabase;

    const deleteChunks = await db.allDocs({
        keys: [...unusedSet],
        include_docs: true,
    });
    for (const chunk of deleteChunks.rows) {
        if ((chunk as any)?.value?.deleted) {
            chunkSet.delete(chunk.key as DocumentID);
        }
    }
    const deleteDocs = deleteChunks.rows
        .filter((e) => "doc" in e)
        .map((e) => ({
            ...(e as { doc?: EntryLeaf }).doc!,
            _deleted: true,
        }));

    log(`Deleting chunks: ${deleteDocs.length}`, logLevel);
    const deleteChunkBatch = arrayToChunkedArray(deleteDocs, 100);
    let successCount = 0;
    let errored = 0;
    for (const batch of deleteChunkBatch) {
        const results = await db.bulkDocs(batch);
        for (const r of results) {
            if ("ok" in r) {
                chunkSet.delete(r.id as DocumentID);
                successCount++;
            } else {
                log(`Failed to delete doc: ${r.id}`, LOG_LEVEL_VERBOSE);
                errored++;
            }
        }
        log(`Deleting chunks: ${successCount} `, logLevel, "gc-preforming");
    }
    const message = `Garbage Collection completed.
Success: ${successCount}, Errored: ${errored}`;
    log(message, logLevel);
    const kvDB = host.services.keyValueDB.kvDB;
    await kvDB.set(DB_KEY_CHUNK_SET, chunkSet);
}

/**
 * Runs Garbage Collection V3, which validates synchronization progress across connected nodes before deleting.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function gcv3(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    const settings = host.services.setting.currentSettings();
    const replicator = host.services.replicator.getActiveReplicator() as LiveSyncCouchDBReplicator;
    if (!replicator) {
        log("No active replicator found for Garbage Collection.", LOG_LEVEL_NOTICE);
        return;
    }
    const r0 = await replicator.openOneShotReplication(settings, false, false, "sync");
    if (!r0) {
        log(
            "Failed to start one-shot replication before Garbage Collection. Garbage Collection Cancelled.",
            LOG_LEVEL_NOTICE
        );
        return;
    }

    const OPTION_CANCEL = "Cancel Garbage Collection";
    const info = await replicator.getConnectedDeviceList();
    if (!info) {
        log("No connected device information found. Cancelling Garbage Collection.", LOG_LEVEL_NOTICE);
        return;
    }
    const { accepted_nodes, node_info } = info;
    const infoMissingNodes: string[] = [];
    for (const node of accepted_nodes) {
        if (!(node in node_info)) {
            infoMissingNodes.push(node);
        }
    }
    if (infoMissingNodes.length > 0) {
        const message = `The following accepted nodes are missing its node information:\n- ${infoMissingNodes.join("\n- ")}\n\nThis indicates that they have not been connected for some time or have been left on an older version.
It is preferable to update all devices if possible. If you have any devices that are no longer in use, you can clear all accepted nodes by locking the remote once.`;

        const OPTION_IGNORE = "Ignore and Proceed";
        const buttons = [OPTION_CANCEL, OPTION_IGNORE] as const;
        const result = await host.services.UI.confirm.askSelectStringDialogue(message, buttons, {
            title: "Node Information Missing",
            defaultAction: OPTION_CANCEL,
        });
        if (result === OPTION_CANCEL) {
            log("Garbage Collection cancelled by user.", LOG_LEVEL_NOTICE);
            return;
        } else if (result === OPTION_IGNORE) {
            log("Proceeding with Garbage Collection, ignoring missing nodes.", LOG_LEVEL_NOTICE);
        }
    }

    const progressValues = Object.values(node_info)
        .map((e) => e.progress.split("-")[0])
        .map((e) => parseInt(e));
    const maxProgress = Math.max(...progressValues);
    const minProgress = Math.min(...progressValues);
    const progressDifference = maxProgress - minProgress;
    const OPTION_PROCEED = "Proceed Garbage Collection";

    const detail = `> [!INFO]- The connected devices have been detected as follows:
${Object.entries(node_info)
    .map(
        ([nodeId, nodeData]) =>
            `> - Device: ${nodeData.device_name} (Node ID: ${nodeId})
>   - Obsidian version: ${nodeData.app_version}
>   - Plug-in version: ${nodeData.plugin_version}
>   - Progress: ${nodeData.progress.split("-")[0]}`
    )
    .join("\n")}
`;
    const message =
        progressDifference !== 0
            ? `Some devices have differing progress values (max: ${maxProgress}, min: ${minProgress}).
This may indicate that some devices have not completed synchronisation, which could lead to conflicts. Strongly recommend confirming that all devices are synchronised before proceeding.`
            : `All devices have the same progress value (${maxProgress}). Your devices seem to be synchronised. And be able to proceed with Garbage Collection.`;
    const buttons = [OPTION_PROCEED, OPTION_CANCEL] as const;
    const defaultAction = progressDifference !== 0 ? OPTION_CANCEL : OPTION_PROCEED;
    const result = await host.services.UI.confirm.askSelectStringDialogue(message + "\n\n" + detail, buttons, {
        title: "Garbage Collection Confirmation",
        defaultAction,
    });
    if (result !== OPTION_PROCEED) {
        log("Garbage Collection cancelled by user.", LOG_LEVEL_NOTICE);
        return;
    }
    log("Proceeding with Garbage Collection.", LOG_LEVEL_NOTICE);

    const gcStartTime = Date.now();
    const localDatabase = host.services.database.localDatabase.localDatabase;
    const localDb = host.services.database.localDatabase;
    const usedChunks = new Set<DocumentID>();
    const allChunks = new Map<DocumentID, string>();

    const IDs = localDb.findEntryNames("", "", {});
    let i = 0;
    const doc_count = (await localDatabase.info()).doc_count;
    for await (const id of IDs) {
        const doc = await localDb.getRaw(id as DocumentID);
        i++;
        if (i % 100 === 0) {
            log(`Garbage Collection: Scanned ${i} / ~${doc_count} `, LOG_LEVEL_NOTICE, "gc-scanning");
        }
        if (!doc) continue;
        if ("children" in doc) {
            const children = (doc.children || []) as DocumentID[];
            for (const chunkId of children) {
                usedChunks.add(chunkId);
            }
        } else if (doc.type === EntryTypes.CHUNK) {
            allChunks.set(doc._id, doc._rev);
        }
    }
    log(
        `Garbage Collection: Scanning completed. Total chunks: ${allChunks.size}, Used chunks: ${usedChunks.size}`,
        LOG_LEVEL_NOTICE,
        "gc-scanning"
    );

    const unusedChunks = [...allChunks.keys()].filter((e) => !usedChunks.has(e));
    log(`Garbage Collection: Found ${unusedChunks.length} unused chunks to delete.`, LOG_LEVEL_NOTICE, "gc-scanning");
    const deleteChunkDocs = unusedChunks.map(
        (chunkId) =>
            ({
                _id: chunkId,
                _deleted: true,
                _rev: allChunks.get(chunkId),
            }) as EntryLeaf
    );
    const response = await localDatabase.bulkDocs(deleteChunkDocs);
    const deletedCount = response.filter((e) => "ok" in e).length;
    const gcEndTime = Date.now();
    log(
        `Garbage Collection completed. Deleted chunks: ${deletedCount} / ${unusedChunks.length}. Time taken: ${(gcEndTime - gcStartTime) / 1000} seconds.`,
        LOG_LEVEL_NOTICE
    );

    const r = await replicator.openOneShotReplication(settings, false, false, "pushOnly");
    if (!r) {
        log("Failed to start replication after Garbage Collection.", LOG_LEVEL_NOTICE);
        return;
    }
    await compactDatabase(host, log);
    localDb.clearCaches();
}
