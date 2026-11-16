import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { LoadedEntry, MetaEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncError, LocalDatabaseUnavailableError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";
import { isNotFoundError } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import { isInvalidStateError } from "@vrtmrz/livesync-commonlib/compat/services/base/DatabaseService";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/logger";
import type { ContentReadFailure, ContentReadFailureHandler } from "@vrtmrz/livesync-commonlib/replication";
import type { ReflectionApplicationScope } from "./reflectionTargets";

export interface ReplicatedDocumentApplicationContext {
    getLocalDatabase(): Pick<LiveSyncBaseCore["localDatabase"], "getRaw" | "getDBEntryFromMeta">;
    canObserveFailure(documentId: string): boolean;
    isValidPath(entry: MetaEntry): boolean;
    processOptional(entry: LoadedEntry): Promise<boolean>;
    applyToStorage(entry: MetaEntry, onFailure?: ContentReadFailureHandler): Promise<boolean>;
    retainFailure(
        failure: ContentReadFailure,
        scope: ReflectionApplicationScope,
        currentRevision?: string
    ): Promise<void>;
    onReadFailure(): void;
    onReflectionFailure(entry: MetaEntry, cause?: unknown): void;
    onReflected(documentId: string): Promise<void>;
    log(message: string, level: LOG_LEVEL): void;
    logError(error: unknown): void;
}

/** Inspect the current revision without changing the existing conflict and ancestry policy. */
export async function checkDocumentRevision(
    context: ReplicatedDocumentApplicationContext,
    entry: LoadedEntry,
    scope: ReflectionApplicationScope,
    description: string
): Promise<boolean> {
    try {
        const saved = await context.getLocalDatabase().getRaw<LoadedEntry>(entry._id, {
            conflicts: true,
            revs_info: true,
        });
        scope.observeRevision(saved._rev);
        if (saved._conflicts?.length || (entry._rev ?? "") === (saved._rev ?? "")) {
            return true;
        }
        // A known ancestor needs no further reflection when no conflict exists.
        return !(saved._revs_info ?? []).some((revision) => revision.rev === (entry._rev ?? ""));
    } catch (error) {
        if (isNotFoundError(error)) {
            return true;
        }
        if (isInvalidStateError(error)) {
            await context.retainFailure(
                {
                    documentId: entry._id,
                    revision: entry._rev,
                    reason: "local-database",
                    cause: LocalDatabaseUnavailableError.fromError(error),
                },
                scope
            );
        }
        context.onReadFailure();
        context.log(`Failed to get existing document for ${description} `, LOG_LEVEL_NOTICE);
        context.logError(error);
        return false;
    }
}

async function retainReflectionFailure(
    context: ReplicatedDocumentApplicationContext,
    scope: ReflectionApplicationScope,
    entry: LoadedEntry,
    failure: ContentReadFailure | undefined
): Promise<void> {
    if (failure && failure.documentId === entry._id) {
        await context.retainFailure({ ...failure, revision: failure.revision ?? entry._rev }, scope, failure.revision);
    }
}

async function reflectContent(
    context: ReplicatedDocumentApplicationContext,
    entry: LoadedEntry,
    content: MetaEntry,
    scope: ReflectionApplicationScope,
    observeFailure: boolean
): Promise<boolean> {
    let failure: ContentReadFailure | undefined;
    let reflected: boolean;
    try {
        reflected = await context.applyToStorage(
            content,
            observeFailure
                ? (value) => {
                      failure = value;
                  }
                : undefined
        );
    } catch (error) {
        failure ??= LiveSyncError.isCausedBy(error, LocalDatabaseUnavailableError)
            ? {
                  documentId: entry._id,
                  revision: entry._rev,
                  reason: "local-database",
                  cause: LocalDatabaseUnavailableError.fromError(error),
              }
            : undefined;
        await retainReflectionFailure(context, scope, entry, failure);
        context.onReflectionFailure(content, error);
        return false;
    }
    await retainReflectionFailure(context, scope, entry, failure);
    if (!reflected) {
        context.onReflectionFailure(content);
    }
    return reflected;
}

/** Called under the document lock after revision inspection or scanner-policy dispatch. */
export async function applyReplicatedDocument(
    context: ReplicatedDocumentApplicationContext,
    entry: LoadedEntry,
    scope: ReflectionApplicationScope,
    description: string
): Promise<void> {
    const deleted = entry._deleted === true || entry.deleted === true;
    const observeFailure = context.canObserveFailure(entry._id);
    let failure: ContentReadFailure | undefined;
    // Late chunks still use the configured local/online content-read policy.
    const content = deleted
        ? { ...entry, data: "" }
        : observeFailure
          ? await context.getLocalDatabase().getDBEntryFromMeta({ ...entry }, false, true, false, (value) => {
                failure = value;
            })
          : await context.getLocalDatabase().getDBEntryFromMeta({ ...entry }, false, true);
    if (!content) {
        // Failure retention has its own target rules; it is not gated by a successful-read checkpoint.
        if (failure) {
            await context.retainFailure(failure, scope);
        }
        context.onReadFailure();
        context.log(`Failed to gather content of ${description}`, LOG_LEVEL_NOTICE);
        return;
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
    if (await reflectContent(context, entry, content as MetaEntry, scope, observeFailure)) {
        context.log(`Processed: ${description}`, LOG_LEVEL_DEBUG);
        await context.onReflected(entry._id);
    }
}
