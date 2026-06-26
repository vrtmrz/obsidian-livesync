import {
    EntryTypes,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type FilePathWithPrefix,
} from "@lib/common/types.ts";
import { getNoFromRev } from "@lib/pouchdb/LiveSyncLocalDB.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
import { isGCAvailable } from "./utils.ts";

type Rev = string;
type ChunkID = DocumentID;

type ChunkInfo = {
    id: DocumentID;
    refCount: number;
    length: number;
};

type DocumentInfo = {
    id: DocumentID;
    rev: Rev;
    chunks: Set<ChunkID>;
    uniqueChunks: Set<ChunkID>;
    sharedChunks: Set<ChunkID>;
    path: FilePathWithPrefix;
};

/**
 * Analyses the database and details chunk utilisation, copying a TSV summary to the clipboard.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function analyseDatabase(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    if (!isGCAvailable(host, log)) return;
    const db = host.services.database.localDatabase.localDatabase;
    const localDb = host.services.database.localDatabase;

    const chunkMap = new Map<DocumentID, Set<ChunkInfo>>();
    const docMap = new Map<DocumentID, Set<DocumentInfo>>();
    const info = await db.info();
    const maxSeq = Number.parseInt(`${info.update_seq ?? 0}`, 10);
    let processed = 0;
    let read = 0;
    let errored = 0;

    const ft: Promise<void>[] = [];

    const fetchRevision = async (id: DocumentID, rev: Rev) => {
        try {
            processed++;
            const doc = await db.get(id, { rev: rev });
            if (doc) {
                if ("children" in doc) {
                    const docId = doc._id;
                    const docRev = doc._rev;
                    const children = (doc.children || []) as DocumentID[];
                    const set = docMap.get(docId) || new Set();
                    set.add({
                        id: docId,
                        rev: docRev,
                        chunks: new Set(children),
                        uniqueChunks: new Set(),
                        sharedChunks: new Set(),
                        path: doc.path,
                    });
                    docMap.set(docId, set);
                } else if (doc.type === EntryTypes.CHUNK) {
                    const chunkId = doc._id;
                    if (chunkMap.has(chunkId)) {
                        return;
                    }
                    if (doc._deleted) {
                        return;
                    }
                    const length = doc.data.length;
                    const set = chunkMap.get(chunkId) || new Set();
                    set.add({ id: chunkId, length, refCount: 0 });
                    chunkMap.set(chunkId, set);
                }
                read++;
            } else {
                log(`Analysing Database: not found: ${id} / ${rev}`, LOG_LEVEL_NOTICE);
                errored++;
            }
        } catch (error) {
            log(`Error fetching document ${id} / ${rev}:`, LOG_LEVEL_NOTICE);
            log(error, LOG_LEVEL_VERBOSE);
            errored++;
        }
        if (processed % 100 === 0) {
            log(`Analysing database: ${read} (${errored}) / ${maxSeq} `, LOG_LEVEL_NOTICE, "db-analyse");
        }
    };

    const IDs = localDb.findEntryNames("", "", {});
    for await (const id of IDs) {
        const revList = await localDb.getRaw(id as DocumentID, {
            revs: true,
            revs_info: true,
            conflicts: true,
        });
        const revInfos = revList._revs_info || [];
        for (const revInfo of revInfos) {
            if (revInfo.status === "available") {
                ft.push(fetchRevision(id as DocumentID, revInfo.rev));
            }
        }
    }
    await Promise.all(ft);

    for (const [, docRevs] of docMap) {
        for (const docRev of docRevs) {
            for (const chunkId of docRev.chunks) {
                const chunkInfos = chunkMap.get(chunkId);
                if (chunkInfos) {
                    for (const chunkInfo of chunkInfos) {
                        if (chunkInfo.refCount === 0) {
                            docRev.uniqueChunks.add(chunkId);
                        } else {
                            docRev.sharedChunks.add(chunkId);
                        }
                        chunkInfo.refCount++;
                    }
                }
            }
        }
    }

    const result: any[] = [];
    const getTotalSize = (ids: Set<DocumentID>) => {
        return [...ids].reduce((acc, chunkId) => {
            const chunkInfos = chunkMap.get(chunkId);
            if (chunkInfos) {
                for (const chunkInfo of chunkInfos) {
                    acc += chunkInfo.length;
                }
            }
            return acc;
        }, 0);
    };

    for (const doc of docMap.values()) {
        for (const rev of doc) {
            const title = `${rev.path} (${rev.rev})`;
            const id = rev.id;
            const revStr = `${getNoFromRev(rev.rev)}`;
            const revHash = rev.rev.split("-")[1].substring(0, 6);
            const path = rev.path;
            const uniqueChunkCount = rev.uniqueChunks.size;
            const sharedChunkCount = rev.sharedChunks.size;
            const uniqueChunkSize = getTotalSize(rev.uniqueChunks);
            const sharedChunkSize = getTotalSize(rev.sharedChunks);
            result.push({
                title,
                path,
                rev: revStr,
                revHash,
                id,
                uniqueChunkCount,
                sharedChunkCount,
                uniqueChunkSize,
                sharedChunkSize,
            });
        }
    }

    const titleMap = {
        title: "Title",
        id: "Document ID",
        path: "Path",
        rev: "Revision No",
        revHash: "Revision Hash",
        uniqueChunkCount: "Unique Chunk Count",
        sharedChunkCount: "Shared Chunk Count",
        uniqueChunkSize: "Unique Chunk Size",
        sharedChunkSize: "Shared Chunk Size",
    } as const;

    const orphanChunks = [...chunkMap.entries()].filter(([chunkId, infos]) => {
        const totalRefCount = [...infos].reduce((acc, info) => acc + info.refCount, 0);
        return totalRefCount === 0;
    });
    const orphanChunkSize = orphanChunks.reduce((acc, [chunkId, infos]) => {
        for (const info of infos) {
            acc += info.length;
        }
        return acc;
    }, 0);
    result.push({
        title: "__orphan",
        id: "__orphan",
        path: "__orphan",
        rev: "1",
        revHash: "xxxxx",
        uniqueChunkCount: orphanChunks.length,
        sharedChunkCount: 0,
        uniqueChunkSize: orphanChunkSize,
        sharedChunkSize: 0,
    } as const);

    const csvSrc = result.map((e) => {
        return [
            `"${e.title.replace(/"/g, '""')}"`,
            `${e.id}`,
            `${e.path}`,
            `${e.rev}`,
            `${e.revHash}`,
            `${e.uniqueChunkCount}`,
            `${e.sharedChunkCount}`,
            `${e.uniqueChunkSize}`,
            `${e.sharedChunkSize}`,
        ].join("\t");
    });
    csvSrc.unshift(Object.values(titleMap).join("\t"));
    const csv = csvSrc.join("\n");

    await host.services.UI.promptCopyToClipboard("Database Analysis data (TSV):", csv);
}
