import { $msg } from "@/common/translation";
import type {
    FilePath,
    FilePathWithPrefix,
    LoadedEntry,
    ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { getFileRegExp } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { isNotFoundError } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import { ICHeader, ICXHeader, PSCHeader } from "@vrtmrz/livesync-commonlib/compat/common/models/fileaccess.const";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { IPathService, IUIService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import { addPrefix, stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

type DatabaseMeta = LoadedEntry & {
    _rawStorageType: string | null;
    _legacyBodyPresent: boolean;
    _revs_info?: Array<{
        rev: string;
        status: string;
    }>;
};

export type FileDatabaseInfoCore = {
    localDatabase: Pick<
        LiveSyncLocalDB,
        "allDocsRaw" | "findAllDocs" | "getDBEntryFromMeta" | "getDBEntry" | "localDatabase"
    >;
    services: {
        path: Pick<IPathService, "path2id">;
        UI: IUIService;
    };
    settings: ObsidianLiveSyncSettings;
    storageAccess: Pick<
        StorageAccess,
        "getFileNames" | "getFilesIncludeHidden" | "isExistsIncludeHidden" | "statHidden"
    >;
};

export type RevisionDatabaseInfo = {
    documentId: string;
    revision: string | null;
    current: boolean;
    deleted: boolean;
    storageType: string;
    storageLayout: "chunked" | "legacy-inline";
    ctime: number;
    mtime: number;
    recordedSize: number;
    revisionHistory: Array<{
        revision: string;
        status: string;
    }>;
    chunkReferences: number;
    uniqueChunkReferences: number;
    embeddedChunkReferences: number;
    locallyStoredChunkReferences: number;
    contentAvailableLocally: boolean;
    chunks: Array<{
        id: string;
        referenceCount: number;
        embedded: boolean;
        storedInLocalDatabase: boolean;
        localDatabaseState: "available" | "deleted" | "missing";
        localDatabaseRevision: string | null;
    }>;
};

export type FileDatabaseMergeBaseInfo = {
    winnerRevision: string;
    conflictRevision: string;
    revision: string | null;
    metadataAvailableLocally: boolean;
    contentAvailableLocally: boolean;
    missingChunkIds: string[];
    unavailableSharedRevisions: string[];
};

export type FileDatabaseInfo = {
    path: string;
    databasePath: FilePathWithPrefix | FilePath;
    storage: {
        exists: boolean;
        ctime?: number;
        mtime?: number;
        size?: number;
    };
    database: {
        source: "local database on this device";
        remoteQueried: false;
        exists: boolean;
        currentRevision: string | null;
        conflictCount: number;
        conflictRevisions: string[];
        unavailableConflictRevisions: string[];
        revisions: RevisionDatabaseInfo[];
        mergeBases: FileDatabaseMergeBaseInfo[];
    };
};

const REPORT_WARNING =
    "All revisions and chunk availability below are a snapshot of this device's local database; the remote is not queried. Review the Vault-relative path, document identifier, content-derived chunk identifiers, and metadata before sharing this report. File contents are omitted.";

function toDatabasePath(path: string): FilePathWithPrefix | FilePath {
    if (path.startsWith(".")) {
        return addPrefix(path as FilePath, ICHeader);
    }
    return path as FilePath;
}

type RawDatabaseDocument = {
    _id: string;
    _rev?: string;
    _conflicts?: string[];
    _deleted?: boolean;
    _revs_info?: Array<{
        rev: string;
        status: string;
    }>;
    children?: string[];
    ctime?: number;
    deleted?: boolean;
    data?: string | string[];
    eden?: Record<string, unknown>;
    mtime?: number;
    size?: number;
    type?: string;
};

async function getLocalDatabaseMeta(
    core: FileDatabaseInfoCore,
    path: FilePathWithPrefix | FilePath,
    options: PouchDB.Core.GetOptions
): Promise<DatabaseMeta | false> {
    const documentId = await core.services.path.path2id(path);
    let raw: RawDatabaseDocument;
    try {
        raw = await core.localDatabase.localDatabase.get(documentId, options);
    } catch (error) {
        if (isNotFoundError(error)) {
            return false;
        }
        throw error;
    }

    if (raw.type === "leaf") {
        return false;
    }
    if (raw.type && raw.type !== "notes" && raw.type !== "newnote" && raw.type !== "plain") {
        return false;
    }

    const rawStorageType = raw.type ?? null;
    const legacy = rawStorageType === null || rawStorageType === "notes";
    const type = legacy ? "notes" : rawStorageType;
    const legacyBodyPresent =
        legacy && (typeof raw.data === "string" || (Array.isArray(raw.data) && raw.data.every((item) => typeof item === "string")));
    return {
        _id: raw._id,
        _rev: raw._rev,
        _conflicts: raw._conflicts,
        _revs_info: raw._revs_info,
        path,
        data: legacyBodyPresent ? raw.data : "",
        ctime: raw.ctime ?? 0,
        mtime: raw.mtime ?? 0,
        size: raw.size ?? 0,
        children: type === "newnote" || type === "plain" ? (raw.children ?? []) : [],
        datatype: type === "newnote" ? "newnote" : "plain",
        deleted: raw.deleted ?? raw._deleted,
        type,
        eden: raw.eden ?? {},
        _rawStorageType: rawStorageType,
        _legacyBodyPresent: legacyBodyPresent,
    } as DatabaseMeta;
}

async function collectRevisionDatabaseInfo(
    core: FileDatabaseInfoCore,
    meta: DatabaseMeta,
    current: boolean
): Promise<RevisionDatabaseInfo> {
    const legacy = meta._rawStorageType === null || meta._rawStorageType === "notes";
    const children = legacy ? [] : "children" in meta ? meta.children : [];
    const uniqueChildren = [...new Set(children)];
    const referenceCounts = new Map<string, number>();
    for (const child of children) {
        referenceCounts.set(child, (referenceCounts.get(child) ?? 0) + 1);
    }
    const embeddedChildren = new Set(
        Object.keys("eden" in meta && meta.eden ? meta.eden : {}).filter((id) => uniqueChildren.includes(id))
    );
    const localRows =
        uniqueChildren.length === 0
            ? []
            : (
                  await core.localDatabase.allDocsRaw({
                      keys: uniqueChildren,
                      include_docs: false,
                  })
              ).rows;
    const localChunkStates = new Map(
        localRows
            .filter((row) => "value" in row)
            .map(
                (row) =>
                    [
                        row.key,
                        {
                            state: row.value.deleted ? ("deleted" as const) : ("available" as const),
                            revision: row.value.rev,
                        },
                    ] as const
            )
    );

    return {
        documentId: meta._id,
        revision: meta._rev ?? null,
        current,
        deleted: Boolean(meta.deleted ?? meta._deleted),
        storageType: meta._rawStorageType ?? "absent",
        storageLayout: legacy ? "legacy-inline" : "chunked",
        ctime: meta.ctime,
        mtime: meta.mtime,
        recordedSize: meta.size,
        revisionHistory: (meta._revs_info ?? []).map(({ rev, status }) => ({
            revision: rev,
            status,
        })),
        chunkReferences: children.length,
        uniqueChunkReferences: uniqueChildren.length,
        embeddedChunkReferences: children.filter((id) => embeddedChildren.has(id)).length,
        locallyStoredChunkReferences: children.filter((id) => localChunkStates.get(id)?.state === "available").length,
        contentAvailableLocally: legacy
            ? meta._legacyBodyPresent
            : uniqueChildren.every(
                  (id) => embeddedChildren.has(id) || localChunkStates.get(id)?.state === "available"
              ),
        chunks: uniqueChildren.map((id) => {
            const localState = localChunkStates.get(id);
            return {
                id,
                referenceCount: referenceCounts.get(id) ?? 0,
                embedded: embeddedChildren.has(id),
                storedInLocalDatabase: localState?.state === "available",
                localDatabaseState: localState?.state ?? "missing",
                localDatabaseRevision: localState?.revision ?? null,
            };
        }),
    };
}

function revisionHistory(meta: DatabaseMeta): Array<{ revision: string; status: string }> {
    const history = (meta._revs_info ?? []).map(({ rev, status }) => ({
        revision: rev,
        status,
    }));
    if (meta._rev && !history.some(({ revision }) => revision === meta._rev)) {
        history.unshift({
            revision: meta._rev,
            status: "available",
        });
    }
    return history;
}

function missingChunkIds(info: RevisionDatabaseInfo): string[] {
    return info.chunks
        .filter(({ embedded, localDatabaseState }) => !embedded && localDatabaseState !== "available")
        .map(({ id }) => id);
}

export async function inspectFileDatabaseInfo(core: FileDatabaseInfoCore, path: string): Promise<FileDatabaseInfo> {
    const storageExists = await core.storageAccess.isExistsIncludeHidden(path);
    const storageStat = storageExists ? await core.storageAccess.statHidden(path) : null;
    const databasePath = toDatabasePath(path);
    const currentMeta = await getLocalDatabaseMeta(core, databasePath, {
        conflicts: true,
        revs: true,
        revs_info: true,
    });

    const revisions: RevisionDatabaseInfo[] = [];
    const conflictRevisions = currentMeta === false ? [] : (currentMeta._conflicts ?? []);
    const unavailableConflictRevisions: string[] = [];
    const mergeBases: FileDatabaseMergeBaseInfo[] = [];
    const metadataByRevision = new Map<string, DatabaseMeta | false>();
    if (currentMeta !== false && currentMeta._rev) {
        metadataByRevision.set(currentMeta._rev, currentMeta);
    }
    const getRevisionMeta = async (revision: string): Promise<DatabaseMeta | false> => {
        const cached = metadataByRevision.get(revision);
        if (cached !== undefined) {
            return cached;
        }
        const meta = await getLocalDatabaseMeta(core, databasePath, {
            rev: revision,
            revs: true,
            revs_info: true,
        });
        metadataByRevision.set(revision, meta);
        return meta;
    };

    if (currentMeta) {
        revisions.push(await collectRevisionDatabaseInfo(core, currentMeta, true));
        for (const revision of conflictRevisions) {
            const conflictMeta = await getRevisionMeta(revision);
            if (conflictMeta) {
                revisions.push(await collectRevisionDatabaseInfo(core, conflictMeta, false));
                const winnerHistory = revisionHistory(currentMeta);
                const conflictHistory = revisionHistory(conflictMeta);
                const conflictHistoryByRevision = new Map(
                    conflictHistory.map(({ revision: historyRevision, status }) => [historyRevision, status])
                );
                const sharedHistory = winnerHistory.filter(({ revision: historyRevision }) =>
                    conflictHistoryByRevision.has(historyRevision)
                );
                const sharedRevision = sharedHistory[0]?.revision ?? null;
                const unavailableSharedRevisions = sharedHistory
                    .filter(
                        ({ revision: historyRevision, status }) =>
                            status !== "available" ||
                            conflictHistoryByRevision.get(historyRevision) !== "available"
                    )
                    .map(({ revision: historyRevision }) => historyRevision);
                const sharedMeta = sharedRevision ? await getRevisionMeta(sharedRevision) : false;
                const sharedInfo = sharedMeta
                    ? await collectRevisionDatabaseInfo(core, sharedMeta, false)
                    : undefined;
                mergeBases.push({
                    winnerRevision: currentMeta._rev ?? "",
                    conflictRevision: revision,
                    revision: sharedRevision,
                    metadataAvailableLocally: Boolean(sharedMeta),
                    contentAvailableLocally: sharedInfo?.contentAvailableLocally ?? false,
                    missingChunkIds: sharedInfo ? missingChunkIds(sharedInfo) : [],
                    unavailableSharedRevisions,
                });
            } else {
                unavailableConflictRevisions.push(revision);
            }
        }
    }

    const report: FileDatabaseInfo = {
        path,
        databasePath,
        storage: storageStat
            ? {
                  exists: true,
                  ctime: storageStat.ctime,
                  mtime: storageStat.mtime,
                  size: storageStat.size,
              }
            : {
                  exists: false,
              },
        database: {
            source: "local database on this device",
            remoteQueried: false,
            exists: currentMeta !== false,
            currentRevision: currentMeta ? (currentMeta._rev ?? null) : null,
            conflictCount: conflictRevisions.length,
            conflictRevisions,
            unavailableConflictRevisions,
            revisions,
            mergeBases,
        },
    };

    return report;
}

export async function readFileDatabaseRevisionLocally(
    core: FileDatabaseInfoCore,
    path: string,
    revision: string
): Promise<LoadedEntry | false> {
    const databasePath = toDatabasePath(path);
    const meta = await getLocalDatabaseMeta(core, databasePath, {
        rev: revision,
        revs: true,
        revs_info: true,
    });
    if (!meta) {
        return false;
    }
    const info = await collectRevisionDatabaseInfo(core, meta, false);
    if (info.deleted || !info.contentAvailableLocally) {
        return false;
    }
    return await core.localDatabase.getDBEntryFromMeta(meta, false, false);
}

export async function retryReadFileDatabaseRevision(
    core: FileDatabaseInfoCore,
    path: string,
    revision: string
): Promise<LoadedEntry | false> {
    return await core.localDatabase.getDBEntry(toDatabasePath(path), { rev: revision }, false, true, true);
}

export async function buildFileDatabaseInfoReport(core: FileDatabaseInfoCore, path: string): Promise<string> {
    const report = await inspectFileDatabaseInfo(core, path);
    return `${$msg(REPORT_WARNING)}

\`\`\`json
${JSON.stringify(report, null, 2)}
\`\`\``;
}

export async function copyFileDatabaseInfo(core: FileDatabaseInfoCore, path: string): Promise<boolean> {
    const report = await buildFileDatabaseInfoReport(core, path);
    return await core.services.UI.promptCopyToClipboard(
        $msg("Database information for ${FILE}", { FILE: path }),
        report
    );
}

export async function collectFileDatabaseInfoPaths(core: FileDatabaseInfoCore): Promise<string[]> {
    const ignorePatterns = getFileRegExp(core.settings, "syncInternalFilesIgnorePatterns");
    const targetPatterns = getFileRegExp(core.settings, "syncInternalFilesTargetPatterns");
    const storagePaths = core.settings.syncInternalFiles
        ? await core.storageAccess.getFilesIncludeHidden("/", targetPatterns, ignorePatterns)
        : await core.storageAccess.getFileNames();
    const databasePaths: string[] = [];

    for await (const entry of core.localDatabase.findAllDocs()) {
        const prefixedPath = entry.path;
        if (prefixedPath.startsWith(ICXHeader) || prefixedPath.startsWith(PSCHeader)) {
            continue;
        }
        if (!core.settings.syncInternalFiles && prefixedPath.startsWith(ICHeader)) {
            continue;
        }
        databasePaths.push(stripAllPrefixes(prefixedPath));
    }

    return [...new Set([...storagePaths, ...databasePaths])].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
    );
}

export async function chooseAndCopyFileDatabaseInfo(core: FileDatabaseInfoCore): Promise<boolean> {
    const paths = await collectFileDatabaseInfoPaths(core);
    const selected = await core.services.UI.confirm.askSelectString($msg("Choose a file to inspect"), paths);
    if (!selected) {
        return false;
    }
    return await copyFileDatabaseInfo(core, selected);
}
