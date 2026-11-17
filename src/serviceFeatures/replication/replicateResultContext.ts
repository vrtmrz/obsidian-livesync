import {
    LOG_LEVEL_VERBOSE,
    REMOTE_COUCHDB,
    type LoadedEntry,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isAnyNote } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import {
    FilePairProcessResults,
    FullScanModes,
    processFilePair,
} from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { ReflectionOperationContext } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ReplicateResultProcessorContext } from "./ReplicateResultProcessor";

type RecoveryResource = Parameters<NonNullable<ReplicateResultProcessorContext["canRetryResource"]>>[0];
type ReflectionSource = Parameters<NonNullable<ReplicateResultProcessorContext["inspectReflection"]>>[1];
type SettingOwner = Pick<LiveSyncBaseCore["services"]["setting"], "currentSettings">;

type ReflectionPolicyContext = {
    readonly recoveryEnabled: boolean;
    readonly setting: SettingOwner;
};

type ReflectionInspectionContext = {
    readonly setting: SettingOwner;
    readonly conflict: Pick<LiveSyncBaseCore["services"]["conflict"], "queueCheckForIfOpen">;
    readonly path: Pick<LiveSyncBaseCore["services"]["path"], "getPath">;
    readonly storageAccess: Pick<LiveSyncBaseCore["serviceModules"]["storageAccess"], "isExists">;
    readonly getLocalDatabase: ReplicateResultProcessorContext["getLocalDatabase"];
    readonly fileHandler: Pick<LiveSyncBaseCore["serviceModules"]["fileHandler"], "inspectCurrentFileProvenance">;
    readonly API: LiveSyncBaseCore["services"]["API"];
};

type ScannedDocumentContext = {
    readonly scannerHost: Parameters<typeof processFilePair>[0];
    readonly path: Pick<LiveSyncBaseCore["services"]["path"], "getPath">;
    readonly storageAccess: Pick<LiveSyncBaseCore["serviceModules"]["storageAccess"], "getFileStub">;
    readonly API: LiveSyncBaseCore["services"]["API"];
};

/** Keep failures only when this host enables recovery and ordinary reflection is not time-limited. */
export function canRetainFailedReflection(context: ReflectionPolicyContext): boolean {
    return context.recoveryEnabled && context.setting.currentSettings().maxMTimeForReflectEvents <= 0;
}

/** Apply current settings to the recovered resource without broadening the reflection policy. */
export function canRetryReflectionResource(context: ReflectionPolicyContext, resource: RecoveryResource): boolean {
    if (!context.recoveryEnabled) {
        return false;
    }
    const settings = context.setting.currentSettings();
    return (
        settings.maxMTimeForReflectEvents <= 0 &&
        (resource === "local-database" || (settings.remoteType === REMOTE_COUCHDB && settings.readChunksOnline))
    );
}

/** Confirm current provenance or deletion; keep unresolved and policy-owned work distinct. */
export async function inspectReflection(
    context: ReflectionInspectionContext,
    entry: LoadedEntry,
    source: ReflectionSource
): Promise<"reflected" | "policy" | "pending"> {
    if (entry._conflicts?.length && !context.setting.currentSettings().writeDocumentsIfConflicted) {
        await context.conflict.queueCheckForIfOpen(context.path.getPath(entry));
        return "policy";
    }
    if (source === "received" && (entry.deleted || entry._deleted)) {
        try {
            if (await context.storageAccess.isExists(context.path.getPath(entry))) {
                return "pending";
            }
            const current = await context.getLocalDatabase().getRaw<LoadedEntry>(entry._id, { conflicts: true });
            const confirmed =
                current._id === entry._id &&
                current._rev === entry._rev &&
                isAnyNote(current) &&
                (current.deleted || current._deleted) &&
                (!current._conflicts?.length || context.setting.currentSettings().writeDocumentsIfConflicted);
            return confirmed ? "reflected" : "pending";
        } catch (error) {
            createInstanceLogFunction("SF:ReflectionRecovery", context.API)(error, LOG_LEVEL_VERBOSE);
            return "pending";
        }
    }
    const confirmed = await context.fileHandler.inspectCurrentFileProvenance?.(
        context.path.getPath(entry),
        entry._rev!
    );
    return confirmed ? "reflected" : "pending";
}

/** Re-enter the ordinary scanner with the existing attempt scope and preserve its failure. */
export async function reconcileScannedDocument(
    context: ScannedDocumentContext,
    entry: LoadedEntry,
    operation: ReflectionOperationContext
): Promise<unknown> {
    const file = await context.storageAccess.getFileStub(context.path.getPath(entry));
    operation.checkpoint?.();
    const result = await processFilePair(
        context.scannerHost,
        createInstanceLogFunction("SF:ReflectionRecovery", context.API),
        { file: file ?? undefined, doc: entry as MetaEntry },
        {
            mode: FullScanModes.NEWER_WINS,
            strictContentCheck: true,
            reflectionOperation: operation,
            onReflectionFailed: (_target, error) => {
                throw error;
            },
        }
    );
    if (result === FilePairProcessResults.FAILED) {
        throw new Error("Scanner reflection did not complete");
    }
    operation.checkpoint?.();
    return result;
}
