import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { LoadedEntry, MetaEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    ContentReadError,
    isReflectionCompleted,
    type FileReflectionResult,
    type ReflectionOperationContext,
} from "@vrtmrz/livesync-commonlib/replication";
import { isNotFoundError } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_VERBOSE, type LOG_LEVEL } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import type { ReflectionApplicationScope } from "./reflectionRecoveryState";

export interface ReplicatedDocumentApplicationContext {
    getLocalDatabase(): Pick<LiveSyncBaseCore["localDatabase"], "getRaw" | "readDBEntryFromMeta">;
    isValidPath(entry: MetaEntry): boolean;
    processOptional(entry: LoadedEntry): Promise<boolean>;
    applyToStorage(entry: MetaEntry, operation: ReflectionOperationContext): Promise<FileReflectionResult | undefined>;
    onReflected(documentId: string): Promise<void>;
    log(message: string, level: LOG_LEVEL): void;
}

/** Inspect current Metadata without changing the conflict and ancestry policy. */
export async function checkDocumentRevision(
    context: ReplicatedDocumentApplicationContext,
    entry: LoadedEntry,
    scope: ReflectionApplicationScope
): Promise<boolean> {
    let saved;
    try {
        saved = await context.getLocalDatabase().getRaw<LoadedEntry>(entry._id, { conflicts: true, revs_info: true });
    } catch (cause) {
        if (isNotFoundError(cause)) {
            return true;
        }
        throw new ContentReadError({
            documentId: entry._id,
            revision: entry._rev,
            resources: ["local-database"],
            cause,
        });
    }
    scope.observeRevision(saved._rev);
    if (saved._conflicts?.length || (entry._rev ?? "") === (saved._rev ?? "")) {
        return true;
    }
    return !(saved._revs_info ?? []).some((revision) => revision.rev === (entry._rev ?? ""));
}

/** A single attempt propagates terminal failures to the owner which retains its target. */
export async function applyReplicatedDocument(
    context: ReplicatedDocumentApplicationContext,
    entry: LoadedEntry,
    scope: ReflectionApplicationScope,
    description: string
): Promise<void> {
    const deleted = entry._deleted === true || entry.deleted === true;
    const content = deleted
        ? { ...entry, data: "" }
        : await context.getLocalDatabase().readDBEntryFromMeta({ ...entry }, false, true);
    if (!content) {
        throw new ContentReadError({ documentId: entry._id, revision: entry._rev, resources: [], cause: undefined });
    }
    scope.checkpoint();
    if (await context.processOptional(entry)) {
        context.log(`Processed by other processor: ${description}`, LOG_LEVEL_DEBUG);
        return;
    }
    scope.checkpoint();
    if (!context.isValidPath(content as MetaEntry)) {
        context.log(`Unprocessed (Invalid path): ${description}`, LOG_LEVEL_VERBOSE);
        return;
    }
    const result = await context.applyToStorage(content as MetaEntry, {
        target: { documentId: entry._id, revision: entry._rev! },
        source: scope.source,
        checkpoint: () => {
            scope.checkpoint();
            return true;
        },
    });
    if (!result) {
        throw new Error("No handler completed the file reflection");
    }
    if (isReflectionCompleted(result)) {
        context.log(`Processed: ${description}`, LOG_LEVEL_DEBUG);
        await context.onReflected(entry._id);
    }
}
