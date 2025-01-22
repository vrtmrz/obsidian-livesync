import { sizeToHumanReadable } from "octagonal-wheels/number";
import { LOG_LEVEL_NOTICE, type MetaEntry } from "../../lib/src/common/types";
import { getNoFromRev } from "../../lib/src/pouchdb/LiveSyncLocalDB";
import type { IObsidianModule } from "../../modules/AbstractObsidianModule";
import { LiveSyncCommands } from "../LiveSyncCommands";

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
        this.localDatabase.hashCaches.clear();
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
}
