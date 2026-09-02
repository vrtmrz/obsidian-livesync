import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { fireAndForget } from "octagonal-wheels/promises";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { EVENT_FILE_SAVED, EVENT_SETTING_SAVED, eventHub } from "@/common/events";

type ReflectionFilterSettings = Pick<
    ObsidianLiveSyncSettings,
    | "handleFilenameCaseSensitive"
    | "ignoreFiles"
    | "maxMTimeForReflectEvents"
    | "syncIgnoreRegEx"
    | "syncInternalFiles"
    | "syncMaxSizeInMB"
    | "syncOnlyRegEx"
    | "useIgnoreFiles"
>;

interface AutomaticReplicationTriggerContext {
    readonly currentSettings: () => ObsidianLiveSyncSettings;
    readonly isSuspended: () => boolean;
    readonly replicateDatabaseEvent: () => Promise<unknown>;
    readonly reprocessStoredDocuments: () => Promise<number>;
    readonly resumeResultApplication: () => void;
    readonly suspendResultApplication: () => void;
}

function normalFileReflectionFilterSignature(settings: ReflectionFilterSettings): string {
    return JSON.stringify({
        handleFilenameCaseSensitive: settings.handleFilenameCaseSensitive ?? false,
        ignoreFiles: settings.ignoreFiles ?? "",
        maxMTimeForReflectEvents: settings.maxMTimeForReflectEvents ?? 0,
        syncIgnoreRegEx: settings.syncIgnoreRegEx ?? "",
        syncInternalFiles: settings.syncInternalFiles ?? false,
        syncMaxSizeInMB: settings.syncMaxSizeInMB ?? 0,
        syncOnlyRegEx: settings.syncOnlyRegEx ?? "",
        useIgnoreFiles: settings.useIgnoreFiles ?? false,
    });
}

/**
 * Create the settings-loaded handler which installs automatic replication and
 * result-application reactions. The returned closure owns the previous filter
 * signature; it is private composition state rather than a shared service.
 */
export function createAutomaticReplicationTriggers(context: AutomaticReplicationTriggerContext) {
    let reflectionFilterSignature: string | undefined;

    return function initialiseAutomaticReplicationTriggers(): Promise<boolean> {
        reflectionFilterSignature = normalFileReflectionFilterSignature(context.currentSettings());
        eventHub.onEvent(EVENT_FILE_SAVED, () => {
            if (context.currentSettings().syncOnSave && !context.isSuspended()) {
                scheduleTask("perform-replicate-after-save", 250, () => context.replicateDatabaseEvent());
            }
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (settings) => {
            const previousReflectionFilter = reflectionFilterSignature;
            const nextReflectionFilter = normalFileReflectionFilterSignature(settings);
            reflectionFilterSignature = nextReflectionFilter;
            if (settings.suspendParseReplicationResult) {
                context.suspendResultApplication();
            } else {
                context.resumeResultApplication();
            }
            if (previousReflectionFilter !== undefined && previousReflectionFilter !== nextReflectionFilter) {
                fireAndForget(() => context.reprocessStoredDocuments());
            }
        });

        return Promise.resolve(true);
    };
}
