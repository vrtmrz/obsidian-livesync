import { $msg } from "@/common/translation";
import { delay } from "octagonal-wheels/promises";
import { createDiagnosticNameMapper, parseDiagnosticPathToken } from "@vrtmrz/livesync-commonlib/diagnostics";
import { EntryTypes, type FilePath, type FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ICHeader, ICXHeader, PSCHeader } from "@vrtmrz/livesync-commonlib/compat/common/models/fileaccess.const";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import type { ComponentHasResult } from "@/modules/services/LiveSyncUI/svelteDialog";
import DiagnosticFileLookupDialog from "@/modules/services/LiveSyncUI/dialogues/DiagnosticFileLookupDialog.svelte";
import type {
    FileDatabaseInfo,
    FileDatabaseInfoCore,
    FileDatabaseMergeBaseInfo,
    InspectFileDatabaseInfoOptions,
    RevisionDatabaseInfo,
} from "./fileDatabaseInfo";
import { inspectFileDatabaseInfo } from "./fileDatabaseInfo";
import type {
    DiagnosticFileCandidate,
    DiagnosticFileLookupDialogOptions,
    DiagnosticFileLookupResult,
    FindDiagnosticFilesOptions,
} from "./diagnosticFileLookupTypes";
import type { DatabaseDiagnosticArtifact, DatabaseDiagnosticOutput } from "./databaseDiagnostics";

type CurrentFileMetadata = {
    _id: string;
    path: FilePathWithPrefix | FilePath;
    type: string;
    _deleted?: boolean;
};

type FileLookupDialogManager = {
    open<TResult, TInitial = TResult>(
        component: ComponentHasResult<TResult, TInitial>,
        initialData?: TInitial
    ): Promise<TResult | undefined>;
};

type FileLookupUI = FileDatabaseInfoCore["services"]["UI"] & {
    dialogManager: FileLookupDialogManager;
};

function isCurrentFileMetadata(value: unknown): value is CurrentFileMetadata {
    if (value === null || typeof value !== "object") return false;
    const entry = value as Record<string, unknown>;
    if (
        typeof entry._id !== "string" ||
        typeof entry.path !== "string" ||
        (entry.type !== EntryTypes.NOTE_BINARY && entry.type !== EntryTypes.NOTE_PLAIN) ||
        entry._deleted === true
    ) {
        return false;
    }
    const path = entry.path;
    return ![ICHeader, ICXHeader, PSCHeader].some((prefix) => path.startsWith(prefix));
}

function cancelledResult(processed: number, candidates: DiagnosticFileCandidate[]): DiagnosticFileLookupResult {
    return { valid: true, status: "cancelled", processed, candidates };
}

async function yieldToEventLoop(): Promise<void> {
    await delay(0);
}

export async function findDiagnosticFiles(
    core: FileDatabaseInfoCore,
    token: string,
    options: FindDiagnosticFilesOptions = {}
): Promise<DiagnosticFileLookupResult> {
    const parsedToken = parseDiagnosticPathToken(token);
    if (!parsedToken) {
        return { valid: false, status: "invalid", processed: 0, candidates: [] };
    }
    const mapper = createDiagnosticNameMapper("pseudonym", parsedToken.salt);
    const candidates: DiagnosticFileCandidate[] = [];
    let processed = 0;
    const reportProgress = () => options.onProgress?.(processed);
    reportProgress();
    if (options.signal?.aborted) {
        reportProgress();
        return cancelledResult(processed, candidates);
    }
    const vaultPaths = new Set(await core.storageAccess.getFileNames());
    const matchingMetadataPaths = new Set<string>();
    if (options.signal?.aborted) {
        reportProgress();
        return cancelledResult(processed, candidates);
    }

    for await (const entry of core.localDatabase.findAllDocs()) {
        processed++;
        if (isCurrentFileMetadata(entry)) {
            const databasePath = entry.path;
            const path = stripAllPrefixes(databasePath);
            if (mapper.path(path) === token) {
                matchingMetadataPaths.add(path);
                candidates.push({
                    path,
                    databasePath,
                    documentId: entry._id,
                    storageExists: vaultPaths.has(path),
                    source: "metadata",
                });
            }
        }
        if (processed % 128 === 0) {
            reportProgress();
            await yieldToEventLoop();
            if (options.signal?.aborted) {
                reportProgress();
                return cancelledResult(processed, candidates);
            }
        }
    }
    if (options.signal?.aborted) {
        reportProgress();
        return cancelledResult(processed, candidates);
    }

    for (const path of vaultPaths) {
        processed++;
        if (mapper.path(path) === token && !matchingMetadataPaths.has(path)) {
            candidates.push({ path, storageExists: true, source: "vault" });
        }
        if (processed % 128 === 0) {
            reportProgress();
            await yieldToEventLoop();
            if (options.signal?.aborted) {
                reportProgress();
                return cancelledResult(processed, candidates);
            }
        }
    }
    reportProgress();
    if (options.signal?.aborted) return cancelledResult(processed, candidates);
    return { valid: true, status: "complete", processed, candidates };
}

function finiteMetric(value: number | undefined, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonnegativeMetric(value: number | undefined): number {
    return Math.max(0, finiteMetric(value));
}

function revisionStatus(value: string): "available" | "missing" | "unknown" {
    if (value === "available" || value === "missing") return value;
    return "unknown";
}

function storageType(value: string): "absent" | "notes" | "newnote" | "plain" | "unknown" {
    if (value === "absent" || value === "notes" || value === "newnote" || value === "plain") return value;
    return "unknown";
}

function localChunkState(value: string): "available" | "deleted" | "missing" | "unknown" {
    if (value === "available" || value === "deleted" || value === "missing") return value;
    return "unknown";
}

function projectRevisionInfo(info: RevisionDatabaseInfo, mapper: ReturnType<typeof createDiagnosticNameMapper>) {
    return {
        documentId: mapper.id(info.documentId),
        revision: info.revision === null ? null : mapper.revision(info.revision),
        current: info.current,
        deleted: info.deleted,
        storageType: storageType(info.storageType),
        storageLayout: info.storageLayout === "legacy-inline" ? "legacy-inline" : "chunked",
        ctime: finiteMetric(info.ctime),
        mtime: finiteMetric(info.mtime),
        recordedSize: nonnegativeMetric(info.recordedSize),
        revisionHistory: info.revisionHistory.map(({ revision, status }) => ({
            revision: mapper.revision(revision),
            status: revisionStatus(status),
        })),
        chunkReferences: nonnegativeMetric(info.chunkReferences),
        uniqueChunkReferences: nonnegativeMetric(info.uniqueChunkReferences),
        embeddedChunkReferences: nonnegativeMetric(info.embeddedChunkReferences),
        locallyStoredChunkReferences: nonnegativeMetric(info.locallyStoredChunkReferences),
        contentAvailableLocally: info.contentAvailableLocally,
        chunks: info.chunks.map((chunk) => ({
            id: mapper.chunk(chunk.id),
            referenceCount: nonnegativeMetric(chunk.referenceCount),
            embedded: chunk.embedded,
            storedInLocalDatabase: chunk.storedInLocalDatabase,
            localDatabaseState: localChunkState(chunk.localDatabaseState),
            localDatabaseRevision:
                chunk.localDatabaseRevision === null ? null : mapper.revision(chunk.localDatabaseRevision),
        })),
    };
}

function projectMergeBase(info: FileDatabaseMergeBaseInfo, mapper: ReturnType<typeof createDiagnosticNameMapper>) {
    return {
        winnerRevision: mapper.revision(info.winnerRevision),
        conflictRevision: mapper.revision(info.conflictRevision),
        revision: info.revision === null ? null : mapper.revision(info.revision),
        metadataAvailableLocally: info.metadataAvailableLocally,
        contentAvailableLocally: info.contentAvailableLocally,
        missingChunkIds: info.missingChunkIds.map((id) => mapper.chunk(id)),
        unavailableSharedRevisions: info.unavailableSharedRevisions.map((revision) => mapper.revision(revision)),
    };
}

function projectStorage(info: FileDatabaseInfo["storage"]) {
    return {
        exists: info.exists,
        ...(info.ctime === undefined ? {} : { ctime: finiteMetric(info.ctime) }),
        ...(info.mtime === undefined ? {} : { mtime: finiteMetric(info.mtime) }),
        ...(info.size === undefined ? {} : { size: nonnegativeMetric(info.size) }),
    };
}

function projectFileInfo(
    info: FileDatabaseInfo,
    source: DiagnosticFileCandidate["source"],
    mapper: ReturnType<typeof createDiagnosticNameMapper>
) {
    return {
        path: mapper.path(info.path),
        databasePath: mapper.path(info.databasePath),
        source,
        storage: projectStorage(info.storage),
        database: {
            source: "local database on this device" as const,
            remoteQueried: false as const,
            inspected: true,
            exists: info.database.exists,
            ...(info.database.documentId === undefined ? {} : { documentId: mapper.id(info.database.documentId) }),
            currentRevision:
                info.database.currentRevision === null ? null : mapper.revision(info.database.currentRevision),
            conflictCount: nonnegativeMetric(info.database.conflictCount),
            conflictRevisions: info.database.conflictRevisions.map((revision) => mapper.revision(revision)),
            unavailableConflictRevisions: info.database.unavailableConflictRevisions.map((revision) =>
                mapper.revision(revision)
            ),
            revisions: info.database.revisions.map((revision) => projectRevisionInfo(revision, mapper)),
            mergeBases: info.database.mergeBases.map((mergeBase) => projectMergeBase(mergeBase, mapper)),
        },
    };
}

async function inspectVaultOnlyCandidate(
    core: FileDatabaseInfoCore,
    candidate: DiagnosticFileCandidate,
    mapper: ReturnType<typeof createDiagnosticNameMapper>,
    signal?: AbortSignal
) {
    const exists = await core.storageAccess.isExistsIncludeHidden(candidate.path);
    if (signal?.aborted) throw new DOMException("File inspection cancelled", "AbortError");
    const stat = exists ? await core.storageAccess.statHidden(candidate.path) : null;
    return {
        path: mapper.path(candidate.path),
        source: "vault" as const,
        storage: projectStorage(
            stat ? { exists: true, ctime: stat.ctime, mtime: stat.mtime, size: stat.size } : { exists: false }
        ),
        database: {
            source: "local database on this device" as const,
            remoteQueried: false as const,
            inspected: false,
            reason: "no-local-target" as const,
        },
    };
}

export async function buildPseudonymousFileReport(
    core: FileDatabaseInfoCore,
    candidate: DiagnosticFileCandidate,
    salt: string,
    signal?: AbortSignal
): Promise<DatabaseDiagnosticOutput> {
    if (signal?.aborted) throw new DOMException("File inspection cancelled", "AbortError");
    const mapper = createDiagnosticNameMapper("pseudonym", salt);
    if (!mapper.salt) throw new Error("Invalid diagnostic path token");
    if (candidate.source === "metadata" && candidate.documentId === undefined) {
        throw new Error("A Metadata candidate requires its exact document ID");
    }
    const info =
        candidate.source === "metadata" && candidate.documentId !== undefined
            ? await inspectFileDatabaseInfo(core, candidate.path, {
                  documentId: candidate.documentId,
                  signal,
                  ...(candidate.databasePath === undefined ? {} : { databasePath: candidate.databasePath }),
              } satisfies InspectFileDatabaseInfoOptions)
            : undefined;
    const file = info
        ? projectFileInfo(info, candidate.source, mapper)
        : await inspectVaultOnlyCandidate(core, candidate, mapper, signal);
    if (signal?.aborted) throw new DOMException("File inspection cancelled", "AbortError");
    const report = {
        schemaVersion: 1,
        kind: "file",
        status: "complete",
        nameMode: "pseudonym",
        salt: mapper.salt,
        scope: {
            source: "local database on this device",
            remoteQueried: false,
            vaultContentRead: false,
            fileContents: "omitted",
            revisions: "current revision, current conflict revisions, and selected merge-base revisions",
            revisionHistory: "status metadata is listed for current and conflict revisions where available",
            historicalFileBodiesScanned: false,
        },
        file,
    };
    const json = JSON.stringify(report, null, 2);
    const markdown = `<details>\n<summary>${$msg("Local file diagnostic report")}</summary>\n\n\`\`\`json\n${json}\n\`\`\`\n</details>`;
    const artifacts: DatabaseDiagnosticArtifact[] = [
        { format: "json", filename: "diagnostic-file-report.json", content: json },
        { format: "markdown", filename: "diagnostic-file-report.md", content: markdown },
    ];
    return { status: "complete", nameMode: "pseudonym", artifacts };
}

export async function showDiagnosticFileLookup(
    core: FileDatabaseInfoCore,
    openFile?: (path: string) => Promise<void> | void
): Promise<void> {
    let activeController: AbortController | undefined;
    const options: DiagnosticFileLookupDialogOptions = {
        find: async (token, onProgress) => {
            activeController?.abort();
            activeController = new AbortController();
            return await findDiagnosticFiles(core, token, { signal: activeController.signal, onProgress });
        },
        prepareReport: async (candidate, token) => {
            const parsed = parseDiagnosticPathToken(token);
            if (!parsed) throw new Error("Invalid diagnostic path token");
            activeController?.abort();
            activeController = new AbortController();
            return await buildPseudonymousFileReport(core, candidate, parsed.salt, activeController.signal);
        },
        openFile,
        cancel: () => activeController?.abort(),
    };
    const ui = core.services.UI as FileLookupUI;
    try {
        await ui.dialogManager.open(DiagnosticFileLookupDialog, options);
    } finally {
        activeController?.abort();
    }
}
