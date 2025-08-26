import { sizeToHumanReadable } from "octagonal-wheels/number";
import {
    EntryTypes,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type EntryDoc,
    type EntryLeaf,
    type MetaEntry,
} from "../../lib/src/common/types";
import { getNoFromRev } from "../../lib/src/pouchdb/LiveSyncLocalDB";
import type { IObsidianModule } from "../../modules/AbstractObsidianModule";
import { LiveSyncCommands } from "../LiveSyncCommands";
import { serialized } from "octagonal-wheels/concurrency/lock_v2";
import { arrayToChunkedArray } from "octagonal-wheels/collection";
const DB_KEY_SEQ = "gc-seq";
const DB_KEY_CHUNK_SET = "chunk-set";
const DB_KEY_DOC_USAGE_MAP = "doc-usage-map";
type ChunkID = DocumentID;
type NoteDocumentID = DocumentID;
type Rev = string;

type ChunkUsageMap = Map<NoteDocumentID, Map<Rev, Set<ChunkID>>>;
export class LocalDatabaseMaintenance extends LiveSyncCommands implements IObsidianModule {
    $everyOnload(): Promise<boolean> {
        return Promise.resolve(true);
    }
    onunload(): void {
        // NO OP.
    }
    onload(): void | Promise<void> {
        // NO OP.
    }
    async allChunks(includeDeleted: boolean = false) {
        const p = this._progress("", LOG_LEVEL_NOTICE);
        p.log("Retrieving chunks informations..");
        try {
            const ret = await this.localDatabase.allChunks(includeDeleted);
            return ret;
        } finally {
            p.done();
        }
    }
    get database() {
        return this.localDatabase.localDatabase;
    }
    clearHash() {
        this.localDatabase.clearCaches();
    }

    async confirm(title: string, message: string, affirmative = "Yes", negative = "No") {
        return (
            (await this.plugin.confirm.askSelectStringDialogue(message, [affirmative, negative], {
                title,
                defaultAction: affirmative,
            })) === affirmative
        );
    }
    isAvailable() {
        if (!this.settings.doNotUseFixedRevisionForChunks) {
            this._notice("Please enable 'Compute revisions for chunks' in settings to use Garbage Collection.");
            return false;
        }
        if (this.settings.readChunksOnline) {
            this._notice("Please disable 'Read chunks online' in settings to use Garbage Collection.");
            return false;
        }
        return true;
    }
    /**
     * Resurrect deleted chunks that are still used in the database.
     */
    async resurrectChunks() {
        if (!this.isAvailable()) return;
        const { used, existing } = await this.allChunks(true);
        const excessiveDeletions = [...existing]
            .filter(([key, e]) => e._deleted)
            .filter(([key, e]) => used.has(e._id))
            .map(([key, e]) => e);
        const completelyLostChunks = [] as string[];
        // Data lost chunks : chunks that are deleted and data is purged.
        const dataLostChunks = [...existing]
            .filter(([key, e]) => e._deleted && e.data === "")
            .map(([key, e]) => e)
            .filter((e) => used.has(e._id));
        for (const e of dataLostChunks) {
            // Retrieve the data from the previous revision.
            const doc = await this.database.get(e._id, { rev: e._rev, revs: true, revs_info: true, conflicts: true });
            const history = doc._revs_info || [];
            // Chunks are immutable. So, we can resurrect the chunk by copying the data from any of previous revisions.
            let resurrected = null as null | string;
            const availableRevs = history
                .filter((e) => e.status == "available")
                .map((e) => e.rev)
                .sort((a, b) => getNoFromRev(a) - getNoFromRev(b));
            for (const rev of availableRevs) {
                const revDoc = await this.database.get(e._id, { rev: rev });
                if (revDoc.type == "leaf" && revDoc.data !== "") {
                    // Found the data.
                    resurrected = revDoc.data;
                    break;
                }
            }
            // If the data is not found, we cannot resurrect the chunk, add it to the excessiveDeletions.
            if (resurrected !== null) {
                excessiveDeletions.push({ ...e, data: resurrected, _deleted: false });
            } else {
                completelyLostChunks.push(e._id);
            }
        }
        // Chunks to be resurrected.
        const resurrectChunks = excessiveDeletions.filter((e) => e.data !== "").map((e) => ({ ...e, _deleted: false }));

        if (resurrectChunks.length == 0) {
            this._notice("No chunks are found to be resurrected.");
            return;
        }
        const message = `We have following chunks that are deleted but still used in the database.

- Completely lost chunks: ${completelyLostChunks.length}
- Resurrectable chunks: ${resurrectChunks.length}

Do you want to resurrect these chunks?`;
        if (await this.confirm("Resurrect Chunks", message, "Resurrect", "Cancel")) {
            const result = await this.database.bulkDocs(resurrectChunks);
            this.clearHash();
            const resurrectedChunks = result.filter((e) => "ok" in e).map((e) => e.id);
            this._notice(`Resurrected chunks: ${resurrectedChunks.length} / ${resurrectChunks.length}`);
        } else {
            this._notice("Resurrect operation is cancelled.");
        }
    }
    /**
     * Commit deletion of files that are marked as deleted.
     * This method makes the deletion permanent, and the files will not be recovered.
     * After this, chunks that are used in the deleted files become ready for compaction.
     */
    async commitFileDeletion() {
        if (!this.isAvailable()) return;
        const p = this._progress("", LOG_LEVEL_NOTICE);
        p.log("Searching for deleted files..");
        const docs = await this.database.allDocs<MetaEntry>({ include_docs: true });
        const deletedDocs = docs.rows.filter(
            (e) => (e.doc?.type == "newnote" || e.doc?.type == "plain") && e.doc?.deleted
        );
        if (deletedDocs.length == 0) {
            p.done("No deleted files found.");
            return;
        }
        p.log(`Found ${deletedDocs.length} deleted files.`);

        const message = `We have following files that are marked as deleted.

- Deleted files: ${deletedDocs.length}

Are you sure to delete these files permanently?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation affects the database permanently. Deleted files will not be recovered after this operation.
> And, the chunks that are used in the deleted files will be ready for compaction.`;

        const deletingDocs = deletedDocs.map((e) => ({ ...e.doc, _deleted: true }) as MetaEntry);

        if (await this.confirm("Delete Files", message, "Delete", "Cancel")) {
            const result = await this.database.bulkDocs(deletingDocs);
            this.clearHash();
            p.done(`Deleted ${result.filter((e) => "ok" in e).length} / ${deletedDocs.length} files.`);
        } else {
            p.done("Deletion operation is cancelled.");
        }
    }
    /**
     * Commit deletion of chunks that are not used in the database.
     * This method makes the deletion permanent, and the chunks will not be recovered if the database run compaction.
     * After this, the database can shrink the database size by compaction.
     * It is recommended to compact the database after this operation (History should be kept once before compaction).
     */
    async commitChunkDeletion() {
        if (!this.isAvailable()) return;
        const { existing } = await this.allChunks(true);
        const deletedChunks = [...existing].filter(([key, e]) => e._deleted && e.data !== "").map(([key, e]) => e);
        const deletedNotVacantChunks = deletedChunks.map((e) => ({ ...e, data: "", _deleted: true }));
        const size = deletedChunks.reduce((acc, e) => acc + e.data.length, 0);
        const humanSize = sizeToHumanReadable(size);
        const message = `We have following chunks that are marked as deleted.

- Deleted chunks: ${deletedNotVacantChunks.length} (${humanSize})

Are you sure to delete these chunks permanently?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation finally reduces the capacity of the remote.`;

        if (deletedNotVacantChunks.length == 0) {
            this._notice("No deleted chunks found.");
            return;
        }
        if (await this.confirm("Delete Chunks", message, "Delete", "Cancel")) {
            const result = await this.database.bulkDocs(deletedNotVacantChunks);
            this.clearHash();
            this._notice(
                `Deleted chunks: ${result.filter((e) => "ok" in e).length} / ${deletedNotVacantChunks.length}`
            );
        } else {
            this._notice("Deletion operation is cancelled.");
        }
    }
    /**
     * Compact the database.
     * This method removes all deleted chunks that are not used in the database.
     * Make sure all devices are synchronized before running this method.
     */
    async markUnusedChunks() {
        if (!this.isAvailable()) return;
        const { used, existing } = await this.allChunks();
        const existChunks = [...existing];
        const unusedChunks = existChunks.filter(([key, e]) => !used.has(e._id)).map(([key, e]) => e);
        const deleteChunks = unusedChunks.map((e) => ({
            ...e,
            _deleted: true,
        }));
        const size = deleteChunks.reduce((acc, e) => acc + e.data.length, 0);
        const humanSize = sizeToHumanReadable(size);
        if (deleteChunks.length == 0) {
            this._notice("No unused chunks found.");
            return;
        }
        const message = `We have following chunks that are not used from any files.

- Chunks: ${deleteChunks.length} (${humanSize})

Are you sure to mark these chunks to be deleted?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> This operation will not reduces the capacity of the remote until permanent deletion.`;

        if (await this.confirm("Mark unused chunks", message, "Mark", "Cancel")) {
            const result = await this.database.bulkDocs(deleteChunks);
            this.clearHash();
            this._notice(`Marked chunks: ${result.filter((e) => "ok" in e).length} / ${deleteChunks.length}`);
        }
    }

    async removeUnusedChunks() {
        const { used, existing } = await this.allChunks();
        const existChunks = [...existing];
        const unusedChunks = existChunks.filter(([key, e]) => !used.has(e._id)).map(([key, e]) => e);
        const deleteChunks = unusedChunks.map((e) => ({
            ...e,
            data: "",
            _deleted: true,
        }));
        const size = unusedChunks.reduce((acc, e) => acc + e.data.length, 0);
        const humanSize = sizeToHumanReadable(size);
        if (deleteChunks.length == 0) {
            this._notice("No unused chunks found.");
            return;
        }
        const message = `We have following chunks that are not used from any files.

- Chunks: ${deleteChunks.length} (${humanSize})

Are you sure to delete these chunks?

Note: **Make sure to synchronise all devices before deletion.**

> [!Note]
> Chunks referenced from deleted files are not deleted. Please run "Commit File Deletion" before this operation.`;

        if (await this.confirm("Mark unused chunks", message, "Mark", "Cancel")) {
            const result = await this.database.bulkDocs(deleteChunks);
            this._notice(`Deleted chunks: ${result.filter((e) => "ok" in e).length} / ${deleteChunks.length}`);
            this.clearHash();
        }
    }

    async scanUnusedChunks() {
        const kvDB = this.plugin.kvDB;
        const chunkSet = (await kvDB.get<Set<DocumentID>>(DB_KEY_CHUNK_SET)) || new Set();
        const chunkUsageMap = (await kvDB.get<ChunkUsageMap>(DB_KEY_DOC_USAGE_MAP)) || new Map();
        const KEEP_MAX_REVS = 10;
        const unusedSet = new Set<DocumentID>([...chunkSet]);
        for (const [, revIdMap] of chunkUsageMap) {
            const sortedRevId = [...revIdMap.entries()].sort((a, b) => getNoFromRev(b[0]) - getNoFromRev(a[0]));
            if (sortedRevId.length > KEEP_MAX_REVS) {
                // If we have more revisions than we want to keep, we need to delete the extras
            }
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
     * Track changes in the database and update the chunk usage map for garbage collection.
     * Note that this only able to perform without Fetch chunks on demand.
     */
    async trackChanges(fromStart: boolean = false, showNotice: boolean = false) {
        if (!this.isAvailable()) return;
        const logLevel = showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        const kvDB = this.plugin.kvDB;

        const previousSeq = fromStart ? "" : await kvDB.get<string>(DB_KEY_SEQ);
        const chunkSet = (await kvDB.get<Set<DocumentID>>(DB_KEY_CHUNK_SET)) || new Set();

        const chunkUsageMap = (await kvDB.get<ChunkUsageMap>(DB_KEY_DOC_USAGE_MAP)) || new Map();

        const db = this.localDatabase.localDatabase;
        const verbose = (msg: string) => this._verbose(msg);

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
                    // chunkSet.add(chunkId as DocumentID);
                } else {
                    if (softDeleted) {
                        //TODO: Soft delete
                        chunkUsageMap.get(id)!.set(rev, (chunkUsageMap.get(id)!.get(rev) || new Set()).add(chunkId));
                    } else {
                        chunkUsageMap.get(id)!.set(rev, (chunkUsageMap.get(id)!.get(rev) || new Set()).add(chunkId));
                    }
                }
            }
            verbose(
                `Tracking chunk: ${id}/${rev} (${doc?.path}), deleted: ${deleted ? "yes" : "no"} Soft-Deleted:${softDeleted ? "yes" : "no"}`
            );
            return await Promise.resolve();
        };
        // let saveQueue = 0;
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
                    .filter((e) => e.status == "available" && e.rev != doc._rev)
                    .filter((info) => !chunkUsageMap.get(doc._id)?.has(info.rev));
                const infoLength = info.length;
                this._log(`Found ${allRevs} old revisions for ${doc._id} . ${infoLength} items to check `);
                if (info.length > 0) {
                    const oldDocs = await Promise.all(
                        info
                            .filter((revInfo) => revInfo.status == "available")
                            .map((revInfo) => db.get(doc._id, { rev: revInfo.rev }))
                    ).then((docs) => docs.filter((doc) => doc));
                    for (const oldDoc of oldDocs) {
                        await processDoc(oldDoc as EntryDoc, false);
                    }
                }
            } catch (ex) {
                if ((ex as any)?.status == 404) {
                    this._log(`No revisions found for ${doc._id}`, LOG_LEVEL_VERBOSE);
                } else {
                    this._log(`Error finding revisions for ${doc._id}`);
                    this._verbose(ex);
                }
            }
        };
        const processChange = async (doc: EntryDoc, isDeleted: boolean, seq: string | number) => {
            if (doc.type === EntryTypes.CHUNK) {
                if (isDeleted) return;
                chunkSet.add(doc._id);
            } else if ("children" in doc) {
                await processDoc(doc, isDeleted);
                await serialized("x-process-doc", async () => await processDocRevisions(doc));
            }
        };
        // Track changes
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
                // handle change
                await processChange(change.doc!, change.deleted ?? false, change.seq);
                if (i++ % 100 == 0) {
                    await saveState(change.seq);
                }
            })
            .on("complete", async (info) => {
                await saveState(info.last_seq);
            });

        // Track all changed docs and new-leafs;

        const result = await this.scanUnusedChunks();

        const message = `Total chunks: ${result.chunkSet.size}\nUnused chunks: ${result.unusedSet.size}`;
        this._log(message, logLevel);
    }
    async performGC(showingNotice = false) {
        if (!this.isAvailable()) return;
        await this.trackChanges(false, showingNotice);
        const title = "Are all devices synchronised?";
        const confirmMessage = `This function deletes unused chunks from the device. If there are differences between devices, some chunks may be missing when resolving conflicts.
Be sure to synchronise before executing.

However, if you have deleted them, you may be able to recover them by performing Hatch -> Recreate missing chunks for all files.

Are you ready to delete unused chunks?`;

        const logLevel = showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;

        const BUTTON_OK = `Yes, delete chunks`;
        const BUTTON_CANCEL = "Cancel";

        const result = await this.plugin.confirm.askSelectStringDialogue(
            confirmMessage,
            [BUTTON_OK, BUTTON_CANCEL] as const,
            {
                title,
                defaultAction: BUTTON_CANCEL,
            }
        );
        if (result !== BUTTON_OK) {
            this._log("User cancelled chunk deletion", logLevel);
            return;
        }
        const { unusedSet, chunkSet } = await this.scanUnusedChunks();
        const deleteChunks = await this.database.allDocs({
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
                ...(e as any).doc!,
                _deleted: true,
            }));

        this._log(`Deleting chunks: ${deleteDocs.length}`, logLevel);
        const deleteChunkBatch = arrayToChunkedArray(deleteDocs, 100);
        let successCount = 0;
        let errored = 0;
        for (const batch of deleteChunkBatch) {
            const results = await this.database.bulkDocs(batch as EntryLeaf[]);
            for (const result of results) {
                if ("ok" in result) {
                    chunkSet.delete(result.id as DocumentID);
                    successCount++;
                } else {
                    this._log(`Failed to delete doc: ${result.id}`, LOG_LEVEL_VERBOSE);
                    errored++;
                }
            }
            this._log(`Deleting chunks: ${successCount} `, logLevel, "gc-preforming");
        }
        const message = `Garbage Collection completed.
Success: ${successCount}, Errored: ${errored}`;
        this._log(message, logLevel);
        const kvDB = this.plugin.kvDB;
        await kvDB.set(DB_KEY_CHUNK_SET, chunkSet);
    }
}
